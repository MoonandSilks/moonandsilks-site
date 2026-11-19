// Integration tests. Run against a throwaway Postgres: TEST_DATABASE_URL=postgres://... npm test
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a throwaway database');
process.env.DATABASE_URL = url;
process.env.DB_POOL_MAX = '12';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_FEE_PERCENT = '1.65';
process.env.STRIPE_FEE_FIXED = '0.30';

const { sql, eq } = await import('drizzle-orm');
const { migrate } = await import('drizzle-orm/postgres-js/migrator');
const { getDb, closeDb, schema } = await import('../src/lib/db/client');
const { SEED_SESSIONS } = await import('../src/lib/sessions-seed');
const { createWebBooking } = await import('../src/lib/checkout');
const { confirmCardOrder, getOrderSummary, getSchedule, releaseExpiredHolds, releaseOrder, SoldOutError, newToken } = await import('../src/lib/booking');
const { getStripe } = await import('../src/lib/stripe');
const { cardSurchargeCents } = await import('../src/lib/money');
const { parseBooking } = await import('../src/lib/validate');
const { importCsv } = await import('../src/lib/importer');
const { addConfirmedBooking, cancelBooking, roster, rosterCsv, sessionsOverview, setSessionClosed } = await import('../src/lib/admin');
const { waiverPdf } = await import('../src/lib/pdf');
const { WAIVER_TEXT, WAIVER_VERSION } = await import('../src/lib/waiver-text');
const { createHash } = await import('node:crypto');
const { readFileSync } = await import('node:fs');

const db = getDb();
let ids: number[] = [];

const acks = {
  read_understood: true, asked_questions: true, understand_risks: true, voluntary: true,
  accept_responsibility: true, follow_instructions: true, statutory_rights: true,
};
const person = (name: string, dob: string, sessionIds: number[], extra: Record<string, unknown> = {}) => ({
  fullName: name, dateOfBirth: dob, phone: '0400 000 000', email: 'parent@example.com', emergencyName: 'Sam Example',
  emergencyPhone: '0400 111 111', healthNotes: '', healthNone: true, acknowledgements: acks, signature: name,
  guardianName: 'Pat Example', guardianRelationship: 'Parent', guardianSignature: 'Pat Example', sessionIds, ...extra,
});
const booker = { name: 'Pat Example', email: 'pat@example.com', phone: '0400 222 222' };
// Stripe is stubbed: Checkout sessions are fake, and payment is simulated by confirming via the webhook path.
let nSessions = 0;
getStripe().checkout.sessions.create = (async () => {
  const id = `cs_fake_${++nSessions}`;
  return { id, url: `https://checkout.stripe.test/${id}` };
}) as never;
const startBooking = (participants: ReturnType<typeof person>[]) =>
  createWebBooking({ participants, booker, waiverVersion: WAIVER_VERSION }, { ip: '203.0.113.5', origin: 'http://localhost' });
/** A booking that has been paid: checkout started, then confirmed by the webhook logic. */
const cash = async (participants: ReturnType<typeof person>[]) => {
  const r = await startBooking(participants);
  const sid = r.redirect.split('/').pop()!;
  await confirmCardOrder(sid, `pi_${sid}`);
  return r;
};

before(async () => {
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrate(db, { migrationsFolder: './drizzle' });
  for (const s of SEED_SESSIONS) await db.insert(schema.classSessions).values(s);
  await db.insert(schema.waiverVersions).values({ version: WAIVER_VERSION, text: WAIVER_TEXT, sha256: createHash('sha256').update(WAIVER_TEXT).digest('hex') });
  ids = (await db.select().from(schema.classSessions).orderBy(schema.classSessions.startsAt)).map((s) => s.id);
});
beforeEach(async () => {
  await db.execute(sql`truncate bookings, waivers, participants, orders restart identity cascade`);
});
after(closeDb);

describe('schedule', () => {
  test('nine sessions, 10 spots each, three age groups', async () => {
    const s = await getSchedule();
    assert.equal(s.length, 9);
    assert.ok(s.every((r) => r.capacity === 10 && r.priceCents === 2000 && r.spotsLeft === 10));
    assert.deepEqual([...new Set(s.map((r) => r.ageGroup))], ['Ages 4–7', 'Ages 8–12', 'Teens & adults']);
  });
});

