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
 * Compose the daily session from the three selection buckets (design-doc.md §5), in
 * strict priority order:
 *   1. `reviewsReady` — due words seen before (most-overdue-first): the starvation
 *      guarantee, every word eventually reaches the front.
 *   2. `newReady` — brand-new words (already capped to `new_per_day` by the caller):
 *      reviews outrank new intake, so new words only fill leftover budget.
 *   3. `topUp` — not-yet-due seen words (manual `/repeat` only; empty for the
 *      scheduled run, which respects spacing): keeps a manual session full.
 * Deduped by id and sliced to the budget `n`. Pure, so the budget logic is unit-tested
 * apart from the DB; the result is naturally bounded by the available cards (an empty
 * bucket set yields `[]` regardless of `n` — no phantom cards).
 */
export function planSession<T extends { id: number }>(
  reviewsReady: T[],
  newReady: T[],
  topUp: T[],
  n: number,
): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const card of [...reviewsReady, ...newReady, ...topUp]) {
    if (out.length >= n) break;
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    out.push(card);
  }
  return out;
}
