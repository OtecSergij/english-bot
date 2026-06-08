// Pure settings-domain rules (design-doc.md §9). Kept side-effect-free so the
// validation/clamping is unit-tested apart from the DB/Telegram plumbing — and so
// the feature layer and the scheduler share ONE definition of each bound.

/** Lowest allowed value for both counts (design-doc.md §9: review/test ≥ 1). */
export const COUNT_MIN = 1;

/**
 * Ceiling for `test_count`. The test pool is the not-due subset (a moving target),
 * so unlike review there's no deck cap — just a sane upper bound that also stops the
 * stepper from running away. Tunable.
 */
export const TEST_COUNT_MAX = 50;

/** Clamp an integer into [min, max] (assumes min ≤ max). */
export function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Upper bound for `review_count` — the deck size (design-doc.md §9: "макс = размер
 * колоды"), but never below 1 so an empty/tiny deck still allows the floor value.
 * Note: the EFFECTIVE review_count (what a session actually runs) is
 * `reviewSessionSize(stored, deck)` from lib/srs — identical to clamping `stored`
 * into [1, this], which is why the settings screen reuses that single source.
 */
export function reviewCountMax(deckSize: number): number {
  return Math.max(COUNT_MIN, deckSize);
}

/** Effective `test_count`: stored value clamped into [1, TEST_COUNT_MAX]. */
export function effectiveTestCount(stored: number): number {
  return clampInt(stored, COUNT_MIN, TEST_COUNT_MAX);
}
