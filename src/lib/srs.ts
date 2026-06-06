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

/** Next review date (date-only) computed from `from` — always from today, no compounding. */
export function nextReviewDate(from: Date, index: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + intervalDays(index));
  return d;
}
