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

/** A provisioned user plus their settings — the per-flow context (review/test/add). */
export interface UserContext {
  userId: number;
  timezone: string; // IANA tz — source of truth for SRS dates (known_issues.md §6)
  reviewCount: number;
  testCount: number;
}

/**
 * Read-only resolve of internal user id + settings by chat id (no provisioning).
 * Use on hot paths (a button press, an answer) where `ensureUser`'s writes are
 * wrong — provisioning belongs at flow entry. Returns null if the user has no row
 * yet (e.g. a DB reset mid-session), so callers can bail gracefully.
 */
export async function getUserContext(db: DB, tgChatId: number): Promise<UserContext | null> {
  const [row] = await db
    .select({
      userId: users.id,
      timezone: settings.timezone,
      reviewCount: settings.reviewCount,
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
