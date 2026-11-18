import type { APIRoute } from 'astro';
import { addConfirmedBooking, cleanDate, DuplicateError } from '../../../../lib/admin';
import { SoldOutError } from '../../../../lib/booking';
export const prerender = false;

const PAY = ['paid_card'] as const;
const WAIVER = ['missing', 'paper'] as const;

export const POST: APIRoute = async ({ request, redirect }) => {
  const f = await request.formData();
  const s = (k: string) => String(f.get(k) ?? '').trim();
  const session = Number(f.get('session'));
  const back = (q: string) => redirect(`/admin/session/${session}?${q}`, 303);
  const paymentStatus = PAY.find((p) => p === s('paymentStatus'));
  const waiverStatus = WAIVER.find((w) => w === s('waiverStatus'));
  if (!s('fullName') || !paymentStatus || !waiverStatus || !Number.isInteger(session))
    return back(`err=${encodeURIComponent('Name, payment and waiver status are required.')}`);
  try {
    await addConfirmedBooking({
      sessionId: session,
      fullName: s('fullName'),
      dateOfBirth: cleanDate(s('dateOfBirth')),
      phone: s('phone') || null,
      email: s('email') || null,
      emergencyName: s('emergencyName') || null,
      emergencyPhone: s('emergencyPhone') || null,
      healthNotes: s('healthNotes') || null,
      bookerEmail: s('bookerEmail') || null,
      bookerPhone: s('bookerPhone') || null,
      paymentStatus,
      waiverStatus,
      notes: s('notes') || null,
      source: 'admin',
    });
    return back(`msg=${encodeURIComponent(`${s('fullName')} added.`)}`);
  } catch (e) {
    if (e instanceof SoldOutError) return back(`err=${encodeURIComponent('This session is full. Cancel a booking first.')}`);
    if (e instanceof DuplicateError) return back(`err=${encodeURIComponent('That person is already booked into this session.')}`);
    throw e;
  }
};
