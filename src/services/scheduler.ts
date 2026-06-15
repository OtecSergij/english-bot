import cron from 'node-cron';
import { InlineKeyboard, type Bot } from 'grammy';
import type { MyContext } from '../context';
import type { DB } from '../db';
import { getScheduledReviewCandidates, markReviewedToday } from '../db/users';
import { countWords } from '../db/words';
import { hhmm, timeInTz, todayInTz, type DateStr } from '../lib/dates';
import { reviewSessionSize } from '../lib/srs';

/**
 * Pure CHEAP fire-gate for the daily reminder (design-doc.md §5, §7) — time +
 * idempotency only, no DB input. The scheduler ALWAYS runs the daily reminder (no
 * "due" gate): a reminder just means "it's your review time and we haven't reminded
 * yet today"; what to review is left entirely to `startReview` (same as a manual
 * `/repeat`). Side-effect-free so the rule is unit-tested apart from DB/Telegram.
 *
 * Deliberately takes NO deck size: the deck check needs a DB round-trip, so the tick
 * applies this cheap gate FIRST and only counts the deck once the reminder is due —
 * keeping the COUNT off ~every tick (wrong time / already sent today) and avoiding a
 * second copy of the time/stamp rule.
 *
 * Self-healing by design: the test is `now >= review_time` (not `== now`), so if the
 * bot was down at the exact minute, the next tick after it comes back still fires —
 * the `lastReviewedOn == today` guard keeps that to a single reminder per day.
 */
export function isReminderDue(args: {
  /** Current wall-clock 'HH:MM' in the user's TZ. */
  nowHHMM: string;
  /** `settings.review_time` reduced to 'HH:MM'. */
  reviewHHMM: string;
  /** Last date a daily review was sent/started, in the user's TZ (or null). */
  lastReviewedOn: DateStr | null;
  /** Today in the user's TZ. */
  today: DateStr;
}): boolean {
  if (args.lastReviewedOn === args.today) return false; // already handled today
  return args.nowHHMM >= args.reviewHHMM; // time has come (self-healing ≥, not ==)
}

/** Russian plural for a count: forms = [one, few, many] (1 слово / 2 слова / 5 слов). */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/** The reminder message + its single «Начать» button (callback `review:start`). */
function reminderText(n: number): string {
  return `🔔 Регулярное повторение: ${n} ${pluralRu(n, ['слово', 'слова', 'слов'])}.`;
}
function reminderKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Начать', 'review:start');
}

/**
 * Daily review scheduler (design-doc.md §5, §7). An in-process per-minute cron (the
 * bot already runs continuously, so this is a `setInterval`, not an external job —
 * one indexed query per tick, negligible). Each tick: for every user, if it's their
 * `review_time` and today's reminder hasn't gone out, send a notification with a
 * «Начать» button. Tapping it routes through normal middleware into the same
 * `startReview` as `/repeat` — so the scheduler never injects session state itself.
 *
 * Returns a stop function for graceful shutdown.
 */
export function startScheduler(bot: Bot<MyContext>, db: DB): () => void {
  let running = false; // re-entrancy guard: a slow tick must never overlap the next

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const candidates = await getScheduledReviewCandidates(db);
      for (const c of candidates) {
        // Per-user try/catch: one user's failure (send error, etc.) must not abort
        // the others. (Throttling / 429 backoff is a no-op at one user — deferred to
        // when multi-user lands; see to-do "Бэклог".)
        try {
          const today = todayInTz(now, c.timezone);
          const nowHHMM = timeInTz(now, c.timezone);
          const reviewHHMM = hhmm(c.reviewTime); // 'HH:MM:SS' → 'HH:MM'
          const due = isReminderDue({ nowHHMM, reviewHHMM, lastReviewedOn: c.lastReviewedOn, today });
          // TEMP diagnostic (to-do «плановое не стартует»): one line per tick per user
          // so prod logs reveal whether the tick runs at all and what it decides. Trim
          // to the events below once the cause is confirmed.
          console.log(
            `Scheduler tick: user=${c.userId} tz=${c.timezone} now=${nowHHMM} review=${reviewHHMM} today=${today} last=${c.lastReviewedOn} due=${due}`,
          );
          // Cheap gate first (no DB): skips ~every tick (wrong time / already sent
          // today) before we ever round-trip the deck count.
          if (!due) continue;
          const deckSize = await countWords(db, c.userId);
          if (deckSize <= 0) {
            console.log(`Scheduler: user ${c.userId} review due but deck is empty`);
            continue; // nothing in the deck — don't nag
          }

          // Session size the user will actually go through (shared rule with
          // startReview, so the shown count can't drift from the real run — lib/srs).
          const n = reviewSessionSize(c.reviewCount, deckSize);
          await bot.api.sendMessage(c.tgChatId, reminderText(n), {
            reply_markup: reminderKeyboard(),
          });
          // Stamp AFTER a successful send: a failed stamp (rare) re-nags next minute,
          // which is far better than stamping first and silently skipping the day if
          // the send fails.
          await markReviewedToday(db, c.userId, today);
          console.log(`Scheduler: daily reminder sent to user ${c.userId} (${n} words)`);
        } catch (err) {
          console.error(`Scheduler: daily review failed for user ${c.userId}:`, err);
        }
      }
    } catch (err) {
      console.error('Scheduler tick failed:', err);
    } finally {
      running = false;
    }
  };

  const task = cron.schedule('* * * * *', () => void tick());
  console.log('Scheduler started: daily review check every minute');
  return () => {
    task.stop();
  };
}
