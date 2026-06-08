import { Composer, InlineKeyboard } from 'grammy';
import { config } from '../config';
import { freeTextIn, nonTextIn, testExpired, type MyContext, type ReviewState } from '../context';
import { ensureUser, getUserContext } from '../db/users';
import { countWords, nextReviewWord, updateWordSchedule, type ReviewWord } from '../db/words';
import type { AppDeps } from '../deps';
import { todayInTz } from '../lib/dates';
import { escapeHtml } from '../lib/html';
import { nextReviewDate, promote, reset } from '../lib/srs';
import { deleteFlowMessage, editFlow, resetSession } from './flow';
import { discardTest } from './test';

/**
 * Pure session-end check (design-doc.md §5): the session is done once `done` cards
 * reach the session size `total`. Kept side-effect-free so the "session size = N"
 * rule is unit-testable apart from the DB/Telegram plumbing.
 */
export function sessionComplete(done: number, total: number): boolean {
  return done >= total;
}

/**
 * The HIDDEN review card (design-doc.md §5): the prompt side only — Russian word
 * (+ the Russian example as a hint). The English answer is revealed by the
 * «Показать ответ» button (a native spoiler leaks its revealed state across edits
 * of the one session message, so we hide by omission instead). First line: `N/total`.
 */
export function renderReviewQuestion(done: number, total: number, card: ReviewWord): string {
  const lines = [`${done + 1}/${total}`, `<b>${escapeHtml(card.russian)}</b>`];
  if (card.exampleRu) lines.push(`Пример: ${escapeHtml(card.exampleRu)}`);
  return lines.join('\n');
}

/** The REVEALED review card (design-doc.md §5): adds the English answer + example half. */
export function renderReviewAnswer(done: number, total: number, card: ReviewWord): string {
  const lines = [
    `${done + 1}/${total}`,
    `<b>${escapeHtml(card.russian)}</b> — ${escapeHtml(card.english)}`,
  ];
  if (card.exampleRu && card.exampleEn) {
    lines.push(`Пример: ${escapeHtml(card.exampleRu)} — ${escapeHtml(card.exampleEn)}`);
  }
  return lines.join('\n');
}

/** Hidden card: reveal + grade (grading without revealing stays allowed, as with the old spoiler). */
function hiddenKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Показать ответ', `review:reveal:${id}`)
    .row()
    .text('Помню', `review:remember:${id}`)
    .text('Не помню', `review:forget:${id}`);
}

/** Revealed card: just the grade buttons. */
function gradeKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Помню', `review:remember:${id}`)
    .text('Не помню', `review:forget:${id}`);
}

/** Close the session: nothing to show at the end, just delete the flow message (to-do §UX). */
async function finishFlow(ctx: MyContext, review: ReviewState): Promise<void> {
  await deleteFlowMessage(ctx, review.messageId);
  resetSession(ctx);
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

  // Re-entry / cross-mode / desync handling (design-doc.md §8).
  if (ctx.session.mode === 'review') {
    if (ctx.session.review) return; // genuine re-entry: card already on screen, don't restart
    resetSession(ctx); // desync (mode without state) — fall through and start fresh
  } else if (ctx.session.mode === 'test') {
    // Don't clobber a LIVE test; an expired or desynced one is dropped so review can run.
    if (ctx.session.test && !testExpired(ctx.session.test, Date.now())) {
      await ctx.reply('Сейчас идёт тест — заверши его, прежде чем начинать повторение.');
      return;
    }
    await discardTest(ctx);
  }

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
    resetSession(ctx);
    await ctx.reply('В словаре пока нет слов — добавь хотя бы одно.');
    return;
  }

  // max(1, …): a non-empty deck always shows ≥1 card — guards a future
  // review_count = 0 (Phase 6 settings should also validate it; to-do).
  const total = Math.max(1, Math.min(user.reviewCount, deckSize));
  const msg = await ctx.reply(renderReviewQuestion(0, total, first), {
    parse_mode: 'HTML',
    reply_markup: hiddenKeyboard(first.id),
  });
  ctx.session.mode = 'review';
  ctx.session.review = {
    total,
    seenIds: [],
    current: first,
    messageId: msg.message_id,
    userId: user.userId,
    timezone: user.timezone,
  };
}

