import {
  pgTable,
  pgEnum,
  serial,
  bigint,
  integer,
  text,
  date,
  time,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/** Provenance of a word's translation (see design-doc.md §4). */
export const wordSource = pgEnum('word_source', ['dictionary', 'fallback']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  tgChatId: bigint('tg_chat_id', { mode: 'number' }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  reviewCount: integer('review_count').notNull().default(10),
  reviewTime: time('review_time').notNull().default('09:00'),
  testCount: integer('test_count').notNull().default(10),
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
    // English side — set of accepted answers (top-N of the chosen sense).
    english: text('english').array().notNull(),
    exampleRu: text('example_ru'),
    exampleEn: text('example_en'),
    source: wordSource('source').notNull(),
    nextReview: date('next_review').notNull(),
    intervalIndex: integer('interval_index').notNull().default(0),
    lastTested: timestamp('last_tested', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Review selection: due words, most overdue first.
    index('words_review_idx').on(t.userId, t.nextReview),
    // Test selection: not-due words, least-recently-tested first.
    index('words_test_idx').on(t.userId, t.lastTested),
  ],
);
