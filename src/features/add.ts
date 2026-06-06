import { Composer } from 'grammy';
import type { MyContext } from '../context';

/** Add-word flow — STUB (design-doc.md §4). */
export const addFeature = new Composer<MyContext>();

// In IDLE, free text is a new word to add.
addFeature.on('message:text', async (ctx) => {
  await ctx.reply(
    'TODO: добавление слова — детект языка → словарь → выбор смысла → пример → сохранение (design-doc.md §4)',
  );
});
