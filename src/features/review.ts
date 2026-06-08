import { Composer, InlineKeyboard } from 'grammy';
import { config } from '../config';
import { freeTextIn, type MyContext, type ReviewState } from '../context';
import { ensureUser, getUserContext } from '../db/users';
import {
  countWords,
  nextReviewWord,
  updateWordSchedule,
  wordById,
  type ReviewWord,
} from '../db/words';
import type { AppDeps } from '../deps';
import { todayInTz } from '../lib/dates';
import { escapeHtml } from '../lib/html';
import { nextReviewDate, promote, reset } from '../lib/srs';

/**
 * Pure session-end check (design-doc.md §5): the session is done once `done` cards
 * reach the session size `total`. Kept side-effect-free so the "session size = N"
 * rule is unit-testable apart from the DB/Telegram plumbing.
 */
export function sessionComplete(done: number, total: number): boolean {
  return done >= total;
}

/**
 * Render a review card (design-doc.md §5). The answer and the example's English
 * half are blurred with a native spoiler so you recall before revealing:
 *
 *   дом: ▒▒▒▒▒
 *   Пример: Мой дом большой. — ▒▒▒▒▒▒▒▒▒▒▒
 */
export function renderReviewCard(card: ReviewWord): string {
  const lines = [
    `<b>${escapeHtml(card.russian)}</b>: <tg-spoiler>${escapeHtml(card.english)}</tg-spoiler>`,
  ];
  if (card.exampleRu && card.exampleEn) {
    lines.push(
      `Пример: ${escapeHtml(card.exampleRu)} — <tg-spoiler>${escapeHtml(card.exampleEn)}</tg-spoiler>`,
    );
  }
  return lines.join('\n');
}

/** The card with its `step/total` progress header (the single message's contents). */
function renderStep(done: number, total: number, card: ReviewWord): string {
  return `${done + 1}/${total}\n${renderReviewCard(card)}`;
}

function reviewKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Помню', `review:remember:${id}`)
    .text('Не помню', `review:forget:${id}`);
}

/** Edit the single flow message (the whole session lives in it). Best-effort. */
function editFlow(
  ctx: MyContext,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<unknown> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return Promise.resolve(undefined);
  return ctx.api
    .editMessageText(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard })
    .catch(() => undefined);
}

function endSession(ctx: MyContext): void {
  ctx.session.mode = 'idle';
  ctx.session.review = undefined;
}

/** Close the session: nothing to show at the end, just delete the flow message (to-do §UX). */
async function finishFlow(ctx: MyContext, review: ReviewState): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId !== undefined) {
    await ctx.api.deleteMessage(chatId, review.messageId).catch(() => undefined);
  }
  endSession(ctx);
}

/**
 * Start a review session (design-doc.md §5). Review is ALWAYS available: it pulls
 * the N words with the smallest `next_review` (no due gate), N = min(review_count,
 * deck size). The whole session lives in one message. Manual entry for `/repeat`;
 * the scheduler reuses this in Phase 5.
 */
async function startReview(deps: AppDeps, ctx: MyContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  // Re-entering mid-session must NOT restart (that would reset the seen-set / size).
  // The card is already on screen, so do nothing. (Phase 4: a guard for
  // `mode === 'test'` belongs with the test flow.)
  if (ctx.session.mode === 'review') return;

  // Provision on entry (covers a fresh owner / DB reset), then read settings.
  await ensureUser(deps.db, chatId, config.ownerTz);
  const user = await getUserContext(deps.db, chatId);
  if (!user) {
    await ctx.reply('Не удалось открыть повторение. Попробуй позже.');
    return;
  }

  const deckSize = await countWords(deps.db, user.userId);
  const first = deckSize > 0 ? await nextReviewWord(deps.db, user.userId, []) : null;
  if (!first) {
    endSession(ctx);
    await ctx.reply('В словаре пока нет слов — добавь хотя бы одно.');
    return;
  }

  // max(1, …): a non-empty deck always shows ≥1 card — guards a future
  // review_count = 0 (Phase 6 settings should also validate it; to-do).
  const total = Math.max(1, Math.min(user.reviewCount, deckSize));
  const msg = await ctx.reply(renderStep(0, total, first), {
    parse_mode: 'HTML',
    reply_markup: reviewKeyboard(first.id),
  });
  ctx.session.mode = 'review';
  ctx.session.review = { total, seenIds: [], currentWordId: first.id, messageId: msg.message_id };
}

