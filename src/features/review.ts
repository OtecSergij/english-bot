import { Composer } from 'grammy';
import type { MyContext } from '../context';

/** Daily review flow — STUB (design-doc.md §5). */
export const reviewFeature = new Composer<MyContext>();

reviewFeature.command('repeat', async (ctx) => {
  await ctx.reply(
    'TODO: повторение — слова due, спойлер-перевод, «Помню/Не помню» (design-doc.md §5)',
  );
});

// «Помню» / «Не помню» button presses.
reviewFeature.callbackQuery(/^review:(remember|forget):\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  // TODO: update SRS for the word, send the next card.
});
