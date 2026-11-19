import { randomBytes } from 'node:crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb, schema, type Tx } from './db/client';

const { classSessions, bookings, orders } = schema;

/** SQL fragment: bookings that occupy a spot right now. */
export const occupiesSpot = sql`(${bookings.status} = 'confirmed' or (${bookings.status} = 'held' and ${bookings.holdExpiresAt} > now()))`;

export class SoldOutError extends Error {
  constructor(public sessionIds: number[]) {
    super('Not enough spots left');
  }
}

export function newToken(): string {
  return randomBytes(18).toString('base64url');
}

export type ScheduleRow = {
  id: number;
  slug: string;
  startsAt: Date;
  ageGroup: string;
  ageMin: number | null;
  ageMax: number | null;
  capacity: number;
  priceCents: number;
  closed: boolean;
  taken: number;
  spotsLeft: number;
};

export async function getSchedule(): Promise<ScheduleRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: classSessions.id,
      slug: classSessions.slug,
      startsAt: classSessions.startsAt,
      ageGroup: classSessions.ageGroup,
      ageMin: classSessions.ageMin,
      ageMax: classSessions.ageMax,
      capacity: classSessions.capacity,
      priceCents: classSessions.priceCents,
      closed: classSessions.closed,
      taken: sql<number>`(select count(*)::int from bookings b where b.session_id = class_sessions.id and (b.status = 'confirmed' or (b.status = 'held' and b.hold_expires_at > now())))`,
    })
    .from(classSessions)
    .orderBy(classSessions.startsAt);
  return rows.map((r) => ({ ...r, spotsLeft: r.closed ? 0 : Math.max(0, r.capacity - r.taken) }));
}

/**
 * Locks the session rows, then checks that live bookings + requested <= capacity.
 * With `web`, sessions closed in /admin are refused too (admin adds and imports may still fill them).
 * Must run inside a transaction. Concurrent callers for the same session queue on the row lock,
 * and each re-counts after the previous one commits, so the last spot can only be taken once.
 */
export async function lockAndCheckCapacity(tx: Tx, requested: Map<number, number>, opts: { excludeOrderId?: string; web?: boolean } = {}) {
  const { excludeOrderId, web = false } = opts;
  const ids = [...requested.keys()].sort((a, b) => a - b);
  if (!ids.length) return;
  const locked = await tx
    .select({ id: classSessions.id, capacity: classSessions.capacity, closed: classSessions.closed })
    .from(classSessions)
    .where(inArray(classSessions.id, ids))
    .orderBy(classSessions.id)
    .for('update');
  if (locked.length !== ids.length) throw new Error('Unknown session');
  const counts = await tx
    .select({ sessionId: bookings.sessionId, n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        inArray(bookings.sessionId, ids),
        occupiesSpot,
        excludeOrderId ? sql`${bookings.orderId} is distinct from ${excludeOrderId}` : undefined,
      ),
    )
    .groupBy(bookings.sessionId);
  const taken = new Map(counts.map((c) => [c.sessionId, c.n]));
  const full = locked.filter((s) => (web && s.closed) || (taken.get(s.id) ?? 0) + (requested.get(s.id) ?? 0) > s.capacity).map((s) => s.id);
  if (full.length) throw new SoldOutError(full);
}

/** Marks lapsed holds expired. Returns Stripe Checkout ids of their orders so callers can close them. */
export async function releaseExpiredHolds(): Promise<string[]> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const lapsed = await tx
      .update(bookings)
      .set({ status: 'expired' })
      .where(and(eq(bookings.status, 'held'), lt(bookings.holdExpiresAt, sql`now()`)))
      .returning({ orderId: bookings.orderId });
    const orderIds = [...new Set(lapsed.map((l) => l.orderId).filter((x): x is string => !!x))];
    if (!orderIds.length) return [];
    const expired = await tx
      .update(orders)
      .set({ status: 'expired' })
      .where(and(inArray(orders.id, orderIds), eq(orders.status, 'pending')))
      .returning({ stripeSessionId: orders.stripeSessionId });
    return expired.map((o) => o.stripeSessionId).filter((x): x is string => !!x);
  });
}

