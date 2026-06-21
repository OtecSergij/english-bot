import cron from 'node-cron';
import { InlineKeyboard, type Bot } from 'grammy';
import type { MyContext } from '../context';
import type { DB } from '../db';
import { getScheduledReviewCandidates, markReviewedToday, updatePaceState } from '../db/users';
import { countBacklog, countNewPile, countWords } from '../db/words';
import { hhmm, timeInTz, todayInTz, type DateStr } from '../lib/dates';

/**
 * Pure CHEAP fire-gate for the daily reminder (design-doc.md §5, §7) — time +
 * idempotency only, no DB input. The scheduler ALWAYS runs the daily reminder (no
 * "due" gate): a reminder just means "it's your review time and we haven't reminded
 * yet today"; what to review is left entirely to `startSession` (same as a manual
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

/** Consecutive over-budget days before the behind-pace nudge fires (design-doc.md §5). */
export const PACE_STRIKE_LIMIT = 3;

export interface PaceState {
  backlogStrikes: number;
  aheadStrikes: number;
}

/** A "you're falling behind" nudge with the session size to bump to. */
export interface BehindNudge {
  kind: 'behind';
  /** Suggested new session size (≥ current N + 1), shown in the reminder. */
  suggested: number;
}

/**
 * Advance the behind-pace hysteresis on a daily evaluation (design-doc.md §5) and
 * decide whether to nudge. Pure, so it's unit-tested apart from the DB/Telegram.
 *
 * `backlog` = words ready today; `sessionSize` = the budget N; `newReady` = brand-new
 * words ready today (gates the nudge — no point telling someone to slow adding if
 * they've stopped). Counters start at 0 (migration default), so the nudge cannot fire
 * on day 1: it needs `limit` consecutive over-budget days, then re-fires daily until
 * the backlog clears (the visibility the owner asked for). `aheadStrikes` accrues on
 * fully-cleared days for a future "you're keeping up — add more" nudge (column
 * shipped, delivery deferred).
 */
export function updatePaceCounters(args: {
  backlog: number;
  sessionSize: number;
  newReady: number;
  backlogStrikes: number;
  aheadStrikes: number;
  limit?: number;
}): PaceState & { nudge: BehindNudge | null } {
  const limit = args.limit ?? PACE_STRIKE_LIMIT;
  let backlogStrikes = args.backlogStrikes;
  let aheadStrikes = args.aheadStrikes;

  if (args.backlog > args.sessionSize) {
    backlogStrikes += 1;
    aheadStrikes = 0;
  } else if (args.backlog === 0) {
    backlogStrikes = 0;
    aheadStrikes += 1;
  } else {
    backlogStrikes = 0;
    aheadStrikes = 0;
  }

  const nudge: BehindNudge | null =
    backlogStrikes >= limit && args.newReady > 0
      ? { kind: 'behind', suggested: Math.max(args.sessionSize + 1, args.backlog) }
      : null;

  return { backlogStrikes, aheadStrikes, nudge };
}

/** The reminder message (+ optional behind-pace nudge) and its «Начать» button. */
function reminderText(n: number, nudge: BehindNudge | null): string {
  const base = `🔔 Регулярное повторение: ${n} ${pluralRu(n, ['слово', 'слова', 'слов'])}.`;
  if (!nudge) return base;
  return `${base}\n\n⚠️ Очередь повторений растёт. Замедли добавление новых слов или подними «слов в день» до ${nudge.suggested} в настройках.`;
}
function reminderKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Начать', 'review:start');
}

/**
 * Daily review scheduler (design-doc.md §5, §7). An in-process per-minute cron (the
 * bot already runs continuously, so this is a `setInterval`, not an external job).
 * Each tick applies the cheap time/idempotency gate first; the once-daily evaluation
 * then sends a reminder whenever the deck is non-empty (always-N model — no rest days),
 * carrying the behind-pace nudge when words are coming due faster than N/day clears them.
 * Tapping «Начать» routes through normal middleware into the same `startSession` as
 * `/repeat` — so the scheduler never injects session state itself.
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
          // Cheap gate first (no DB): skips ~every tick (wrong time / already sent
          // today) before we ever round-trip the counts.
          if (!isReminderDue({ nowHHMM, reviewHHMM, lastReviewedOn: c.lastReviewedOn, today }))
            continue;

          // Once-daily evaluation (this branch runs once per day, after review_time).
          const deckSize = await countWords(db, c.userId);
          if (deckSize <= 0) continue; // empty deck — nothing to learn yet, don't nag
          const newPile = await countNewPile(db, c.userId);
          const backlog = await countBacklog(db, c.userId, today);
          // The REAL session size = exactly what composeSession/selectSession will run, so
          // the shown count can't drift: new (capped) + the learned fill, bounded by N.
          const newCount = Math.min(c.newPerDay, newPile, c.sessionSize);
          const n = Math.min(c.sessionSize, newCount + (deckSize - newPile));

          const pace = updatePaceCounters({
            backlog,
            sessionSize: c.sessionSize,
            newReady: newPile,
            backlogStrikes: c.backlogStrikes,
            aheadStrikes: c.aheadStrikes,
          });

          // Always send while the deck is non-empty (always-N model — no rest days). The
          // behind nudge ("more is coming due than N/day clears — raise N") rides along.
          await bot.api.sendMessage(c.tgChatId, reminderText(n, pace.nudge), {
            reply_markup: reminderKeyboard(),
          });
          console.log(`Scheduler: daily reminder sent to user ${c.userId} (${n} words)`);
          // Finalize the day after a successful send (if any). Stamp FIRST so the day is
          // idempotent before the pace write: if the stamp succeeds and the pace write
          // then fails, we only lose one harmless increment — whereas the reverse order
          // would re-fire next minute on a stamp failure and double-count the persisted
          // pace bump. A send error skips both → clean re-evaluation next minute.
          await markReviewedToday(db, c.userId, today);
          await updatePaceState(db, c.userId, {
            backlogStrikes: pace.backlogStrikes,
            aheadStrikes: pace.aheadStrikes,
          });
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
