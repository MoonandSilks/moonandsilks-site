import { addConfirmedBooking, cleanDate, DuplicateError } from './admin';
import { SoldOutError } from './booking';
import { parseCsv } from './csv';
import { perthDate, perthTime24 } from './dates';
import { getDb, schema } from './db/client';

export const TEMPLATE_COLUMNS = [
  'session_date', 'session_time', 'participant_full_name', 'date_of_birth', 'phone', 'email', 'emergency_contact_name',
  'emergency_contact_phone', 'health_notes', 'waiver_status', 'payment_status', 'booker_email', 'guardian_name',
  'guardian_relationship', 'notes',
] as const;

export type ImportReport = {
  imported: number;
  results: { line: number; name: string; outcome: 'imported' | 'duplicate' | 'full' | 'invalid'; message: string }[];
};

/**
 * Imports existing bookings. Each row is its own transaction with the same capacity lock as live bookings,
 * so a session never goes over capacity. Duplicates (same name + DOB already in the session) are skipped and reported.
 */
export async function importCsv(text: string): Promise<ImportReport> {
  const rows = parseCsv(text);
  const report: ImportReport = { imported: 0, results: [] };
  if (!rows.length) return report;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = TEMPLATE_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    report.results.push({ line: 1, name: '', outcome: 'invalid', message: `Missing columns: ${missing.join(', ')}` });
    return report;
  }
  const sessions = await getDb().select().from(schema.classSessions);
  const key = (date: string, time: string) => `${date} ${time}`;
  const byKey = new Map(sessions.map((s) => [key(perthDate(s.startsAt), perthTime24(s.startsAt)), s]));

  for (let i = 1; i < rows.length; i++) {
    const line = i + 1;
    const get = (c: (typeof TEMPLATE_COLUMNS)[number]) => (rows[i][header.indexOf(c)] ?? '').trim();
    const name = get('participant_full_name');
    const time = get('session_time').padStart(5, '0');
    const session = byKey.get(key(get('session_date'), time));
    const waiver = get('waiver_status').toLowerCase();
    const payment = get('payment_status').toLowerCase();
    const dobRaw = get('date_of_birth');
    const problems: string[] = [];
    if (!name) problems.push('participant_full_name is empty');
    if (!session) problems.push(`no session on ${get('session_date')} at ${get('session_time')}`);
    if (dobRaw && !cleanDate(dobRaw)) problems.push('date_of_birth must be YYYY-MM-DD');
    if (!['signed', 'missing'].includes(waiver)) problems.push('waiver_status must be signed or missing');
    if (!['paid_card'].includes(payment)) problems.push('payment_status must be paid_card');
    if (problems.length) {
      report.results.push({ line, name, outcome: 'invalid', message: problems.join('; ') });
      continue;
    }
    try {
      await addConfirmedBooking({
        sessionId: session!.id,
        fullName: name,
        dateOfBirth: cleanDate(dobRaw),
        phone: get('phone') || null,
        email: get('email') || null,
        emergencyName: get('emergency_contact_name') || null,
        emergencyPhone: get('emergency_contact_phone') || null,
        healthNotes: get('health_notes') || null, // empty = nothing recorded (not a signed "None")
        guardianName: get('guardian_name') || null,
        guardianRelationship: get('guardian_relationship') || null,
        bookerEmail: get('booker_email') || null,
        paymentStatus: 'paid_card',
        waiverStatus: waiver === 'signed' ? 'paper' : 'missing',
        notes: get('notes') || null,
        source: 'import',
      });
      report.imported++;
      report.results.push({ line, name, outcome: 'imported', message: 'Imported' });
    } catch (e) {
      if (e instanceof SoldOutError) report.results.push({ line, name, outcome: 'full', message: 'Session is full — not imported' });
      else if (e instanceof DuplicateError) report.results.push({ line, name, outcome: 'duplicate', message: 'Already booked in this session — skipped' });
      else throw e;
    }
  }
  return report;
}
