import { Bot, session } from 'grammy';
import { config } from './config';
import { initialSession, type MyContext } from './context';
import { addFeature } from './features/add';
import { reviewFeature } from './features/review';
import { settingsFeature } from './features/settings';
import { testFeature } from './features/test';

export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(config.botToken);

  // Single-user whitelist (design-doc.md §2).
  bot.use(async (ctx, next) => {
    if (ctx.chat?.id !== config.ownerChatId) return;
    await next();
  });

  bot.use(session({ initial: initialSession }));

  bot.command('start', async (ctx) => {
    await ctx.reply('Привет! Пришли слово (рус/англ), чтобы добавить его в словарь.');
  });

  // Commands first, then free-text add.
  bot.use(reviewFeature);
  bot.use(testFeature);
  bot.use(settingsFeature);
  bot.use(addFeature);

  return bot;
}

export async function setupCommands(bot: Bot<MyContext>): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'repeat', description: 'Повторение' },
    { command: 'test', description: 'Тестирование' },
    { command: 'settings', description: 'Настройки' },
  ]);
}
