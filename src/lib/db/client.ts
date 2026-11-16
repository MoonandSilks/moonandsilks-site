import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

type DB = ReturnType<typeof drizzle<typeof schema>>;
let cached: { db: DB; client: postgres.Sql } | undefined;

/** One small pool per serverless instance. `prepare: false` keeps it compatible with Neon's pooler. */
export function getDb(): DB {
  if (!cached) {
    const url = env.databaseUrl;
    if (!url) throw new Error('DATABASE_URL is not set');
    const client = postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 3), prepare: false, idle_timeout: 20 });
    cached = { db: drizzle(client, { schema }), client };
  }
  return cached.db;
}

export async function closeDb() {
  await cached?.client.end();
  cached = undefined;
}

export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export { schema };
