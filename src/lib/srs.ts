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

/** Index after a failure ("не помню" / wrong test). */
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
 * How many cards a review session covers (design-doc.md §5): `review_count`, capped
 * by the deck size, floored at 1 so a non-empty deck always yields ≥1 card. The
 * SINGLE source of truth for the session size — used both by `startReview` (the
 * actual run) and the scheduler's reminder text, so the "N слов" shown can't drift
 * from the real session. The `max(1, …)` floor is also defense-in-depth: settings
 * already validate `review_count >= 1` (lib/settings), so it only guards a
 * hand-edited/legacy row from degenerating the session — kept in ONE place.
 */
export function reviewSessionSize(reviewCount: number, deckSize: number): number {
  return Math.max(1, Math.min(reviewCount, deckSize));
}
