import { Composer, InlineKeyboard } from 'grammy';
import { config } from '../config';
import {
  freeTextIn,
  nonTextIn,
  sessionExpired,
  type MyContext,
  type ReviewState,
} from '../context';
import { ensureUser, getUserContext, markReviewedToday } from '../db/users';
import { recordOutcome, selectSession, type SessionCard } from '../db/words';
import type { AppDeps } from '../deps';
import { todayInTz } from '../lib/dates';
import { isCorrect } from '../lib/grading';
import { escapeHtml } from '../lib/html';
import { detectLang } from '../lib/lang';
import { nextReviewDate, promote, reset } from '../lib/srs';
import { deleteFlowMessage, editFlow, resetSession } from './flow';

// ---------------------------------------------------------------------------
// Pure helpers (no DB / Telegram) — the heart of the cycle, unit-tested apart.
// ---------------------------------------------------------------------------

/** The remaining-cards cycle (design-doc.md §5). The current card is always `queue[0]`. */
export interface ReviewProgress {
  queue: number[];
  failedIds: number[];
}

/**
 * Apply one graded outcome to the cycle (design-doc.md §5):
 * - `retry` → the current card goes to the back (re-asked until correct);
 * - otherwise it leaves the queue (correct, or revealed/skipped);
 * - `failed` records the id (deduped) — the score, and it's already saved in the DB.
 *
 * Correct = `{failed:false, retry:false}`; wrong = `{failed:true, retry:true}`;
 * reveal = `{failed:true, retry:false}`.
 */
export function applyOutcome(
  p: ReviewProgress,
  outcome: { failed: boolean; retry: boolean },
): ReviewProgress {
  const [current, ...rest] = p.queue;
  if (current === undefined) return p;
  const queue = outcome.retry ? [...rest, current] : rest;
  const failedIds =
    outcome.failed && !p.failedIds.includes(current) ? [...p.failedIds, current] : p.failedIds;
  return { queue, failedIds };
}

/** The session ends once every word has left the cycle (correct or revealed). */
export function sessionComplete(queue: number[]): boolean {
  return queue.length === 0;
}

/** How the just-graded card is summarised above the next prompt. */
export type ResultKind = 'correct' | 'wrong' | 'reveal';

/** Visual divider between the previous result and the next question in one message. */
const SEP = '— — —';

/** Prompt — answer, both quoted: the shared shape for revealing a card. */
function answerLine(card: SessionCard): string {
  return `«${escapeHtml(card.russian)}» — «${escapeHtml(card.english)}»`;
}

function resultHeader(kind: ResultKind, card: SessionCard): string {
  if (kind === 'correct') return `✅ Верно! ${answerLine(card)}`;
  if (kind === 'wrong') return `❌ Неверно. Правильно: ${answerLine(card)}`;
  return `Ответ: ${answerLine(card)}`; // reveal / skip
}

/** Both examples, shown only AFTER grading (reinforcement); either may be absent. */
function exampleLines(card: SessionCard): string[] {
  const lines: string[] = [];
  if (card.exampleRu) lines.push(escapeHtml(card.exampleRu));
  if (card.exampleEn) lines.push(escapeHtml(card.exampleEn));
  return lines;
}

/**
 * A question (design-doc.md §5): an optional ⚠️ note (e.g. wrong input language), the
 * Russian prompt, and the Russian example as a hint (never the English — that would leak
 * the answer). No counter and no "type the translation" line — the bold word + the
 * «Показать ответ» button make the ask self-evident.
 */
export function renderQuestion(card: SessionCard, note?: string): string {
  const lines: string[] = [];
  if (note) lines.push(note, '');
  lines.push(`<b>${escapeHtml(card.russian)}</b>`);
  if (card.exampleRu) lines.push(escapeHtml(card.exampleRu));
  return lines.join('\n');
}

/**
 * One edited message carrying the just-graded card's result (verdict + full card)
 * AND the next question below it — so the correction stays visible while the user
 * answers the next word, with no «Дальше» tap (design-doc.md §5).
 */
export function renderStep(graded: SessionCard, kind: ResultKind, next: SessionCard): string {
  return [resultHeader(kind, graded), ...exampleLines(graded), SEP, renderQuestion(next)].join('\n');
}

/** End-of-session summary — kept in the chat as the result (to-do §UX). */
export function renderSummary(total: number, failed: SessionCard[]): string {
  const correct = total - failed.length;
  if (failed.length === 0) return `✅ Повторение пройдено: ${correct}/${total}. Отлично!`;
  const list = failed.map((w) => `• ${escapeHtml(w.russian)} → ${escapeHtml(w.english)}`).join('\n');
  return `Повторение завершено: ${correct}/${total} верно.\nОшибки были в:\n${list}`;
}

// ---------------------------------------------------------------------------
// Session plumbing
// ---------------------------------------------------------------------------

function revealKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard().text('Показать ответ', `review:reveal:${id}`);
}

function currentCard(review: ReviewState): SessionCard | undefined {
  return review.cards.find((c) => c.id === review.queue[0]);
}

/**
 * Drop a session and remove its dangling flow message (timed out / desynced). Safe
 * when there is no review state.
 */
