import { createBot, setupCommands } from './bot';
import { startScheduler } from './services/scheduler';

async function main(): Promise<void> {
  const bot = createBot();
  await setupCommands(bot);
  startScheduler(bot);

  console.log('Bot starting (long polling)…');
  await bot.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
