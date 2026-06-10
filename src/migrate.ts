import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Startup migrator (to-do «Прод / деплой»): the container entrypoint runs this
// before the bot and fails fast on error, so the bot never starts against a stale
// schema. Uses drizzle-orm's programmatic migrator over the same `drizzle/` folder
// and journal table as dev's `drizzle-kit migrate` — no drizzle-kit in the image.
//
// Deliberately reads DATABASE_URL itself instead of importing config.ts: config
// validates the FULL env (bot token, LLM keys, …), while migrating needs only the
// database — keeping this step's failure surface to exactly that.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
try {
  // Path is CWD-relative; the image runs from /app, which holds `drizzle/`.
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  console.log('Migrations applied');
} finally {
  await pool.end();
}
