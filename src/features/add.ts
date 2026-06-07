import { Composer } from 'grammy';
import { freeTextIn, type MyContext } from '../context';
import type { AppDeps } from '../deps';

/**
 * Add-word flow — STUB (design-doc.md §4). Active only in IDLE: free text is a
 * new word. Detect lang → dictionary lookup → sense choice → LLM example → save.
 */
export function createAddFeature(_deps: AppDeps): Composer<MyContext> {
  const feature = new Composer<MyContext>();

  feature.filter(freeTextIn('idle')).on('message:text', async (ctx) => {
    await ctx.reply(
      'TODO: добавление слова — детект языка → словарь → выбор смысла → пример → сохранение (design-doc.md §4)',
    );
  });

  return feature;
}