describe('surcharge', () => {
  test('passes the fee through at cost, rounded up by under a cent', () => {
    for (const net of [2000, 4000, 6000, 18000]) {
      const s = cardSurchargeCents(net, 1.65, 30);
      const gross = net + s;
      const kept = gross - gross * 0.0165 - 30;
      assert.ok(kept >= net - 1e-9, `net ${net}: keeps ${kept}`);
      assert.ok(kept < net + 1, `net ${net}: not more than a cent over`);
    }
    assert.equal(cardSurchargeCents(6000, 1.65, 30), 132); // 3 × $20 → $1.32, one fixed fee per payment
    assert.equal(cardSurchargeCents(0, 1.65, 30), 0);
  });
});

describe('capacity', () => {
  test('concurrent bookings for the last spot: exactly one wins', async () => {
    for (let i = 0; i < 9; i++) await cash([person(`Kid ${i}`, '2019-01-01', [ids[0]])]);
    const racers = Array.from({ length: 10 }, (_, i) => cash([person(`Racer ${i}`, '2019-01-01', [ids[0]])]));
    const results = await Promise.allSettled(racers);
    const won = results.filter((r) => r.status === 'fulfilled').length;
    const soldOut = results.filter((r) => r.status === 'rejected' && r.reason instanceof SoldOutError).length;
    assert.equal(won, 1);
    assert.equal(soldOut, 9);
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int n from bookings where session_id = ${ids[0]} and status = 'confirmed'`);
    assert.equal(n, 10);
  });

  test('family cart: two children, several Saturdays, one order', async () => {
    await cash([person('Ari', '2019-03-01', [ids[0], ids[3]]), person('Bo', '2016-05-05', [ids[1], ids[4], ids[7]])]);
    const [{ n, orders }] = await db.execute<{ n: number; orders: number }>(sql`select count(*)::int n, count(distinct order_id)::int orders from bookings`);
    assert.equal(n, 5);
    assert.equal(orders, 1);
    const [{ w }] = await db.execute<{ w: number }>(sql`select count(*)::int w from waivers`);
    assert.equal(w, 2, 'one waiver per participant');
    const sched = await getSchedule();
    assert.equal(sched.find((r) => r.id === ids[0])!.spotsLeft, 9);
    assert.equal(sched.find((r) => r.id === ids[2])!.spotsLeft, 10);
  });

  test('a cart larger than the spots left is rejected whole', async () => {
    for (let i = 0; i < 9; i++) await cash([person(`Kid ${i}`, '2019-01-01', [ids[2]])]);
    await assert.rejects(cash([person('A', '2000-01-01', [ids[2]]), person('B', '2000-01-02', [ids[2]])]), SoldOutError);
  });

  test('held card spots count until they lapse, then free up', async () => {
    const [order] = await db.insert(schema.orders).values({
      publicToken: newToken(), bookerName: 'X', bookerEmail: 'x@example.com', paymentMethod: 'card', status: 'pending',
      netCents: 20000, totalCents: 20000, stripeSessionId: 'cs_test_hold', holdExpiresAt: new Date(Date.now() + 60_000),
    }).returning();
    for (let i = 0; i < 10; i++) {
      const [p] = await db.insert(schema.participants).values({ fullName: `H${i}` }).returning();
      await db.insert(schema.bookings).values({ sessionId: ids[5], participantId: p.id, orderId: order.id, status: 'held', paymentStatus: 'pending', waiverStatus: 'online', source: 'web', holdExpiresAt: order.holdExpiresAt });
    }
    await assert.rejects(cash([person('Late', '2000-01-01', [ids[5]])]), SoldOutError);
    await db.execute(sql`update bookings set hold_expires_at = now() - interval '1 minute'`);
    const lapsed = await releaseExpiredHolds();
    assert.deepEqual(lapsed, ['cs_test_hold']);
    await cash([person('Late', '2000-01-01', [ids[5]])]);
  });
});

describe('card confirmation (webhook logic)', () => {
  async function heldOrder(sessionId: number, n: number, sid: string, minutes = 31) {
    const exp = new Date(Date.now() + minutes * 60_000);
    const [order] = await db.insert(schema.orders).values({
      publicToken: newToken(), bookerName: 'X', bookerEmail: 'x@example.com', paymentMethod: 'card', status: 'pending',
      netCents: 2000 * n, surchargeCents: 65, totalCents: 2000 * n + 65, stripeSessionId: sid, holdExpiresAt: exp,
    }).returning();
    for (let i = 0; i < n; i++) {
      const [p] = await db.insert(schema.participants).values({ fullName: `${sid}-${i}` }).returning();
      await db.insert(schema.bookings).values({ sessionId, participantId: p.id, orderId: order.id, status: 'held', paymentStatus: 'pending', waiverStatus: 'online', source: 'web', holdExpiresAt: exp });
    }
    return order;
  }

  test('confirms only on webhook, idempotently', async () => {
    const o = await heldOrder(ids[6], 2, 'cs_a');
    assert.equal((await confirmCardOrder('cs_a', 'pi_a')).outcome, 'confirmed');
    assert.equal((await confirmCardOrder('cs_a', 'pi_a')).outcome, 'already');
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.orderId, o.id));
    assert.ok(rows.every((b) => b.status === 'confirmed' && b.paymentStatus === 'paid_card'));
  });

  test('abandoned checkout releases the hold', async () => {
    const o = await heldOrder(ids[6], 3, 'cs_b');
    await releaseOrder({ stripeSessionId: 'cs_b' });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.orderId, o.id));
    assert.ok(rows.every((b) => b.status === 'expired'));
  });

  test('late payment after the class filled → refund needed, no oversell', async () => {
    await heldOrder(ids[7], 1, 'cs_late', -1); // hold already lapsed
    await releaseExpiredHolds();
    for (let i = 0; i < 10; i++) await cash([person(`F${i}`, '2000-01-01', [ids[7]])]);
    assert.equal((await confirmCardOrder('cs_late', 'pi_late')).outcome, 'no_capacity');
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int n from bookings where session_id = ${ids[7]} and status = 'confirmed'`);
    assert.equal(n, 10);
  });

  test('late payment with room left still confirms', async () => {
    await heldOrder(ids[8], 1, 'cs_late2', -1);
    await releaseExpiredHolds();
    assert.equal((await confirmCardOrder('cs_late2', 'pi_late2')).outcome, 'confirmed');
  });
});

