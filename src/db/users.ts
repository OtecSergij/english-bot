import { eq } from 'drizzle-orm';
import type { DB } from './index';
import { settings, users } from './schema';

/**
 * Provision the user row + default settings (design-doc.md §2).
 * Idempotent: safe to call on /start and at startup. `timezone` seeds
 * settings.timezone on first insert (known_issues.md §6). Returns the user id.
 */
export async function ensureUser(db: DB, tgChatId: number, timezone: string): Promise<number> {
  await db.insert(users).values({ tgChatId }).onConflictDoNothing();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tgChatId, tgChatId))
    .limit(1);
  if (!row) throw new Error(`Failed to provision user for chat ${tgChatId}`);
  await db.insert(settings).values({ userId: row.id, timezone }).onConflictDoNothing();
  return row.id;
}

/** A user's id + ALL their editable settings — shared by review/test/add and the settings menu. */
export interface UserContext {
  userId: number;
  timezone: string; // IANA tz — source of truth for SRS dates (known_issues.md §6)
  reviewCount: number;
  /** `settings.review_time` as 'HH:MM:SS' (Postgres `time`); used by the settings menu. */
  reviewTime: string;
  testCount: number;
}

/**
 * Read-only resolve of a user's internal id + all editable settings, by chat id (no
 * provisioning — that belongs at flow entry via `ensureUser`). The single "user +
 * settings by chat" reader: each consumer reads the subset it needs (review uses
 * reviewCount, test uses testCount, the menu uses all incl. reviewTime), so it's a
 * shared superset rather than per-role shapes — one join predicate, one place to
 * change. Returns null if the user has no row yet (e.g. a DB reset mid-session) so
 * callers can bail gracefully. (The fleet-wide scheduler read is separate below.)
 */
export async function getUserContext(db: DB, tgChatId: number): Promise<UserContext | null> {
  const [row] = await db
    .select({
      userId: users.id,
      timezone: settings.timezone,
      reviewCount: settings.reviewCount,
      reviewTime: settings.reviewTime,
      testCount: settings.testCount,
    })
    .from(users)
    .innerJoin(settings, eq(settings.userId, users.id))
    .where(eq(users.tgChatId, tgChatId))
    .limit(1);
  return row ?? null;
}

/**
 * Read just the timezone, by internal user id (when you already hold the userId,
 * e.g. mid add-conversation) — a single-table lookup, no re-resolving the user.
 */
export async function getTimezone(db: DB, userId: number): Promise<string | null> {
  const [row] = await db
    .select({ timezone: settings.timezone })
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1);
  return row?.timezone ?? null;
}

/** A user + the settings the daily scheduler needs to decide whether to remind. */
export interface ScheduledReviewCandidate {
  userId: number;
  tgChatId: number;
  /** `settings.review_time` as 'HH:MM:SS' (Postgres `time`). */
  reviewTime: string;
  timezone: string;
  reviewCount: number;
  /** Last daily-review date in the user's TZ ('YYYY-MM-DD'), or null if never. */
  lastReviewedOn: string | null;
}

/**
 * Every user with their schedule fields (design-doc.md §5). The scheduler runs the
 * time/idempotency check per row in app code (TZ math lives in `lib/dates`), so this
 * stays a plain join. One row today (whitelist), but written multi-user-ready.
 */
export async function getScheduledReviewCandidates(db: DB): Promise<ScheduledReviewCandidate[]> {
  return db
    .select({
      userId: users.id,
      tgChatId: users.tgChatId,
      reviewTime: settings.reviewTime,
      timezone: settings.timezone,
      reviewCount: settings.reviewCount,
      lastReviewedOn: users.lastReviewedOn,
    })
    .from(users)
    .innerJoin(settings, eq(settings.userId, users.id));
}

/**
 * Stamp today's date (user's TZ) as "daily review handled" (design-doc.md §5).
 * Called both when the scheduler sends the reminder and when a review actually
 * starts (manual `/repeat` or the reminder's «Начать») — so a manual run skips the
 * scheduled one, and the reminder is sent at most once per day. Idempotent per date.
 */
export async function markReviewedToday(db: DB, userId: number, date: string): Promise<void> {
  await db.update(users).set({ lastReviewedOn: date }).where(eq(users.id, userId));
}

/**
 * Patch one or more editable settings fields (design-doc.md §9). `timezone` is
 * intentionally NOT writable here — it's env-seeded for now (known_issues.md §6).
 * Callers always pass a non-empty patch (one field per button press); values are
 * pre-validated/clamped in lib/settings, so this just persists.
 */
export async function updateSettings(
  db: DB,
  userId: number,
  patch: Partial<{ reviewCount: number; reviewTime: string; testCount: number }>,
): Promise<void> {
  await db.update(settings).set(patch).where(eq(settings.userId, userId));
}
