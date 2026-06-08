import { Composer, InlineKeyboard } from 'grammy';
import { config } from '../config';
import { freeTextIn, nonTextIn, testExpired, type MyContext, type TestState } from '../context';
import { ensureUser, getUserContext } from '../db/users';
import { markTested, recordTestFailure, testWords, type TestCard } from '../db/words';
import type { AppDeps } from '../deps';
import { todayInTz } from '../lib/dates';
import { isCorrect } from '../lib/grading';
import { escapeHtml } from '../lib/html';
import { detectLang } from '../lib/lang';
import { nextReviewDate, reset } from '../lib/srs';
import { deleteFlowMessage, editFlow, resetSession } from './flow';

// ---------------------------------------------------------------------------
// Pure helpers (no DB / Telegram) — the heart of the cycle, unit-tested apart.
// ---------------------------------------------------------------------------

/** The remaining-cards cycle (design-doc.md §6). The current card is always `queue[0]`. */
export interface TestProgress {
  queue: number[];
  failedIds: number[];
}

/**
 * Apply one graded outcome to the cycle (design-doc.md §6):
 * - `retry` → the current card goes to the back (re-asked until correct);
 * - otherwise it leaves the queue (correct, or revealed/skipped);
 * - `failed` records the id (deduped) — the score, and it's already reset in the DB.
 *
 * Correct = `{failed:false, retry:false}`; wrong = `{failed:true, retry:true}`;
 * reveal = `{failed:true, retry:false}`.
 */
export function applyOutcome(
  p: TestProgress,
  outcome: { failed: boolean; retry: boolean },
): TestProgress {
  const [current, ...rest] = p.queue;
  if (current === undefined) return p;
  const queue = outcome.retry ? [...rest, current] : rest;
  const failedIds =
    outcome.failed && !p.failedIds.includes(current) ? [...p.failedIds, current] : p.failedIds;
  return { queue, failedIds };
}

/** The session ends once every word has left the cycle (correct or revealed). */
export function testComplete(queue: number[]): boolean {
  return queue.length === 0;
}

/**
 * A test question (design-doc.md §6): `done/total`, an optional ⚠️ note (e.g. wrong
 * input language), then the Russian prompt. The answer is NOT shown here — it's
 * revealed in place after an answer/«Показать ответ» (see `renderResult`).
 */
export function renderQuestion(
  done: number,
  total: number,
  russian: string,
  note?: string,
): string {
  const lines = [`${done}/${total}`];
  if (note) lines.push('', note);
  lines.push('', `<b>${escapeHtml(russian)}</b>`, 'Напиши перевод на английский:');
  return lines.join('\n');
}

/** The in-place result screen shown after an answer / reveal, with a «Дальше» button. */
export function renderResult(done: number, total: number, line: string): string {
  return `${done}/${total}\n\n${line}`;
}

/** End-of-session summary — kept in the chat as the test result (to-do §UX). */
export function renderSummary(total: number, failed: TestCard[]): string {
  const correct = total - failed.length;
  if (failed.length === 0) return `✅ Тест пройден: ${correct}/${total}. Отлично!`;
  const list = failed
    .map((w) => `• ${escapeHtml(w.russian)} → ${escapeHtml(w.english)}`)
    .join('\n');
  return `Тест завершён: ${correct}/${total} верно.\nНа повторение ушли:\n${list}`;
}

/** Prompt — answer, both quoted: the shared shape for revealing a card. */
function answerLine(card: TestCard): string {
  return `«${escapeHtml(card.russian)}» — «${escapeHtml(card.english)}»`;
}

/** Wrong answer: show the correct answer right away (learning mode); the word is still re-queued. */
export function wrongFeedback(card: TestCard): string {
  return `❌ Не правильно. ${answerLine(card)}`;
}

/** Reveal/skip — the emergency exit: same answer line, counts as a failure. */
export function revealFeedback(card: TestCard): string {
  return `Ответ: ${answerLine(card)}`;
}

// ---------------------------------------------------------------------------
// Session plumbing
// ---------------------------------------------------------------------------

function revealKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard().text('Показать ответ', `test:reveal:${id}`);
}

function nextKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Дальше →', 'test:next');
}

function currentCard(test: TestState): TestCard | undefined {
  return test.cards.find((c) => c.id === test.queue[0]);
}

/**
 * Drop a test session and remove its dangling flow message (timed out, desynced, or
 * pre-empted by a review start). Exported so review can clear a stale test on entry
 * — one place owns "abandon a test". Safe when there is no test state.
 */
export async function discardTest(ctx: MyContext): Promise<void> {
  if (ctx.session.test) await deleteFlowMessage(ctx, ctx.session.test.messageId);
  resetSession(ctx);
}

/** Edit the flow message to the timeout note and close the session (design-doc.md §6). */
async function closeOnTimeout(ctx: MyContext, test: TestState): Promise<void> {
  await editFlow(ctx, test.messageId, '⏱ Тест закрыт из-за неактивности. /test — начать заново.');
  resetSession(ctx);
}