describe('waiver validation', () => {
  const dates = new Map([[1, '2026-11-28']]);
  const body = (p: Record<string, unknown>) => ({ participants: [p], booker, waiverVersion: WAIVER_VERSION });

  test('under 18 on the class date needs guardian; adult does not', () => {
    const kid = parseBooking(body(person('Kid', '2010-01-01', [1], { guardianName: '', guardianRelationship: '', guardianSignature: '' })), dates, '2026-11-16');
    assert.ok(kid.errors['p0.guardianName'] && kid.errors['p0.guardianRelationship'] && kid.errors['p0.guardianSignature']);
    // Turns 18 the day after class → still a minor
    const almost = parseBooking(body(person('Almost', '2008-11-29', [1], { guardianName: '' })), dates, '2026-11-16');
    assert.ok(almost.errors['p0.guardianName']);
    const adult = parseBooking(body(person('Adult', '2008-11-28', [1], { guardianName: '', guardianRelationship: '', guardianSignature: '' })), dates, '2026-11-16');
    assert.deepEqual(adult.errors, {});
  });

  test('health needs a description or None; None clears leftover text', () => {
    assert.ok(parseBooking(body(person('A', '1990-01-01', [1], { healthNone: false, healthNotes: '' })), dates, '2026-11-16').errors['p0.health']);
    const none = parseBooking(body(person('A', '1990-01-01', [1], { healthNone: true, healthNotes: 'leftover' })), dates, '2026-11-16');
    assert.equal(none.value!.participants[0].healthNotes, '');
    assert.ok(!parseBooking(body(person('A', '1990-01-01', [1], { healthNone: false, healthNotes: 'Asthma' })), dates, '2026-11-16').errors['p0.health']);
  });

  test('every acknowledgement and the signature are required', () => {
    const r = parseBooking(body(person('A', '1990-01-01', [1], { acknowledgements: { ...acks, voluntary: false }, signature: '' })), dates, '2026-11-16');
    assert.ok(r.errors['p0.acks'] && r.errors['p0.signature']);
  });

  test('signed waiver stores version, hash, timestamps and IP; PDF renders', async () => {
    await cash([person('Wren', '2015-06-01', [ids[1]], { healthNone: false, healthNotes: 'Peanut allergy' })]);
    const [w] = await db.select().from(schema.waivers);
    assert.equal(w.waiverVersion, WAIVER_VERSION);
    assert.equal(w.ipAddress, '203.0.113.5');
    assert.ok(w.signedAtPerth.includes('AWST'));
    assert.equal(w.under18, true);
    assert.equal(w.guardianSignature, 'Pat Example');
    const pdf = await waiverPdf(w.id);
    assert.ok(pdf && pdf.bytes.length > 2000);
  });
});

