import { Composer } from 'grammy';
import { freeTextIn, type MyContext } from '../context';
import type { AppDeps } from '../deps';

/** Daily review flow — STUB (design-doc.md §5). */
export function createReviewFeature(_deps: AppDeps): Composer<MyContext> {
  const feature = new Composer<MyContext>();

  feature.command('repeat', async (ctx) => {
    await ctx.reply(
      'TODO: повторение — слова due, спойлер-перевод, «Помню/Не помню» (design-doc.md §5)',
    );
  });

  // §5: any free text while in REVIEW re-shows the current card.
  feature.filter(freeTextIn('review')).on('message:text', async (ctx) => {
    await ctx.reply('TODO: повторение — повторно показать текущую карточку (design-doc.md §5)');
  });

  // «Помню» / «Не помню» button presses.
  feature.callbackQuery(/^review:(remember|forget):\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    // TODO: update SRS for the word, send the next card.
  });

  return feature;
}
