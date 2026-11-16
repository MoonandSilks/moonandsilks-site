import Stripe from 'stripe';
import { env } from './env';

let client: Stripe | undefined;

export function stripeEnabled(): boolean {
  return !!env.stripeSecretKey;
}

export function getStripe(): Stripe {
  if (!env.stripeSecretKey) throw new Error('STRIPE_SECRET_KEY is not set');
  client ??= new Stripe(env.stripeSecretKey);
  return client;
}

/** Best-effort: stop an abandoned Checkout from taking payment after its hold lapsed. */
export async function expireCheckoutSessions(ids: string[]) {
  if (!stripeEnabled() || !ids.length) return;
  const stripe = getStripe();
  await Promise.allSettled(ids.map((id) => stripe.checkout.sessions.expire(id)));
}