async function discardSession(ctx: MyContext): Promise<void> {
  if (ctx.session.review) await deleteFlowMessage(ctx, ctx.session.review.messageId);
  resetSession(ctx);
}

/** Edit the flow message to the timeout note and close the session (design-doc.md §5). */
async function closeOnTimeout(ctx: MyContext, review: ReviewState): Promise<void> {
  await editFlow(
    ctx,
    review.messageId,
    '⏱ Повторение закрыто из-за неактивности. /repeat — начать заново.',
  );
  resetSession(ctx);
}

/** Edit the flow message to the end-of-session summary and reset. */
async function finishSession(ctx: MyContext, review: ReviewState): Promise<void> {
  const failed = review.failedIds
    .map((id) => review.cards.find((c) => c.id === id))
    .filter((c): c is SessionCard => c !== undefined);
  await editFlow(ctx, review.messageId, renderSummary(review.cards.length, failed));
  resetSession(ctx);
}

/**
 * Apply an outcome to the queue, then render the just-graded card's result + the next
 * question in one message, or the summary when the cycle empties.
 */
async function advanceStep(
  ctx: MyContext,
  review: ReviewState,
  graded: { card: SessionCard; kind: ResultKind },
  outcome: { failed: boolean; retry: boolean },
): Promise<void> {
  const next = applyOutcome({ queue: review.queue, failedIds: review.failedIds }, outcome);
  review.queue = next.queue;
  review.failedIds = next.failedIds;

  const nextCard = currentCard(review);
  if (sessionComplete(review.queue) || !nextCard) {
    await finishSession(ctx, review);
    return;
  }
  await editFlow(
    ctx,
    review.messageId,
    renderStep(graded.card, graded.kind, nextCard),
    revealKeyboard(nextCard.id),
  );
}

/**
 * Start a «повторение» session (design-doc.md §5) — the single active-recall flow.
 * Manual `/repeat` and the scheduled «Начать» are identical (always N words); the only
 * difference is `reuseMessageId`, which edits the scheduler's reminder message into the
 * first question instead of sending a fresh one.
 */
async function startSession(
  deps: AppDeps,
  ctx: MyContext,
  opts: { reuseMessageId?: number },
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const now = Date.now();

  // Don't clobber a live session (design-doc.md §8).
  if (ctx.session.mode === 'review') {
    if (ctx.session.review && !sessionExpired(ctx.session.review, now)) {
      if (opts.reuseMessageId === undefined) await ctx.reply('Повторение уже идёт.');
      return;
    }
    await discardSession(ctx); // expired/desync → drop it and its dangling message
  }

  // Provision on entry (covers a fresh owner / DB reset), then read settings.
  await ensureUser(deps.db, chatId, config.ownerTz);
  const user = await getUserContext(deps.db, chatId);
  if (!user) {
    await ctx.reply('Не удалось открыть повторение. Попробуй позже.');
    return;
  }

  const today = todayInTz(new Date(now), user.timezone);
  const cards = await selectSession(deps.db, user.userId, user.sessionSize, user.newPerDay);
  if (cards.length === 0) {
    // Empty only when the deck itself is empty (always-N otherwise) — no stamp, nothing
    // to suppress.
    resetSession(ctx);
    const msg = 'В словаре пока нет слов — добавь хотя бы одно.';
    if (opts.reuseMessageId !== undefined) await editFlow(ctx, opts.reuseMessageId, msg);
    else await ctx.reply(msg);
    return;
  }

  const first = cards[0]!;
  const text = renderQuestion(first);
  let messageId: number;
  if (opts.reuseMessageId !== undefined) {
    await editFlow(ctx, opts.reuseMessageId, text, revealKeyboard(first.id));
    messageId = opts.reuseMessageId;
  } else {
    const msg = await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: revealKeyboard(first.id),
    });
    messageId = msg.message_id;
  }

  ctx.session.mode = 'review';
  ctx.session.review = {
    messageId,
    cards,
    queue: cards.map((c) => c.id),
    failedIds: [],
    lastActivity: now,
    userId: user.userId,
    timezone: user.timezone,
  };

  // Stamp today's daily review as handled (design-doc.md §5): a manual run skips the
  // scheduled reminder, and the reminder is sent at most once per day. Non-fatal.
  try {
    await markReviewedToday(deps.db, user.userId, today);
  } catch (err) {
    console.error('Failed to stamp daily review:', err);
  }
}

