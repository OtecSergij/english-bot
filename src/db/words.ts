import { and, asc, count, desc, eq, gt, notInArray, sql } from 'drizzle-orm';
import type { DB } from './index';
import { words } from './schema';
import type { WordCard } from '../lib/card';
import type { DateStr } from '../lib/dates';

/** A word as needed by the review flow (design-doc.md §5): render + grade fields. */
export interface ReviewWord {
  id: number;
  russian: string;
  english: string;
  exampleRu: string | null;
  exampleEn: string | null;
  intervalIndex: number;
}

/**
 * A word as needed by the test flow (design-doc.md §6). Active recall is RU→EN, so
 * we only ever show the Russian prompt and grade against the English answer — no
 * example (it could leak the answer). This is also the in-memory session snapshot
 * shape (context.ts `TestState.cards`).
 */
export interface TestCard {
  id: number;
  russian: string;
  english: string;
}

const reviewWordColumns = {
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

/**
 * The next card to review: smallest `next_review` first (then oldest, then id),
 * EXCLUDING ids already shown this session (design-doc.md §5). No due filter —
 * review is always available; the session's seen-set keeps the pass linear (a
 * graded card may still sort first, so we must exclude it explicitly).
 */
export async function nextReviewWord(
  db: DB,
  userId: number,
  excludeIds: number[],
): Promise<ReviewWord | null> {
  const where =
    excludeIds.length > 0
      ? and(eq(words.userId, userId), notInArray(words.id, excludeIds))
      : eq(words.userId, userId);
  const [row] = await db
    .select(reviewWordColumns)
    .from(words)
    .where(where)
    .orderBy(asc(words.nextReview), asc(words.createdAt), asc(words.id))
    .limit(1);
  return row ?? null;
}

/** Total cards in the deck — the session-size cap `min(review_count, deck)` (design-doc.md §5). */
export async function countWords(db: DB, userId: number): Promise<number> {
  const [row] = await db.select({ value: count() }).from(words).where(eq(words.userId, userId));
  return row?.value ?? 0;
}

/**
 * Persist a word's new SRS schedule after a review/test outcome (design-doc.md §7).
 * The new `interval_index` / `next_review` are computed by the caller via `lib/srs`
 * (this layer stays free of SRS math).
 */
export async function updateWordSchedule(
  db: DB,
  userId: number,
  id: number,
  intervalIndex: number,
  nextReview: DateStr,
): Promise<void> {
  await db
    .update(words)
    .set({ intervalIndex, nextReview })
    .where(and(eq(words.userId, userId), eq(words.id, id)));
}

/**
 * The test selection (design-doc.md §6): words currently NOT due (`next_review` in
 * the future — "parked as known"), least-recently-tested first, then the most
 * overdue-to-park first (`next_review DESC`), then id for a stable tie-break.
 * `NULLS FIRST` surfaces never-tested words ahead of tested ones. The caller
 * snapshots this once — grading stamps `last_tested`, which would otherwise
 * re-order a re-query mid-session.
 */
export async function testWords(
  db: DB,
  userId: number,
  today: DateStr,
  limit: number,
): Promise<TestCard[]> {
  return db
    .select({ id: words.id, russian: words.russian, english: words.english })
    .from(words)
    .where(and(eq(words.userId, userId), gt(words.nextReview, today)))
    .orderBy(sql`${words.lastTested} asc nulls first`, desc(words.nextReview), asc(words.id))
    .limit(limit);
}

/**
 * A correct test answer (design-doc.md §6): stamp `last_tested`, leave the SRS
 * schedule untouched (a known word stays parked).
 */
export async function markTested(
  db: DB,
  userId: number,
  id: number,
  testedAt: Date,
): Promise<void> {
  await db
    .update(words)
    .set({ lastTested: testedAt })
    .where(and(eq(words.userId, userId), eq(words.id, id)));
}

/**
 * A failed test answer / reveal (design-doc.md §6, §7): reset the schedule (the
 * word drops back into review) AND stamp `last_tested`, in one write. The new
 * `interval_index` / `next_review` are computed by the caller via `lib/srs`.
 */
export async function recordTestFailure(
  db: DB,
  userId: number,
  id: number,
  intervalIndex: number,
  nextReview: DateStr,
  testedAt: Date,
): Promise<void> {
  await db
    .update(words)
    .set({ intervalIndex, nextReview, lastTested: testedAt })
    .where(and(eq(words.userId, userId), eq(words.id, id)));
}
