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
