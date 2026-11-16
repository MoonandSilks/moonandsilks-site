// Seeds the nine 2026 sessions and the current waiver wording. Safe to run more than once.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { closeDb, getDb, schema } from '../src/lib/db/client';
import { SEED_SESSIONS } from '../src/lib/sessions-seed';
import { WAIVER_TEXT, WAIVER_VERSION } from '../src/lib/waiver-text';

const db = getDb();
for (const s of SEED_SESSIONS) {
  await db
    .insert(schema.classSessions)
    .values(s)
    .onConflictDoUpdate({
      target: schema.classSessions.slug,
      set: { startsAt: s.startsAt, ageGroup: s.ageGroup, ageMin: s.ageMin, ageMax: s.ageMax, capacity: s.capacity, priceCents: s.priceCents },
    });
}
const sha256 = createHash('sha256').update(WAIVER_TEXT).digest('hex');
await db.insert(schema.waiverVersions).values({ version: WAIVER_VERSION, text: WAIVER_TEXT, sha256 }).onConflictDoNothing();
const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from class_sessions`);
console.log(`Seeded. ${n} sessions; waiver ${WAIVER_VERSION} (${sha256.slice(0, 12)}…)`);
await closeDb();
