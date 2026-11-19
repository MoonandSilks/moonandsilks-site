import type { APIRoute } from 'astro';
import { setSessionClosed } from '../../../../lib/admin';
export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  const f = await request.formData();
  const session = Number(f.get('session'));
  if (!Number.isInteger(session)) return new Response('Bad request', { status: 400 });
  const closed = f.get('closed') === '1';
  await setSessionClosed(session, closed);
  const msg = closed ? 'Closed to new bookings. Existing bookings are kept.' : 'Reopened to bookings.';
  return redirect(`/admin/session/${session}?msg=${encodeURIComponent(msg)}`, 303);
};