/** A typed answer (free text while in REVIEW). Grade it; both outcomes auto-advance. */
async function handleAnswer(deps: AppDeps, ctx: MyContext): Promise<void> {
  const review = ctx.session.review;
  if (ctx.session.mode !== 'review' || !review) {
    resetSession(ctx); // desync safety
    return;
  }

  const now = Date.now();
  // Lazy timeout (design-doc.md §5): an abandoned session is closed on the next touch.
  if (sessionExpired(review, now)) {
    await ctx.deleteMessage().catch(() => undefined);
    await closeOnTimeout(ctx, review);
    return;
  }
  review.lastActivity = now;

  const input = (ctx.message?.text ?? '').trim();
  // The answer is the user's input — drop it so only the flow message remains (to-do §UX).
  await ctx.deleteMessage().catch(() => undefined);

  const card = currentCard(review);
  if (!card) {
    await finishSession(ctx, review); // desync → close cleanly
    return;
  }

  const reprompt = (note: string): Promise<unknown> =>
    editFlow(ctx, review.messageId, renderQuestion(card, note), revealKeyboard(card.id));

  // A blank/RU answer must NOT be graded (it would reset SRS); §6: answers are English only.
  if (input === '') {
    await reprompt('⚠️ Пустой ответ — напиши перевод.');
    return;
  }
  if (detectLang(input) === 'ru') {
    await reprompt('⚠️ Отвечай на английском.');
    return;
  }

  // `today` is recomputed here so a long session that crosses midnight still schedules
  // correctly; userId + timezone are snapshotted in the session (stable).
  const today = todayInTz(new Date(now), review.timezone);
  const correct = isCorrect(input, card.english);
  const index = correct ? promote(card.intervalIndex) : reset();

  try {
    await recordOutcome(deps.db, review.userId, card.id, {
      intervalIndex: index,
      nextReview: nextReviewDate(today, index),
      testedAt: new Date(now),
      // A lapse is counted once per session per card (first failure): a re-queued card
      // failed again, or revealed after a wrong answer, must not inflate the counter.
      lapsed: !correct && !review.failedIds.includes(card.id),
    });
  } catch (err) {
    // The write didn't commit — keep the card on screen for a retry (no advance).
    console.error('Failed to record review outcome:', err);
    await reprompt('⚠️ Не удалось сохранить, попробуй ещё раз.');
    return;
  }
  // Keep the in-memory snapshot in sync with the DB: a wrong answer re-queues the card,
  // and when it's graded again later this session the next promote/reset must start from
  // its CURRENT index (e.g. the reset 0), not the stale start-of-session value.
  card.intervalIndex = index;

  await advanceStep(
    ctx,
    review,
    { card, kind: correct ? 'correct' : 'wrong' },
    correct ? { failed: false, retry: false } : { failed: true, retry: true },
  );
}

/** «Показать ответ» — the emergency exit: reveal the answer, count as a lapse, advance. */
async function handleReveal(deps: AppDeps, ctx: MyContext): Promise<void> {
  const review = ctx.session.review;
  if (ctx.session.mode !== 'review' || !review) {
    await ctx.answerCallbackQuery({ text: 'Повторение уже завершено.' });
    return;
  }

  const now = Date.now();
  if (sessionExpired(review, now)) {
    await ctx.answerCallbackQuery({ text: 'Повторение закрыто из-за неактивности.' });
    await closeOnTimeout(ctx, review);
    return;
  }
  review.lastActivity = now;

  const card = currentCard(review);
  if (!card || Number(ctx.match?.[1]) !== card.id) {
    await ctx.answerCallbackQuery({ text: 'Эта карточка уже пройдена.' });
    return;
  }

  const today = todayInTz(new Date(now), review.timezone);
  const index = reset();
  try {
    await recordOutcome(deps.db, review.userId, card.id, {
      intervalIndex: index,
      nextReview: nextReviewDate(today, index),
      testedAt: new Date(now),
      // Once per session: a reveal after an earlier wrong answer must not double-count.
      lapsed: !review.failedIds.includes(card.id),
    });
  } catch (err) {
    console.error('Failed to record review reveal:', err);
    await ctx.answerCallbackQuery({ text: 'Не удалось сохранить, нажми ещё раз.' });
    return;
  }
  card.intervalIndex = index; // keep the snapshot in sync with the DB (see handleAnswer)
  await ctx.answerCallbackQuery();
  // Revealed words leave the queue (no re-ask) but count as a lapse.
  await advanceStep(ctx, review, { card, kind: 'reveal' }, { failed: true, retry: false });
}

/** The unified «повторение» flow (design-doc.md §5). */
export function createReviewFeature(deps: AppDeps): Composer<MyContext> {
  const feature = new Composer<MyContext>();

  // Manual start. The "/repeat" command itself is removed so the chat stays at the
  // single flow message. Identical to the scheduled run — always N words.
  feature.command('repeat', async (ctx) => {
    await ctx.deleteMessage().catch(() => undefined);
    await startSession(deps, ctx, {});
  });

  // The scheduler's «Начать» button reuses the reminder message; same session as /repeat.
  feature.callbackQuery('review:start', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startSession(deps, ctx, { reuseMessageId: ctx.callbackQuery.message?.message_id });
  });

  feature.callbackQuery(/^review:reveal:(\d+)$/, (ctx) => handleReveal(deps, ctx));

  // §6: free text while in REVIEW is the user's answer.
  feature.filter(freeTextIn('review')).on('message:text', (ctx) => handleAnswer(deps, ctx));

  // Non-text strays (sticker, photo, voice, …) are noise — sweep them so only the flow
  // message remains. Never matches a /command, so cross-feature routing is unaffected.
  feature
    .filter(nonTextIn('review'))
    .on('message', (ctx) => ctx.deleteMessage().catch(() => undefined));

  return feature;
}