/** Apply an outcome to the queue, then show the next question or the kept summary. */
async function advanceQueue(
  ctx: MyContext,
  test: TestState,
  outcome: { failed: boolean; retry: boolean },
): Promise<void> {
  const next = applyOutcome({ queue: test.queue, failedIds: test.failedIds }, outcome);
  test.queue = next.queue;
  test.failedIds = next.failedIds;

  const card = currentCard(test);
  if (testComplete(test.queue) || !card) {
    const failed = test.failedIds
      .map((id) => test.cards.find((c) => c.id === id))
      .filter((c): c is TestCard => c !== undefined);
    await editFlow(ctx, test.messageId, renderSummary(test.cards.length, failed));
    resetSession(ctx);
    return;
  }
  const done = test.cards.length - test.queue.length;
  await editFlow(
    ctx,
    test.messageId,
    renderQuestion(done, test.cards.length, card.russian),
    revealKeyboard(card.id),
  );
}

/**
 * Start a test session (design-doc.md §6). Tests run only on demand (no scheduler).
 * The selection (not-due words, snapshotted) lives in one message we keep editing.
 */
async function startTest(deps: AppDeps, ctx: MyContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  const now = Date.now();
  // Don't clobber an active session (design-doc.md §8).
  if (ctx.session.mode === 'test') {
    // Block only a LIVE test; an expired or desynced (mode without state) one is dropped.
    if (ctx.session.test && !testExpired(ctx.session.test, now)) {
      await ctx.reply('Тест уже идёт.');
      return;
    }
    await discardTest(ctx); // expired/desync test → drop it and its dangling message
  } else if (ctx.session.mode === 'review') {
    if (ctx.session.review) {
      await ctx.reply('Сейчас идёт повторение — заверши его, прежде чем запускать тест.');
      return;
    }
    resetSession(ctx); // desync: mode says review but no state — clear and proceed
  }

  // Provision on entry (covers a fresh owner / DB reset), then read settings.
  await ensureUser(deps.db, chatId, config.ownerTz);
  const user = await getUserContext(deps.db, chatId);
  if (!user) {
    await ctx.reply('Не удалось открыть тест. Попробуй позже.');
    return;
  }

  const today = todayInTz(new Date(now), user.timezone);
  // Defense-in-depth: settings already validate test_count >= 1 (lib/settings), so
  // this only guards a hand-edited/legacy row from degenerating the session.
  const limit = Math.max(1, user.testCount);
  const cards = await testWords(deps.db, user.userId, today, limit);
  if (cards.length === 0) {
    resetSession(ctx);
    await ctx.reply(
      'Пока нечего тестировать: тест проверяет слова, отложенные «как знаю» (их срок повторения ещё впереди). Поучи слова в повторении — /repeat.',
    );
    return;
  }

  const first = cards[0]!;
  const msg = await ctx.reply(renderQuestion(0, cards.length, first.russian), {
    parse_mode: 'HTML',
    reply_markup: revealKeyboard(first.id),
  });
  ctx.session.mode = 'test';
  ctx.session.test = {
    messageId: msg.message_id,
    cards,
    queue: cards.map((c) => c.id),
    failedIds: [],
    lastActivity: now,
    userId: user.userId,
    timezone: user.timezone,
    pending: null,
  };
}

/** A typed answer (free text while in TEST). Grade it; correct auto-advances, wrong shows the answer. */
async function handleAnswer(deps: AppDeps, ctx: MyContext): Promise<void> {
  const test = ctx.session.test;
  if (ctx.session.mode !== 'test' || !test) {
    resetSession(ctx); // desync safety
    return;
  }

  const now = Date.now();
  // Lazy timeout (design-doc.md §6): an abandoned session is closed on the next touch.
  if (testExpired(test, now)) {
    await ctx.deleteMessage().catch(() => undefined);
    await closeOnTimeout(ctx, test);
    return;
  }
  test.lastActivity = now;

  // Answer-shown state: the answer is on screen with «Дальше» — typed text is noise.
  if (test.pending) {
    await ctx.deleteMessage().catch(() => undefined);
    return;
  }

  const input = (ctx.message?.text ?? '').trim();
  // The answer is the user's input — drop it so only the flow message remains (to-do §UX).
  await ctx.deleteMessage().catch(() => undefined);

  const card = currentCard(test);
  if (!card) {
    await advanceQueue(ctx, test, { failed: false, retry: false }); // desync → close cleanly
    return;
  }

  const done = test.cards.length - test.queue.length;
  const reprompt = (note: string): Promise<unknown> =>
    editFlow(
      ctx,
      test.messageId,
      renderQuestion(done, test.cards.length, card.russian, note),
      revealKeyboard(card.id),
    );

  // A blank answer must NOT be graded (it would reset SRS); §6: answers are English only.
  if (input === '') {
    await reprompt('⚠️ Пустой ответ — напиши перевод.');
    return;
  }
  if (detectLang(input) === 'ru') {
    await reprompt('⚠️ Отвечай на английском.');
    return;
  }

  // userId + timezone are snapshotted in the session (stable); `today` is recomputed
  // here so a long session that crosses midnight still schedules correctly.
  const today = todayInTz(new Date(now), test.timezone);
  const correct = isCorrect(input, card.english);

  try {
    if (correct) {
      await markTested(deps.db, test.userId, card.id, new Date(now));
    } else {
      const index = reset();
      await recordTestFailure(
        deps.db,
        test.userId,
        card.id,
        index,
        nextReviewDate(today, index),
        new Date(now),
      );
    }
  } catch (err) {
    // The write didn't commit — keep the card on screen for a retry (no advance).
    console.error('Failed to record test outcome:', err);
    await reprompt('⚠️ Не удалось сохранить, попробуй ещё раз.');
    return;
  }

  if (correct) {
    // Auto-advance — the counter ticking up is the signal, no «Дальше» needed.
    await advanceQueue(ctx, test, { failed: false, retry: false });
    return;
  }
  // Wrong → show the answer in place; the word is re-queued once «Дальше» is pressed.
  test.pending = { failed: true, retry: true };
  await editFlow(
    ctx,
    test.messageId,
    renderResult(done, test.cards.length, wrongFeedback(card)),
    nextKeyboard(),
  );
}

