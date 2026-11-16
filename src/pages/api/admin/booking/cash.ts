import type { APIRoute } from 'astro';
import { setCashReceived } from '../../../../lib/admin';
export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  const f = await request.formData();
  const session = Number(f.get('session'));
  await setCashReceived(String(f.get('booking')), f.get('received') === '1');
  return redirect(`/admin/session/${session}?msg=${encodeURIComponent('Payment updated.')}`, 303);
};