/** A grade button was pressed — apply SRS, then edit the flow message to the next card. */
async function handlePress(deps: AppDeps, ctx: MyContext): Promise<void> {
  const review = ctx.session.review;
  if (ctx.session.mode !== 'review' || !review) {
    await ctx.answerCallbackQuery({ text: 'Эта сессия повторения уже завершена.' });
    return;
  }

  const remembered = ctx.match?.[1] === 'remember';
  const pressedId = Number(ctx.match?.[2]);
  if (review.currentWordId === null || pressedId !== review.currentWordId) {
    await ctx.answerCallbackQuery({ text: 'Эта карточка уже пройдена.' });
    return;
  }

  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    await ctx.answerCallbackQuery();
    return;
  }
  const user = await getUserContext(deps.db, chatId);
  if (!user) {
    await ctx.answerCallbackQuery();
    await finishFlow(ctx, review);
    return;
  }
  const today = todayInTz(new Date(), user.timezone);

  try {
    const word = await wordById(deps.db, user.userId, pressedId);
    if (word) {
      const index = remembered ? promote(word.intervalIndex) : reset();
      await updateWordSchedule(deps.db, user.userId, pressedId, index, nextReviewDate(today, index));
    }
  } catch (err) {
    // The write didn't commit — keep the card (currentWordId unchanged) for a retry.
    console.error('Failed to apply review outcome:', err);
    await ctx.answerCallbackQuery({ text: 'Не удалось сохранить, нажми ещё раз.' });
    return;
  }
  await ctx.answerCallbackQuery();

  // Card consumed: record it (counts toward the session AND excludes it from the
  // next pick) and drop currentWordId BEFORE advancing so a stale/double press
  // can't re-grade it.
  review.seenIds.push(pressedId);
  review.currentWordId = null;

  // Advance. If loading the next card throws (transient DB error in this narrow
  // window), end the session cleanly instead of leaving it stuck with no current
  // card — the grade above is already committed, and `/repeat` resumes.
  try {
    const next = sessionComplete(review.seenIds.length, review.total)
      ? null
      : await nextReviewWord(deps.db, user.userId, review.seenIds);
    if (!next) {
      await finishFlow(ctx, review);
      return;
    }
    review.currentWordId = next.id;
    await editFlow(
      ctx,
      review.messageId,
      renderStep(review.seenIds.length, review.total, next),
      reviewKeyboard(next.id),
    );
  } catch (err) {
    console.error('Failed to advance review:', err);
    await finishFlow(ctx, review);
  }
}

/** Daily review flow (design-doc.md §5). */
export function createReviewFeature(deps: AppDeps): Composer<MyContext> {
  const feature = new Composer<MyContext>();

  // Manual start. The "/repeat" command itself is removed so the chat stays at the
  // single flow message. (Marking today's scheduled review as skipped: Phase 5.)
  feature.command('repeat', async (ctx) => {
    await ctx.deleteMessage().catch(() => undefined);
    await startReview(deps, ctx);
  });

  feature.callbackQuery(/^review:(remember|forget):(\d+)$/, (ctx) => handlePress(deps, ctx));

  // §5 collision: free text during review is noise (no adding words mid-review).
  // The card already lives in the flow message, so we silently delete the stray
  // text — nothing is sent back (to-do §UX).
  feature.filter(freeTextIn('review')).on('message:text', async (ctx) => {
    await ctx.deleteMessage().catch(() => undefined);
    if (!ctx.session.review) endSession(ctx); // desync safety
  });

  return feature;
}
