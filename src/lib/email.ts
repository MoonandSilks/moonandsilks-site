import { formatDayShort, formatTime } from './dates';
import { env } from './env';
import { formatAud } from './money';

type Summary = NonNullable<Awaited<ReturnType<typeof import('./booking').getOrderSummary>>>;

/**
 * Sends a booking confirmation via Resend if RESEND_API_KEY and EMAIL_FROM are set; otherwise does nothing.
 * Contains no health information by design.
 */
export async function sendConfirmationEmail(s: Summary): Promise<'sent' | 'skipped' | 'failed'> {
  if (!env.resendApiKey || !env.emailFrom) return 'skipped';
  const cash = s.paymentMethod === 'cash';
  const lines = s.lines.map((l) => `• ${l.participant} — ${formatDayShort(l.startsAt)}, ${formatTime(l.startsAt)} (${l.ageGroup})`);
  const text = [
    `Hi ${s.bookerName},`,
    '',
    'Your Moon & Silks booking is confirmed:',
    ...lines,
    '',
    'Venue: Nannup District High School',
    '',
    cash
      ? `Payment: cash at class — ${formatAud(s.netCents)} due.`
      : `Payment: paid by card — ${formatAud(s.totalCents)} (includes ${formatAud(s.surchargeCents)} card surcharge).`,
    '',
    'See you there!',
    'Moon & Silks Circus Co',
  ].join('\n');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.emailFrom, to: [s.bookerEmail], subject: 'Your Moon & Silks booking', text }),
    });
    if (!res.ok) {
      console.error('Confirmation email failed with status', res.status);
      return 'failed';
    }
    return 'sent';
  } catch {
    console.error('Confirmation email failed (network)');
    return 'failed';
  }
}
