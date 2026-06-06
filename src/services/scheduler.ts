import cron from 'node-cron';
import type { Bot } from 'grammy';
import type { MyContext } from '../context';

/**
 * Daily review scheduler — STUB (design-doc.md §5, §7).
 * TODO: every minute, find users whose review_time matches now (in their TZ) and
 * who have no review yet today, then send the first review card.
 */
export function startScheduler(_bot: Bot<MyContext>): void {
  cron.schedule('* * * * *', () => {
    // TODO: query due users and trigger their daily review.
  });
}