/** «Показать ответ» — reveal the answer in place (no DB write); the card stays awaiting a grade. */
async function handleReveal(ctx: MyContext): Promise<void> {
  const review = ctx.session.review;
  if (ctx.session.mode !== 'review' || !review || !review.current) {
    await ctx.answerCallbackQuery({ text: 'Эта сессия повторения уже завершена.' });
    return;
  }
  if (Number(ctx.match?.[1]) !== review.current.id) {
    await ctx.answerCallbackQuery({ text: 'Эта карточка уже пройдена.' });
    return;
  }
  await ctx.answerCallbackQuery();
  await editFlow(
    ctx,
    review.messageId,
    renderReviewAnswer(review.seenIds.length, review.total, review.current),
    gradeKeyboard(review.current.id),
  );
}

/** A grade button was pressed — apply SRS, then edit the flow message to the next card. */
async function handlePress(deps: AppDeps, ctx: MyContext): Promise<void> {
  const review = ctx.session.review;
  if (ctx.session.mode !== 'review' || !review || !review.current) {
    await ctx.answerCallbackQuery({ text: 'Эта сессия повторения уже завершена.' });
    return;
  }

  const remembered = ctx.match?.[1] === 'remember';
  const card = review.current;
  if (Number(ctx.match?.[2]) !== card.id) {
    await ctx.answerCallbackQuery({ text: 'Эта карточка уже пройдена.' });
    return;
  }

  // userId + timezone are snapshotted in the session (stable); `today` is recomputed
  // here so a long session that crosses midnight still schedules correctly. The
  // current card carries `intervalIndex`, so no DB re-fetch is needed to grade.
  const today = todayInTz(new Date(), review.timezone);
  try {
    const index = remembered ? promote(card.intervalIndex) : reset();
    await updateWordSchedule(deps.db, review.userId, card.id, index, nextReviewDate(today, index));
  } catch (err) {
    // The write didn't commit — keep the card (current unchanged) for a retry.
    console.error('Failed to apply review outcome:', err);
    await ctx.answerCallbackQuery({ text: 'Не удалось сохранить, нажми ещё раз.' });
    return;
  }
  await ctx.answerCallbackQuery();

  // Card consumed: record it (counts toward the session AND excludes it from the
  // next pick) and drop `current` BEFORE advancing so a stale/double press can't
  // re-grade it.
  review.seenIds.push(card.id);
  review.current = null;

  // Advance. If loading the next card throws (transient DB error in this narrow
  // window), end the session cleanly instead of leaving it stuck with no current
  // card — the grade above is already committed, and `/repeat` resumes.
  try {
    const next = sessionComplete(review.seenIds.length, review.total)
      ? null
      : await nextReviewWord(deps.db, review.userId, review.seenIds);
    if (!next) {
      await finishFlow(ctx, review);
      return;
    }
    review.current = next;
    await editFlow(
      ctx,
      review.messageId,
      renderReviewQuestion(review.seenIds.length, review.total, next),
      hiddenKeyboard(next.id),
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

  feature.callbackQuery(/^review:reveal:(\d+)$/, (ctx) => handleReveal(ctx));
  feature.callbackQuery(/^review:(remember|forget):(\d+)$/, (ctx) => handlePress(deps, ctx));

  // §5 collision: free text during review is noise (no adding words mid-review).
  // The card already lives in the flow message, so we silently delete the stray
  // text — nothing is sent back (to-do §UX).
  feature.filter(freeTextIn('review')).on('message:text', async (ctx) => {
    await ctx.deleteMessage().catch(() => undefined);
    if (!ctx.session.review) resetSession(ctx); // desync safety
  });

  // Non-text strays (sticker, photo, voice, …) are noise too — sweep them so only
  // the flow message remains. Commands/text are handled above; this never matches
  // a /command (it has text), so cross-feature command routing is unaffected. (§UX)
  feature
    .filter(nonTextIn('review'))
    .on('message', (ctx) => ctx.deleteMessage().catch(() => undefined));

  return feature;
}