/** Releases an unpaid card order now (Checkout cancelled, expired or failed). No-op once confirmed. */
export async function releaseOrder(where: { orderId?: string; token?: string; stripeSessionId?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const cond = where.orderId
      ? eq(orders.id, where.orderId)
      : where.token
        ? eq(orders.publicToken, where.token)
        : eq(orders.stripeSessionId, where.stripeSessionId!);
    const [order] = await tx.select().from(orders).where(cond).for('update');
    if (!order || order.status !== 'pending') return order ?? null;
    await tx.update(bookings).set({ status: 'expired' }).where(and(eq(bookings.orderId, order.id), eq(bookings.status, 'held')));
    const [updated] = await tx.update(orders).set({ status: 'expired' }).where(eq(orders.id, order.id)).returning();
    return updated;
  });
}

export type ConfirmResult = { outcome: 'confirmed' | 'already' | 'no_capacity' | 'not_found'; orderId?: string };

/**
 * Confirms a paid card order. Idempotent: a repeated webhook returns 'already'.
 * If the hold had lapsed, it re-checks capacity; if the spots are gone it reports
 * 'no_capacity' so the caller can refund.
 */
export async function confirmCardOrder(stripeSessionId: string, paymentIntent: string | null): Promise<ConfirmResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.stripeSessionId, stripeSessionId)).for('update');
    if (!order) return { outcome: 'not_found' };
    if (order.status === 'confirmed') return { outcome: 'already', orderId: order.id };
    if (order.status === 'refund_needed' || order.status === 'refunded') return { outcome: 'no_capacity', orderId: order.id };

    const items = await tx.select().from(bookings).where(eq(bookings.orderId, order.id));
    const stillHeld = items.every((b) => b.status === 'held' && b.holdExpiresAt && b.holdExpiresAt > new Date());
    if (!stillHeld) {
      // Hold lapsed before payment landed. Take the spots again only if they are still free.
      const req = new Map<number, number>();
      for (const b of items) req.set(b.sessionId, (req.get(b.sessionId) ?? 0) + 1);
      try {
        await lockAndCheckCapacity(tx, req, { excludeOrderId: order.id, web: true });
      } catch (e) {
        if (e instanceof SoldOutError) {
          await tx.update(orders).set({ status: 'refund_needed', stripePaymentIntent: paymentIntent }).where(eq(orders.id, order.id));
          await tx.update(bookings).set({ status: 'expired' }).where(eq(bookings.orderId, order.id));
          return { outcome: 'no_capacity', orderId: order.id };
        }
        throw e;
      }
    }
    await tx
      .update(bookings)
      .set({ status: 'confirmed', paymentStatus: 'paid_card', holdExpiresAt: null })
      .where(eq(bookings.orderId, order.id));
    await tx
      .update(orders)
      .set({ status: 'confirmed', confirmedAt: new Date(), holdExpiresAt: null, stripePaymentIntent: paymentIntent })
      .where(eq(orders.id, order.id));
    return { outcome: 'confirmed', orderId: order.id };
  });
}

/** Public, health-free summary of an order for the confirmation page and email. */
export async function getOrderSummary(token: string) {
  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.publicToken, token));
  if (!order) return null;
  const lines = await db
    .select({
      participant: schema.participants.fullName,
      startsAt: classSessions.startsAt,
      ageGroup: classSessions.ageGroup,
      priceCents: classSessions.priceCents,
      status: bookings.status,
      paymentStatus: bookings.paymentStatus,
    })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .innerJoin(schema.participants, eq(schema.participants.id, bookings.participantId))
    .where(eq(bookings.orderId, order.id))
    .orderBy(classSessions.startsAt, schema.participants.fullName);
  return {
    status: order.status,
    paymentMethod: order.paymentMethod,
    bookerName: order.bookerName,
    bookerEmail: order.bookerEmail,
    netCents: order.netCents,
    surchargeCents: order.surchargeCents,
    totalCents: order.totalCents,
    holdExpiresAt: order.holdExpiresAt,
    lines,
  };
}
