import { Composer } from 'grammy';
import { freeTextIn, type MyContext } from '../context';
import type { AppDeps } from '../deps';

/** Testing flow — STUB (design-doc.md §6). */
export function createTestFeature(_deps: AppDeps): Composer<MyContext> {
  const feature = new Composer<MyContext>();

  feature.command('test', async (ctx) => {
    await ctx.reply(
      'TODO: тестирование — RU→EN, детерминированный грейдинг, цикл до верного (design-doc.md §6)',
    );
  });

  // §6: free text while in TEST is the user's answer.
  feature.filter(freeTextIn('test')).on('message:text', async (ctx) => {
    await ctx.reply('TODO: тест — проверить ответ (design-doc.md §6)');
  });

  return feature;
}
