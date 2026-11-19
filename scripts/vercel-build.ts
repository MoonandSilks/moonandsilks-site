// Vercel runs `npm run vercel-build`. On production deploys, pending SQL migrations in ./drizzle are applied
// before the build, so the live database always matches the code. Migrations run once each and are tracked,
// so redeploys are safe. Preview deploys skip this and never write to the database.
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, getDb } from '../src/lib/db/client';

if (process.env.VERCEL_ENV !== 'production') {
  console.log(`Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}).`);
} else {
  await migrate(getDb(), { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
  await closeDb();
}
