import { and, asc, count, eq, notInArray } from 'drizzle-orm';
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
      source: card.source,
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

/** Fetch one card by id (scoped to the user) — used to grade the current card. */
export async function wordById(db: DB, userId: number, id: number): Promise<ReviewWord | null> {
  const [row] = await db
    .select(reviewWordColumns)
    .from(words)
    .where(and(eq(words.userId, userId), eq(words.id, id)))
    .limit(1);
  return row ?? null;
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
