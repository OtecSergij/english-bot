import { Composer } from 'grammy';
import type { MyContext } from '../context';

/** Testing flow — STUB (design-doc.md §6). */
export const testFeature = new Composer<MyContext>();

testFeature.command('test', async (ctx) => {
  await ctx.reply(
    'TODO: тестирование — RU→EN, детерминированный грейдинг, цикл до верного (design-doc.md §6)',
  );
});
