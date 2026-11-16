import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getOrderSummary, lockAndCheckCapacity, newToken, releaseExpiredHolds, releaseOrder } from './booking';
import { formatDayShort, formatTime, perthDate, perthStamp } from './dates';
import { getDb, schema } from './db/client';
import { sendConfirmationEmail } from './email';
import { env, HOLD_MINUTES } from './env';
import { cardSurchargeCents } from './money';
import { expireCheckoutSessions, getStripe } from './stripe';
import { isMinorForSessions, type BookingInput } from './validate';
import { WAIVER_TEXT, WAIVER_VERSION } from './waiver-text';

const { orders, participants, waivers, bookings, classSessions } = schema;
const WAIVER_SHA = createHash('sha256').update(WAIVER_TEXT).digest('hex');

export async function sessionDateMap() {
  const rows = await getDb().select().from(classSessions);
  return { rows, dates: new Map(rows.map((r) => [r.id, perthDate(r.startsAt)])) };
}

export class StaleWaiverError extends Error {}

/**
 * Creates the order. Cash: spots confirmed immediately as cash due.
 * Card: spots held for HOLD_MINUTES, then a Stripe Checkout session is created; confirmation happens in the webhook.
 */
export async function createWebBooking(input: BookingInput, opts: { ip: string | null; origin: string }) {
  if (input.waiverVersion !== WAIVER_VERSION) throw new StaleWaiverError('The waiver has been updated. Please reload the page.');
  await expireCheckoutSessions(await releaseExpiredHolds());

  const { rows: sessions, dates } = await sessionDateMap();
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const requested = new Map<number, number>();
  let netCents = 0;
  for (const p of input.participants)
    for (const id of p.sessionIds) {
      requested.set(id, (requested.get(id) ?? 0) + 1);
      netCents += byId.get(id)!.priceCents;
    }
  const card = input.payment === 'card';
  const surchargeCents = card ? cardSurchargeCents(netCents, env.feePercent, env.feeFixedCents) : 0;
  const now = new Date();
  const holdExpiresAt = card ? new Date(now.getTime() + HOLD_MINUTES * 60_000) : null;
  const token = newToken();

  const orderId = await getDb().transaction(async (tx) => {
    await lockAndCheckCapacity(tx, requested);
    const [order] = await tx
      .insert(orders)
      .values({
        publicToken: token,
        bookerName: input.booker.name,
        bookerEmail: input.booker.email,
        bookerPhone: input.booker.phone,
        paymentMethod: input.payment,
        status: card ? 'pending' : 'confirmed',
        netCents,
        surchargeCents,
        totalCents: netCents + surchargeCents,
        holdExpiresAt,
        confirmedAt: card ? null : now,
      })
      .returning({ id: orders.id });

    for (const p of input.participants) {
      const under18 = isMinorForSessions(p.dateOfBirth, p.sessionIds, dates);
      const [person] = await tx
        .insert(participants)
        .values({
          fullName: p.fullName,
          dateOfBirth: p.dateOfBirth,
          phone: p.phone,
          email: p.email,
          emergencyName: p.emergencyName,
          emergencyPhone: p.emergencyPhone,
          healthNotes: p.healthNone ? null : p.healthNotes,
          healthNone: p.healthNone,
          guardianName: under18 ? p.guardianName : null,
          guardianRelationship: under18 ? p.guardianRelationship : null,
        })
        .returning({ id: participants.id });
      const [waiver] = await tx
        .insert(waivers)
        .values({
          participantId: person.id,
          orderId: order.id,
          waiverVersion: WAIVER_VERSION,
          waiverSha256: WAIVER_SHA,
          fields: {
            fullName: p.fullName,
            dateOfBirth: p.dateOfBirth,
            phone: p.phone,
            email: p.email,
            emergencyName: p.emergencyName,
            emergencyPhone: p.emergencyPhone,
            healthNotes: p.healthNone ? null : p.healthNotes,
            healthNone: p.healthNone,
          },
          acknowledgements: p.acknowledgements,
          participantSignature: p.signature,
          under18,
          guardianName: under18 ? p.guardianName : null,
          guardianRelationship: under18 ? p.guardianRelationship : null,
          guardianSignature: under18 ? p.guardianSignature : null,
          signedAtUtc: now,
          signedAtPerth: perthStamp(now),
          ipAddress: opts.ip,
        })
        .returning({ id: waivers.id });
      await tx.insert(bookings).values(
        p.sessionIds.map((sessionId) => ({
          sessionId,
          participantId: person.id,
          orderId: order.id,
          waiverId: waiver.id,
          status: card ? 'held' : 'confirmed',
          paymentStatus: card ? 'pending' : 'cash_due',
          waiverStatus: 'online',
          holdExpiresAt,
          source: 'web',
          bookerName: input.booker.name,
          bookerEmail: input.booker.email,
          bookerPhone: input.booker.phone,
        })),
      );
    }
    return order.id;
  });

  if (!card) {
    const summary = await getOrderSummary(token);
    if (summary) await sendConfirmationEmail(summary);
    return { token, redirect: `/book/confirmation?o=${token}` };
  }

  // Hold is in place; now open hosted Checkout. Card details never touch this site.
  try {
    const lineItems = [...requested.entries()].map(([id, qty]) => {
      const s = byId.get(id)!;
      const names = input.participants.filter((p) => p.sessionIds.includes(id)).map((p) => p.fullName);
      return {
        quantity: qty,
        price_data: {
          currency: 'aud',
          unit_amount: s.priceCents,
          product_data: {
            name: `${formatDayShort(s.startsAt)}, ${formatTime(s.startsAt)} — ${s.ageGroup}`,
            description: `Aerial & circus class at NDHS, Bishop Street, Nannup. ${names.join(', ')}`.slice(0, 500),
          },
        },
      };
    });
    if (surchargeCents > 0)
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: 'aud',
          unit_amount: surchargeCents,
          product_data: { name: 'Card surcharge', description: 'Covers the card processing fee at cost.' },
        },
      });
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      // No payment_method_types: dynamic payment methods (cards, Apple/Google Pay, Link) are managed in the Dashboard.
      line_items: lineItems,
      customer_email: input.booker.email,
      client_reference_id: orderId,
      metadata: { order_id: orderId },
      payment_intent_data: { metadata: { order_id: orderId } },
      // Same deadline as the database hold (Stripe's minimum is 30 minutes).
      expires_at: Math.floor(holdExpiresAt!.getTime() / 1000),
      success_url: `${opts.origin}/book/confirmation?o=${token}`,
      cancel_url: `${opts.origin}/book/cancelled?o=${token}`,
      locale: 'en',
    }, { idempotencyKey: `checkout-${orderId}` });
    await getDb().update(orders).set({ stripeSessionId: session.id }).where(eq(orders.id, orderId));
    return { token, redirect: session.url! };
  } catch (e) {
    await releaseOrder({ orderId });
    throw e;
  }
}
