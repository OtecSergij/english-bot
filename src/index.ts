import { createBot, setupCommands } from './bot';
import { closeDb } from './db';
import { startScheduler } from './services/scheduler';

async function main(): Promise<void> {
  const bot = createBot();
  await setupCommands(bot);
  const stopScheduler = startScheduler(bot);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down…`);
    stopScheduler();
    await bot.stop();
    await closeDb();
    process.exit(0);
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
