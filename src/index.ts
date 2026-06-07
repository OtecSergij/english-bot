import { createBot, setupCommands } from './bot';
import { config } from './config';
import { closeDb } from './db';
import { ensureUser } from './db/users';
import { createDeps } from './deps';
import { startScheduler } from './services/scheduler';

async function main(): Promise<void> {
  const deps = createDeps();
  const bot = createBot(deps);

  // Ensure the owner exists even before their first /start (design-doc.md §2).
  await ensureUser(deps.db, config.ownerChatId, config.ownerTz);

  await setupCommands(bot);
  const stopScheduler = startScheduler(bot);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down…`);
    try {
      stopScheduler();
      await bot.stop();
      await closeDb();
    } catch (error) {
      console.error('Error during shutdown:', error);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('Bot starting (long polling)…');
  await bot.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
