import { addDays, type DateStr } from './dates';

// Spaced-repetition interval ladder (design-doc.md §7). Tunable.
export const LADDER_DAYS = [1, 3, 7, 14, 30, 60, 120, 240] as const;

export function clampIndex(index: number): number {
  if (index < 0) return 0;
  if (index >= LADDER_DAYS.length) return LADDER_DAYS.length - 1;
  return index;
}

export function intervalDays(index: number): number {
  return LADDER_DAYS[clampIndex(index)] ?? LADDER_DAYS[0];
}

/** Index after a "remembered" / correct review. */
export function promote(index: number): number {
  return clampIndex(index + 1);
}

/** Index after a failure (wrong typed answer / reveal). */
export function reset(): number {
  return 0;
}

/**
 * Next review date = `today` + ladder[index], computed calendar-wise.
 * `today` must be a date in the user's timezone (see dates.todayInTz). Always
 * from today, not the old due date — overdue-ness does not compound (design-doc.md §7).
 */
export function nextReviewDate(today: DateStr, index: number): DateStr {
  return addDays(today, intervalDays(index));
}

/**
 * The effective daily session size (design-doc.md §5): the stored `session_size`,
 * capped by the deck and floored at 1 so a non-empty deck always yields ≥1 card. The
 * single source of truth for the size shown in settings; `startSession` covers at most
 * this many words (it may run fewer when there's less ready work). The `max(1, …)`
 * floor is defense-in-depth — settings already validate `session_size >= 1` — so it
 * only guards a hand-edited/legacy row from degenerating the session.
 */
export function reviewSessionSize(sessionSize: number, deckSize: number): number {
  return Math.max(1, Math.min(sessionSize, deckSize));
}

/**
 * Compose the daily «повторение» session (design-doc.md §5): always up to `sessionSize`
 * words — `newPerDay` new words (the new-intake cap), the rest filled with the most-mature
 * learned words (smallest `next_review` first, passed pre-sorted). No due gate: we always
 * show the most-mature learned words, due or not (always-N for a daily habit). New and
 * learned are disjoint by construction (`last_tested` NULL vs set), so no dedupe is needed.
 * The result is bounded by what's available — a fresh deck yields just the new picks, a
 * deck with no new words yields just the learned fill. Pure, so it's unit-tested apart
 * from the DB. Order: learned (the review warm-up) first, new last.
 */
export function composeSession<T extends { id: number }>(
  learned: T[],
  newPile: T[],
  sessionSize: number,
  newPerDay: number,
): T[] {
  const newCount = Math.min(Math.max(0, newPerDay), newPile.length, sessionSize);
  const need = sessionSize - newCount;
  const learnedPicks = need > 0 ? learned.slice(0, need) : [];
  return [...learnedPicks, ...newPile.slice(0, newCount)];
}
