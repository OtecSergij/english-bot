// Date handling for SRS (design-doc.md §7). We work with calendar dates as
// 'YYYY-MM-DD' strings (matching the Drizzle `date` column) and always relative
// to the user's timezone — never the server's local zone.

export type DateStr = string; // 'YYYY-MM-DD'

/** Calendar date (YYYY-MM-DD) that is "today" in the given IANA timezone. */
export function todayInTz(now: Date, timeZone: string): DateStr {
  // formatToParts avoids any dependency on the locale's assembled date format.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Wall-clock time as 'HH:MM' (24-hour, zero-padded) in the given IANA timezone.
 * Used by the daily scheduler to compare "now" against `settings.review_time`
 * (design-doc.md §5). Zero-padded 24h strings compare lexicographically the same
 * as chronologically, so `nowHHMM >= reviewHHMM` is a valid "time has come" test.
 */
export function timeInTz(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', // 00..23 (midnight = 00, not 24)
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

/** Add N calendar days to a YYYY-MM-DD string. Pure date arithmetic in UTC. */
export function addDays(date: DateStr, days: number): DateStr {
  const [y, m, d] = date.split('-');
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
