import { Composer } from 'grammy';
import type { MyContext } from '../context';

/** Settings — STUB (design-doc.md §9). */
export const settingsFeature = new Composer<MyContext>();

settingsFeature.command('settings', async (ctx) => {
  await ctx.reply(
    'TODO: настройки — кол-во слов на повторение, время повторения, кол-во на тест (design-doc.md §9)',
  );
});
