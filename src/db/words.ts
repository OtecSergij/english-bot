import { and, asc, count, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { DB } from './index';
import { words } from './schema';
import { planSession } from '../lib/srs';
import type { WordCard } from '../lib/card';
import type { DateStr } from '../lib/dates';

/**
 * A word as the unified «повторение» session needs it (design-doc.md §5): render +
 * grade fields. Active recall is RU→EN, so the QUESTION render shows only the Russian
 * prompt (+ Russian example as a hint); `english` / `exampleEn` are carried for the
 * post-answer reveal and `intervalIndex` for the on-correct promote — all in memory
 * only, never shown before grading (no answer leak). Also the in-memory session
 * snapshot shape (context.ts `ReviewState.cards`).
 */
export interface SessionCard {
  id: number;
  russian: string;
  english: string;
  exampleRu: string | null;
  exampleEn: string | null;
  intervalIndex: number;
}

const sessionCardColumns = {
  id: words.id,
  russian: words.russian,
  english: words.english,
  exampleRu: words.exampleRu,
  exampleEn: words.exampleEn,
  intervalIndex: words.intervalIndex,
} as const;

/** Insert a new word card and return its id (design-doc.md §4, §11). */
export async function addWord(
  db: DB,
  userId: number,
  card: WordCard,
  nextReview: DateStr,
): Promise<number> {
  const [row] = await db
    .insert(words)
    .values({
      userId,
      russian: card.russian,
      english: card.english,
      exampleRu: card.exampleRu,
      exampleEn: card.exampleEn,
      nextReview,
    })
    .returning({ id: words.id });
  if (!row) throw new Error('Failed to insert word');
  return row.id;
}

/**
 * Soft duplicate check by Russian prompt (known_issues.md §4). Also catches the
 * cross-input duplicate (add «собака», then «dog» → prompt «собака» collides).
 * Returns the existing word (russian + english) so the caller can show it, or
 * null. (Returns null, not undefined — must survive `conversation.external`.)
 */
export async function findWordByRussian(
  db: DB,
  userId: number,
  russian: string,
): Promise<{ russian: string; english: string } | null> {
  const [row] = await db
    .select({ russian: words.russian, english: words.english })
    .from(words)
    .where(and(eq(words.userId, userId), eq(words.russian, russian)))
    .limit(1);
  return row ?? null;
}

/** Total cards in the deck — the session-size cap `min(session_size, deck)` (design-doc.md §5). */
export async function countWords(db: DB, userId: number): Promise<number> {
  const [row] = await db.select({ value: count() }).from(words).where(eq(words.userId, userId));
  return row?.value ?? 0;
}

/**
 * The daily session (design-doc.md §5): a budget of `sessionSize` words filled
 * reviews-first from three buckets, all gated on "ready today" (`next_review <= today`):
 *   1. reviewsReady — due words seen before (`last_tested IS NOT NULL`), most overdue first.
 *   2. newReady — brand-new words (`last_tested IS NULL`), oldest first, capped to `newPerDay`.
 *   3. topUp (manual `/repeat` only) — not-yet-due seen words, nearest due first.
 * `planSession` (lib/srs, pure) concatenates in that priority order, dedupes, and
 * slices to the budget. The caller SNAPSHOTS this once — grading mutates
 * `next_review` / `last_tested`, which would reorder a mid-session re-query.
 * The `topUp` filter keeps `last_tested IS NOT NULL` so it never re-pulls the new
 * words already owned by `newReady` (and capped by it).
 */
export async function selectSession(
  db: DB,
  userId: number,
  today: DateStr,
  sessionSize: number,
  newPerDay: number,
  opts: { includeTopUp: boolean },
): Promise<SessionCard[]> {
  const reviewsReady = await db
    .select(sessionCardColumns)
    .from(words)
    .where(and(eq(words.userId, userId), lte(words.nextReview, today), isNotNull(words.lastTested)))
    .orderBy(asc(words.nextReview), asc(words.createdAt), asc(words.id))
    .limit(sessionSize);

  const newReady =
    newPerDay > 0
      ? await db
          .select(sessionCardColumns)
          .from(words)
          .where(
            and(eq(words.userId, userId), lte(words.nextReview, today), isNull(words.lastTested)),
          )
          .orderBy(asc(words.createdAt), asc(words.id))
          .limit(newPerDay)
      : [];

  const topUp = opts.includeTopUp
    ? await db
        .select(sessionCardColumns)
        .from(words)
        .where(and(eq(words.userId, userId), gt(words.nextReview, today), isNotNull(words.lastTested)))
        .orderBy(asc(words.nextReview), asc(words.id))
        .limit(sessionSize)
    : [];

  return planSession(reviewsReady, newReady, topUp, sessionSize);
}

/**
 * Words ready today (`next_review <= today`) — the behind-pace pressure scalar
 * (design-doc.md §5). Counts both overdue reviews and overdue-new words; the
 * scheduler compares it against the session size for the "you're falling behind" nudge.
 */
export async function countBacklog(db: DB, userId: number, today: DateStr): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(words)
    .where(and(eq(words.userId, userId), lte(words.nextReview, today)));
  return row?.value ?? 0;
}

/**
 * Brand-new words (never seen) whose start day has arrived — the scheduler's
 * new-bucket size, used to compute the real session count and to gate the behind nudge.
 */
export async function countNewReady(db: DB, userId: number, today: DateStr): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(words)
    .where(and(eq(words.userId, userId), lte(words.nextReview, today), isNull(words.lastTested)));
  return row?.value ?? 0;
}

/**
 * Persist a graded outcome (design-doc.md §7): the new SRS schedule + stamp
 * `last_tested`, in one write. A `lapsed` outcome (wrong / reveal) also bumps the
 * lifetime `lapses` counter (leech detection). The new `interval_index` /
 * `next_review` are computed by the caller via lib/srs (this layer stays free of SRS math).
 */
export async function recordOutcome(
  db: DB,
  userId: number,
  id: number,
  outcome: { intervalIndex: number; nextReview: DateStr; testedAt: Date; lapsed: boolean },
): Promise<void> {
  await db
    .update(words)
    .set({
      intervalIndex: outcome.intervalIndex,
      nextReview: outcome.nextReview,
      lastTested: outcome.testedAt,
      ...(outcome.lapsed ? { lapses: sql`${words.lapses} + 1` } : {}),
    })
    .where(and(eq(words.userId, userId), eq(words.id, id)));
}
