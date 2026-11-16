// Applies SQL migrations in ./drizzle to DATABASE_URL.
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, getDb } from '../src/lib/db/client';

await migrate(getDb(), { migrationsFolder: './drizzle' });
console.log('Migrations applied.');
await closeDb();
