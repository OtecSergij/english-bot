import { Bot, session } from 'grammy';
import { conversations } from '@grammyjs/conversations';
import { config } from './config';
import {
  initialSession,
  type BaseContext,
  type MyContext,
  type MyConversationContext,
} from './context';
import { ensureUser } from './db/users';
import type { AppDeps } from './deps';
import { createAddFeature } from './features/add';
import { createReviewFeature } from './features/review';
import { createSettingsFeature } from './features/settings';
import { createTestFeature } from './features/test';

export function createBot(deps: AppDeps): Bot<MyContext> {
  const bot = new Bot<MyContext>(config.botToken);

  // Single-user whitelist — the only security boundary (design-doc.md §2).
  bot.use(async (ctx, next) => {
    if (ctx.chat?.id !== config.ownerChatId) return;
    await next();
  });

  bot.use(session({ initial: initialSession }));
  // Conversations power the multi-step add-word flow (design-doc.md §4). Must be
  // installed after session and before any createConversation() in the features.
  bot.use(conversations<BaseContext, MyConversationContext>());

  bot.catch((err) => {
    console.error(`Error handling update ${err.ctx.update.update_id}:`, err.error);
  });

  // /start provisions the user row + default settings (design-doc.md §2).
  bot.command('start', async (ctx) => {
    if (ctx.chat) await ensureUser(deps.db, ctx.chat.id, config.ownerTz);
    await ctx.reply('Привет! Пришли слово (рус/англ), чтобы добавить его в словарь.');
  });

  // Commands resolve inside each feature; mode-gated free text excludes commands,
  // so a command is never swallowed by another mode's text handler (design-doc.md §8).
  bot.use(createReviewFeature(deps));
  bot.use(createTestFeature(deps));
  bot.use(createSettingsFeature(deps));
  bot.use(createAddFeature(deps));

  return bot;
}

export async function setupCommands(bot: Bot<MyContext>): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'repeat', description: 'Повторение' },
    { command: 'test', description: 'Тестирование' },
    { command: 'settings', description: 'Настройки' },
  ]);
}
