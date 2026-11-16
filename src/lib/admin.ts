// Admin-only data access. Everything here may include health data: never import into public pages.
import { and, asc, eq, sql } from 'drizzle-orm';
import { lockAndCheckCapacity, occupiesSpot } from './booking';
import { ageOn, formatDayShort, formatTime, isIsoDate, perthDate } from './dates';
import { getDb, schema } from './db/client';
import { toCsv } from './csv';

const { classSessions, bookings, participants, orders } = schema;

export async function sessionsOverview() {
  const db = getDb();
  return db
    .select({
      id: classSessions.id,
      startsAt: classSessions.startsAt,
      ageGroup: classSessions.ageGroup,
      capacity: classSessions.capacity,
      confirmed: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed')::int`,
      held: sql<number>`count(*) filter (where ${bookings.status} = 'held' and ${bookings.holdExpiresAt} > now())::int`,
      cashDue: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.paymentStatus} = 'cash_due')::int`,
      waiverMissing: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.waiverStatus} <> 'online')::int`,
      health: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${participants.healthNotes} is not null)::int`,
    })
    .from(classSessions)
    .leftJoin(bookings, eq(bookings.sessionId, classSessions.id))
    .leftJoin(participants, eq(participants.id, bookings.participantId))
    .groupBy(classSessions.id)
    .orderBy(asc(classSessions.startsAt));
}

export async function getSession(id: number) {
  const [s] = await getDb().select().from(classSessions).where(eq(classSessions.id, id));
  return s ?? null;
}

export async function roster(sessionId: number, includeInactive = false) {
  const db = getDb();
  const rows = await db
    .select({
      bookingId: bookings.id,
      status: bookings.status,
      paymentStatus: bookings.paymentStatus,
      waiverStatus: bookings.waiverStatus,
      waiverId: bookings.waiverId,
      source: bookings.source,
      notes: bookings.notes,
      holdExpiresAt: bookings.holdExpiresAt,
      bookerName: bookings.bookerName,
      bookerEmail: bookings.bookerEmail,
      bookerPhone: bookings.bookerPhone,
      participantId: participants.id,
      fullName: participants.fullName,
      dateOfBirth: participants.dateOfBirth,
      phone: participants.phone,
      email: participants.email,
      emergencyName: participants.emergencyName,
      emergencyPhone: participants.emergencyPhone,
      healthNotes: participants.healthNotes,
      healthNone: participants.healthNone,
      guardianName: participants.guardianName,
      guardianRelationship: participants.guardianRelationship,
      startsAt: classSessions.startsAt,
      orderMethod: orders.paymentMethod,
    })
    .from(bookings)
    .innerJoin(participants, eq(participants.id, bookings.participantId))
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .leftJoin(orders, eq(orders.id, bookings.orderId))
    .where(and(eq(bookings.sessionId, sessionId), includeInactive ? undefined : occupiesSpot))
    .orderBy(asc(participants.fullName));
  return rows.map((r) => ({
    ...r,
    age: r.dateOfBirth ? ageOn(r.dateOfBirth, perthDate(r.startsAt)) : null,
  }));
}

export async function setCashReceived(bookingId: string, received: boolean) {
  await getDb()
    .update(bookings)
    .set({ paymentStatus: received ? 'cash_received' : 'cash_due' })
    .where(and(eq(bookings.id, bookingId), sql`${bookings.paymentStatus} in ('cash_due', 'cash_received')`));
}

/** Cancels a spot and frees capacity. The waiver record is kept. */
export async function cancelBooking(bookingId: string) {
  await getDb()
    .update(bookings)
    .set({ status: 'cancelled', cancelledAt: new Date(), holdExpiresAt: null })
    .where(and(eq(bookings.id, bookingId), sql`${bookings.status} in ('held', 'confirmed')`));
}

export type ManualInput = {
  sessionId: number;
  fullName: string;
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  healthNotes: string | null;
  healthNone?: boolean;
  guardianName?: string | null;
  guardianRelationship?: string | null;
  bookerName?: string | null;
  bookerEmail: string | null;
  bookerPhone?: string | null;
  paymentStatus: 'paid_card' | 'cash_due' | 'cash_received';
  waiverStatus: 'paper' | 'missing';
  notes: string | null;
  source: 'admin' | 'import';
};

export class DuplicateError extends Error {}

/** Adds a confirmed spot outside the web flow (walk-in, phone booking, import). Same capacity lock as the web. */
export async function addConfirmedBooking(input: ManualInput) {
  return getDb().transaction(async (tx) => {
    await lockAndCheckCapacity(tx, new Map([[input.sessionId, 1]]));
    // Same person (name + DOB) already holding a live spot in this session?
    const dupe = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(participants, eq(participants.id, bookings.participantId))
      .where(
        and(
          eq(bookings.sessionId, input.sessionId),
          occupiesSpot,
          sql`lower(${participants.fullName}) = lower(${input.fullName})`,
          input.dateOfBirth ? eq(participants.dateOfBirth, input.dateOfBirth) : sql`true`,
        ),
      );
    if (dupe.length) throw new DuplicateError('Already booked into this session');
    const [p] = await tx
      .insert(participants)
      .values({
        fullName: input.fullName,
        dateOfBirth: input.dateOfBirth,
        phone: input.phone,
        email: input.email,
        emergencyName: input.emergencyName,
        emergencyPhone: input.emergencyPhone,
        healthNotes: input.healthNotes || null,
        healthNone: !!input.healthNone,
        guardianName: input.guardianName ?? null,
        guardianRelationship: input.guardianRelationship ?? null,
      })
      .returning({ id: participants.id });
    const [b] = await tx
      .insert(bookings)
      .values({
        sessionId: input.sessionId,
        participantId: p.id,
        status: 'confirmed',
        paymentStatus: input.paymentStatus,
        waiverStatus: input.waiverStatus,
        source: input.source,
        bookerName: input.bookerName ?? null,
        bookerEmail: input.bookerEmail,
        bookerPhone: input.bookerPhone ?? null,
        notes: input.notes,
      })
      .returning({ id: bookings.id });
    return b.id;
  });
}

const PAYMENT_LABEL: Record<string, string> = {
  paid_card: 'Paid (card)',
  cash_due: 'Cash due',
  cash_received: 'Cash received',
  pending: 'Awaiting card payment',
};
const WAIVER_LABEL: Record<string, string> = { online: 'Signed online', paper: 'Signed (paper/imported)', missing: 'MISSING' };
export const paymentLabel = (s: string) => PAYMENT_LABEL[s] ?? s;
export const waiverLabel = (s: string) => WAIVER_LABEL[s] ?? s;

/** Sensitive: includes health notes. */
export async function rosterCsv(sessionId?: number) {
  const sessions = sessionId ? [await getSession(sessionId)] : await getDb().select().from(classSessions).orderBy(asc(classSessions.startsAt));
  const header = [
    'session_date', 'session_time', 'age_group', 'participant_full_name', 'date_of_birth', 'age_on_class_date', 'phone', 'email',
    'emergency_contact_name', 'emergency_contact_phone', 'health_notes', 'waiver_status', 'payment_status', 'booking_status',
    'booker_name', 'booker_email', 'booker_phone', 'guardian_name', 'guardian_relationship', 'source', 'notes',
  ];
  const out: unknown[][] = [];
  for (const s of sessions) {
    if (!s) continue;
    for (const r of await roster(s.id)) {
      out.push([
        perthDate(s.startsAt), formatTime(s.startsAt), s.ageGroup, r.fullName, r.dateOfBirth, r.age, r.phone, r.email,
        r.emergencyName, r.emergencyPhone, r.healthNotes ?? (r.healthNone ? 'None (declared)' : ''), waiverLabel(r.waiverStatus),
        paymentLabel(r.paymentStatus), r.status, r.bookerName, r.bookerEmail, r.bookerPhone, r.guardianName, r.guardianRelationship,
        r.source, r.notes,
      ]);
    }
  }
  return toCsv(header, out);
}

export function sessionLabel(s: { startsAt: Date; ageGroup: string }) {
  return `${formatDayShort(s.startsAt)}, ${formatTime(s.startsAt)} — ${s.ageGroup}`;
}

export function cleanDate(v: string | null | undefined) {
  const s = (v ?? '').trim();
  return isIsoDate(s) ? s : null;
}