/** «Показать ответ» — the emergency exit: reveal the answer in place, count as a failure. */
async function handleReveal(deps: AppDeps, ctx: MyContext): Promise<void> {
  const test = ctx.session.test;
  if (ctx.session.mode !== 'test' || !test) {
    await ctx.answerCallbackQuery({ text: 'Тест уже завершён.' });
    return;
  }

  const now = Date.now();
  if (testExpired(test, now)) {
    await ctx.answerCallbackQuery({ text: 'Тест закрыт из-за неактивности.' });
    await closeOnTimeout(ctx, test);
    return;
  }
  test.lastActivity = now;

  if (test.pending) {
    await ctx.answerCallbackQuery(); // answer already shown — wait for «Дальше»
    return;
  }

  const card = currentCard(test);
  if (!card || Number(ctx.match?.[1]) !== card.id) {
    await ctx.answerCallbackQuery({ text: 'Эта карточка уже пройдена.' });
    return;
  }

  const today = todayInTz(new Date(now), test.timezone);
  try {
    const index = reset();
    await recordTestFailure(
      deps.db,
      test.userId,
      card.id,
      index,
      nextReviewDate(today, index),
      new Date(now),
    );
  } catch (err) {
    console.error('Failed to record test reveal:', err);
    await ctx.answerCallbackQuery({ text: 'Не удалось сохранить, нажми ещё раз.' });
    return;
  }
  await ctx.answerCallbackQuery();

  const done = test.cards.length - test.queue.length;
  // Revealed words leave the queue (no re-ask) once «Дальше» is pressed.
  test.pending = { failed: true, retry: false };
  await editFlow(
    ctx,
    test.messageId,
    renderResult(done, test.cards.length, revealFeedback(card)),
    nextKeyboard(),
  );
}

/** «Дальше» — apply the pending outcome to the queue and show the next question / summary. */
async function handleNext(ctx: MyContext): Promise<void> {
  const test = ctx.session.test;
  if (ctx.session.mode !== 'test' || !test) {
    await ctx.answerCallbackQuery({ text: 'Тест уже завершён.' });
    return;
  }

  const now = Date.now();
  if (testExpired(test, now)) {
    await ctx.answerCallbackQuery({ text: 'Тест закрыт из-за неактивности.' });
    await closeOnTimeout(ctx, test);
    return;
  }
  test.lastActivity = now;

  if (!test.pending) {
    await ctx.answerCallbackQuery(); // stale «Дальше» — nothing pending
    return;
  }
  await ctx.answerCallbackQuery();
  const outcome = test.pending;
  test.pending = null;
  await advanceQueue(ctx, test, outcome);
}

/** Testing flow (design-doc.md §6). */
export function createTestFeature(deps: AppDeps): Composer<MyContext> {
  const feature = new Composer<MyContext>();

  // Manual start. The "/test" command itself is removed so the chat stays at the
  // single flow message (like /repeat).
  feature.command('test', async (ctx) => {
    await ctx.deleteMessage().catch(() => undefined);
    await startTest(deps, ctx);
  });

  feature.callbackQuery(/^test:reveal:(\d+)$/, (ctx) => handleReveal(deps, ctx));
  feature.callbackQuery(/^test:next$/, (ctx) => handleNext(ctx));

  // §6: free text while in TEST is the user's answer.
  feature.filter(freeTextIn('test')).on('message:text', (ctx) => handleAnswer(deps, ctx));

  // Non-text strays (sticker, photo, voice, …) are noise — sweep them so only the
  // flow message remains. Never matches a /command (it has text), so cross-feature
  // command routing is unaffected. (§UX)
  feature
    .filter(nonTextIn('test'))
    .on('message', (ctx) => ctx.deleteMessage().catch(() => undefined));

  return feature;
}