describe('admin', () => {
  test('unpaid booking is not shown as booked; paid one is', async () => {
    const r = await startBooking([person('Unpaid', '2018-02-02', [ids[0]], { healthNone: false, healthNotes: 'Asthma' })]);
    let o = (await sessionsOverview()).find((s) => s.id === ids[0])!;
    assert.equal(o.confirmed, 0);
    assert.equal(o.health, 0);
    await confirmCardOrder(r.redirect.split('/').pop()!, 'pi_x');
    o = (await sessionsOverview()).find((s) => s.id === ids[0])!;
    assert.equal(o.confirmed, 1);
    assert.equal(o.health, 1);
  });

  test('cancel frees capacity and keeps the waiver, CSV includes health', async () => {
    await cash([person('Lee', '2018-02-02', [ids[0]], { healthNone: false, healthNotes: 'Asthma' })]);
    const [r] = await roster(ids[0]);
    assert.equal(r.paymentStatus, 'paid_card');
    const csv = await rosterCsv(ids[0]);
    assert.match(csv, /Asthma/);
    await cancelBooking(r.bookingId);
    assert.equal((await roster(ids[0])).length, 0);
    const [{ w }] = await db.execute<{ w: number }>(sql`select count(*)::int w from waivers`);
    assert.equal(w, 1);
  });

  test('manual add respects capacity', async () => {
    for (let i = 0; i < 10; i++) await cash([person(`M${i}`, '2000-01-01', [ids[3]])]);
    await assert.rejects(
      addConfirmedBooking({ sessionId: ids[3], fullName: 'Walk In', dateOfBirth: null, phone: null, email: null, emergencyName: null, emergencyPhone: null, healthNotes: null, bookerEmail: null, paymentStatus: 'paid_card', waiverStatus: 'missing', notes: null, source: 'admin' }),
      SoldOutError,
    );
  });
});

