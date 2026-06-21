import {
  pgTable,
  serial,
  bigint,
  integer,
  text,
  date,
  time,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  tgChatId: bigint('tg_chat_id', { mode: 'number' }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Date (in the user's TZ) of the last daily review we sent/started — the
  // scheduler's idempotency key (design-doc.md §5): "already handled today" and
  // "a manual /repeat skips today's scheduled run" both compare against this.
  // System-tracked state (not a user-editable setting), so it lives on `users`,
  // not `settings`. NULL = never reviewed.
  lastReviewedOn: date('last_reviewed_on'),
  // Behind-pace signal hysteresis (design-doc.md §5). Consecutive daily-send days the
  // backlog stayed over the session size / cleared with room. Counters (not a bool)
  // so a single day can't flip the nudge, and a fresh user (0) can't fire on day 1.
  backlogStrikes: integer('backlog_strikes').notNull().default(0),
  aheadStrikes: integer('ahead_strikes').notNull().default(0),
});

export const settings = pgTable('settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Daily session budget N — how many words one «повторение» run covers (capped by
  // the deck via lib/srs reviewSessionSize).
  sessionSize: integer('session_size').notNull().default(10),
  // Cap on brand-new words introduced per session (design-doc.md §5). Reviews outrank
  // new words: new ones backfill the budget only after due reviews. 0 = pause new words.
  newPerDay: integer('new_per_day').notNull().default(5),
  reviewTime: time('review_time').notNull().default('09:00'),
  timezone: text('timezone').notNull().default('UTC'),
});

export const words = pgTable(
  'words',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Russian side — always a single prompt word (design-doc.md §4).
    russian: text('russian').notNull(),
    // English side — the single accepted answer (design-doc.md §4).
    english: text('english').notNull(),
    exampleRu: text('example_ru'),
    exampleEn: text('example_en'),
    nextReview: date('next_review').notNull(),
    intervalIndex: integer('interval_index').notNull().default(0),
    // Lifetime failure count — leech detection (design-doc.md §7, surfacing deferred).
    lapses: integer('lapses').notNull().default(0),
    // NULL = never been in a session ("new"); set = seen (review/relearn). The
    // new-vs-seen discriminator for selection (a new word and a failed-today word are
    // identical on next_review/interval_index — only last_tested distinguishes them).
    lastTested: timestamp('last_tested', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Session selection: ready/overdue words, most overdue first; also the top-up order.
    index('words_review_idx').on(t.userId, t.nextReview),
    // New-vs-seen split: surfaces never-seen words (last_tested IS NULL) first.
    index('words_test_idx').on(t.userId, t.lastTested),
  ],
);
