import { and, eq } from 'drizzle-orm';
import type { DB } from './index';
import { words } from './schema';
import type { WordCard } from '../lib/card';
import type { DateStr } from '../lib/dates';

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