describe('CSV import', () => {
  const header = 'session_date,session_time,participant_full_name,date_of_birth,phone,email,emergency_contact_name,emergency_contact_phone,health_notes,waiver_status,payment_status,booker_email,guardian_name,guardian_relationship,notes';
  const row = (name: string, time = '09:00', extra = 'signed,paid_card') =>
    `2026-11-28,${time},${name},2019-01-01,0400000000,a@example.com,Em,0400000001,,${extra},b@example.com,Pat,Parent,`;

  test('imports, reports duplicates and invalid rows, never oversells', async () => {
    const lines = [header, ...Array.from({ length: 11 }, (_, i) => row(`Imp ${i}`)), row('Imp 0'), row('Bad', '08:00'), row('Odd', '10:00', 'maybe,paid_card')];
    const report = await importCsv(lines.join('\n'));
    assert.equal(report.imported, 10);
    const outcomes = report.results.map((r) => r.outcome);
    assert.equal(outcomes.filter((o) => o === 'full').length, 2); // 11th row and the duplicate both hit a full session
    assert.equal(outcomes.filter((o) => o === 'invalid').length, 2);
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int n from bookings where session_id = ${ids[0]} and status = 'confirmed'`);
    assert.equal(n, 10);
    const [first] = await roster(ids[0]);
    assert.equal(first.waiverStatus, 'paper');
  });

  test('duplicate in a session with room is skipped, not double-booked', async () => {
    const report = await importCsv([header, row('Dup'), row('Dup')].join('\n'));
    assert.deepEqual(report.results.map((r) => r.outcome), ['imported', 'duplicate']);
  });

  test('missing columns are reported', async () => {
    const report = await importCsv('session_date,participant_full_name\n2026-11-28,X');
    assert.equal(report.results[0].outcome, 'invalid');
  });
});

describe('closed sessions', () => {
  const walkIn = (sessionId: number) => addConfirmedBooking({ sessionId, fullName: 'Group Member', dateOfBirth: null, phone: null, email: null, emergencyName: null, emergencyPhone: null, healthNotes: null, bookerEmail: null, paymentStatus: 'paid_card', waiverStatus: 'missing', notes: null, source: 'admin' });
  const reopenAll = () => db.update(schema.classSessions).set({ closed: false });
  beforeEach(reopenAll);
  after(reopenAll);

  test('migration closes only Sat 12 Dec 11:00 and keeps its booking', async () => {
    const existing = await cash([person('Already Booked', '2000-01-01', [ids[8]])]);
    const before = await db.select().from(schema.bookings).where(eq(schema.bookings.sessionId, ids[8]));
    // Re-apply the migration SQL against the seeded sessions, as a production deploy would.
    const migration = readFileSync('drizzle/0002_session_closed.sql', 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint')) await db.execute(sql.raw(stmt));
    const s = await getSchedule();
    assert.deepEqual(s.filter((r) => r.closed).map((r) => r.slug), ['2026-12-12-1100']);
    const day = s.filter((r) => r.slug.startsWith('2026-12-12'));
    assert.deepEqual(day.map((r) => [r.slug, r.spotsLeft, r.taken]), [['2026-12-12-0900', 10, 0], ['2026-12-12-1000', 10, 0], ['2026-12-12-1100', 0, 1]]);
    assert.deepEqual(await db.select().from(schema.bookings).where(eq(schema.bookings.sessionId, ids[8])), before);
    assert.equal((await getOrderSummary(existing.token))?.status, 'confirmed');
  });

  test('closed session refuses web bookings; other sessions still book', async () => {
    await setSessionClosed(ids[8], true);
    await assert.rejects(startBooking([person('New Teen', '2000-01-01', [ids[8]])]), SoldOutError);
    await assert.rejects(startBooking([person('Mixed Cart', '2000-01-01', [ids[5], ids[8]])]), SoldOutError);
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int n from bookings`);
    assert.equal(n, 0);
    for (const id of [ids[5], ids[6], ids[7]]) await cash([person(`Open ${id}`, '2000-01-01', [id])]);
    const open = await db.execute<{ n: number }>(sql`select count(*)::int n from bookings where status = 'confirmed'`);
    assert.equal(open[0].n, 3);
  });

  test('late payment for a session closed meanwhile is refunded, not booked', async () => {
    const r = await startBooking([person('Slow Payer', '2000-01-01', [ids[8]])]);
    await db.update(schema.bookings).set({ holdExpiresAt: new Date(Date.now() - 60_000) });
    await releaseExpiredHolds();
    await setSessionClosed(ids[8], true);
    assert.equal((await confirmCardOrder(r.redirect.split('/').pop()!, 'pi_slow')).outcome, 'no_capacity');
  });

  test('admin can still add to a closed session; reopen allows web bookings again', async () => {
    await cash([person('Kept', '2000-01-01', [ids[8]])]);
    await setSessionClosed(ids[8], true);
    await walkIn(ids[8]);
    assert.equal((await roster(ids[8])).length, 2);
    assert.equal((await sessionsOverview()).find((s) => s.id === ids[8])?.closed, true);
    await setSessionClosed(ids[8], false);
    assert.equal((await getSchedule()).find((s) => s.id === ids[8])?.spotsLeft, 8);
    await cash([person('After Reopen', '2000-01-01', [ids[8]])]);
    assert.equal((await roster(ids[8])).filter((b) => b.status === 'confirmed').length, 3);
  });
});
