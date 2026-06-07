import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

const pool = new Pool({ connectionString: config.databaseUrl });

// An idle client can emit 'error'; without a listener that crashes the process.
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;

export async function closeDb(): Promise<void> {
  await pool.end();
}
