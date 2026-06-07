import { Composer } from 'grammy';
import type { MyContext } from '../context';
import type { AppDeps } from '../deps';

/** Settings — STUB (design-doc.md §9). */
export function createSettingsFeature(_deps: AppDeps): Composer<MyContext> {
  const feature = new Composer<MyContext>();

  feature.command('settings', async (ctx) => {
    await ctx.reply(
      'TODO: настройки — кол-во слов на повторение, время повторения, кол-во на тест (design-doc.md §9)',
    );
  });

  return feature;
}
