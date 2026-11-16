import type { APIRoute } from 'astro';
import { cancelBooking } from '../../../../lib/admin';
export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  const f = await request.formData();
  const session = Number(f.get('session'));
  await cancelBooking(String(f.get('booking')));
  return redirect(`/admin/session/${session}?msg=${encodeURIComponent('Booking cancelled. The waiver record is kept.')}`, 303);
};
