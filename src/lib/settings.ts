// Pure settings-domain rules (design-doc.md §9). Kept side-effect-free so the
// validation/clamping is unit-tested apart from the DB/Telegram plumbing — and so
// the feature layer and the scheduler share ONE definition of each bound.

/** Lowest allowed `session_size` (a non-empty deck always runs ≥ 1 word). */
export const COUNT_MIN = 1;

/**
 * Ceiling for `new_per_day` — a sane upper bound that also stops the stepper from
 * running away. The lower bound is 0 (pause new words; reviews still run). Tunable.
 */
export const NEW_PER_DAY_MAX = 20;

/** Clamp an integer into [min, max] (assumes min ≤ max). */
export function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Upper bound for `session_size` — the deck size (design-doc.md §9: "макс = размер
 * колоды"), but never below 1 so an empty/tiny deck still allows the floor value.
 * Note: the EFFECTIVE session size (what a run actually covers) is
 * `reviewSessionSize(stored, deck)` from lib/srs — identical to clamping `stored`
 * into [1, this], which is why the settings screen reuses that single source.
 */
export function sessionSizeMax(deckSize: number): number {
  return Math.max(COUNT_MIN, deckSize);
}

/** Effective `new_per_day`: stored value clamped into [0, NEW_PER_DAY_MAX]. */
export function effectiveNewPerDay(stored: number): number {
  return clampInt(stored, 0, NEW_PER_DAY_MAX);
}
