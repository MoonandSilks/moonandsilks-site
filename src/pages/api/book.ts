import type { APIRoute } from 'astro';
import { SoldOutError } from '../../lib/booking';
import { createWebBooking, sessionDateMap, StaleWaiverError } from '../../lib/checkout';
import { perthDate } from '../../lib/dates';
import { stripeEnabled } from '../../lib/stripe';
import { parseBooking } from '../../lib/validate';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, clientAddress, url }) => {
  // Same-origin JSON only.
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'Bad origin' }, 403);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
  const { dates } = await sessionDateMap();
  const { value, errors } = parseBooking(raw, dates, perthDate(new Date()));
  if (!value) return json({ error: 'Please check the highlighted fields.', fields: errors }, 422);
  if (!stripeEnabled()) return json({ error: 'Card payments are not available yet.' }, 503);

  let ip: string | null = null;
  try {
    ip = clientAddress ?? null;
  } catch {
    ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  }

  try {
    const result = await createWebBooking(value, { ip, origin: url.origin });
    return json({ ok: true, redirect: result.redirect });
  } catch (e) {
    if (e instanceof SoldOutError)
      return json({ error: 'Sorry, one or more classes are full or no longer available.', soldOut: e.sessionIds }, 409);
    if (e instanceof StaleWaiverError) return json({ error: e.message }, 409);
    console.error('Booking failed:', e instanceof Error ? e.message : 'unknown error');
    return json({ error: 'Something went wrong and nothing was booked. Please try again.' }, 500);
  }
};
