import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { confirmCardOrder, getOrderSummary, releaseOrder } from '../../lib/booking';
import { getDb, schema } from '../../lib/db/client';
import { sendConfirmationEmail } from '../../lib/email';
import { env } from '../../lib/env';
import { getStripe } from '../../lib/stripe';

export const prerender = false;

/** Stripe → POST /api/stripe-webhook. Bookings are confirmed only here. */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.stripeWebhookSecret;
  const signature = request.headers.get('stripe-signature');
  if (!secret || !signature) return new Response('Webhook not configured', { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return new Response('Bad signature', { status: 400 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (session.payment_status !== 'paid') break; // wait for async success
      const pi = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
      const result = await confirmCardOrder(session.id, pi);
      if (result.outcome === 'confirmed') {
        const [order] = await getDb().select({ token: schema.orders.publicToken }).from(schema.orders).where(eq(schema.orders.id, result.orderId!));
        const summary = order && (await getOrderSummary(order.token));
        if (summary) await sendConfirmationEmail(summary);
      } else if (result.outcome === 'no_capacity' && pi) {
        // Paid after the hold lapsed and the class filled meanwhile: refund in full.
        await getStripe().refunds.create({ payment_intent: pi }, { idempotencyKey: `refund-${session.id}` });
        await getDb().update(schema.orders).set({ status: 'refunded' }).where(eq(schema.orders.id, result.orderId!));
      }
      break;
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      await releaseOrder({ stripeSessionId: session.id });
      break;
  }
  return new Response('ok', { status: 200 });
};
