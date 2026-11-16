import { ageOn, isIsoDate } from './dates';

/** The participant declaration points from section 10 of the waiver. Keys are stored with each signature. */
export const ACKNOWLEDGEMENTS = [
  { key: 'read_understood', label: 'I have read and understood this waiver.' },
  { key: 'asked_questions', label: 'I have had the opportunity to ask questions before participating.' },
  { key: 'understand_risks', label: 'I understand that aerial and circus activities involve inherent risks, including serious injury.' },
  { key: 'voluntary', label: 'I am voluntarily choosing to participate.' },
  { key: 'accept_responsibility', label: 'I accept responsibility for my own participation and conduct.' },
  { key: 'follow_instructions', label: 'I agree to comply with reasonable safety instructions.' },
  { key: 'statutory_rights', label: 'I understand that this document does not remove any rights or protections that cannot legally be excluded under applicable law.' },
] as const;

export type ParticipantInput = {
  fullName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  emergencyName: string;
  emergencyPhone: string;
  healthNotes: string;
  healthNone: boolean;
  acknowledgements: Record<string, boolean>;
  signature: string;
  guardianName: string;
  guardianRelationship: string;
  guardianSignature: string;
  sessionIds: number[];
};

export type BookingInput = {
  participants: ParticipantInput[];
  booker: { name: string; email: string; phone: string };
  payment: 'card' | 'cash';
  waiverVersion: string;
};

export type FieldErrors = Record<string, string>;

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\d\s-]{6,20}$/;
export const MAX_PARTICIPANTS = 8;

/**
 * Validates the public booking payload. `sessionDates` maps session id -> YYYY-MM-DD (Perth).
 * Field error keys look like `p0.fullName` to match the form.
 */
export function parseBooking(raw: unknown, sessionDates: Map<number, string>, today: string): { value?: BookingInput; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const body = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(body.participants) ? body.participants.slice(0, MAX_PARTICIPANTS) : [];
  if (!list.length) errors.form = 'Add at least one participant.';

  const participants: ParticipantInput[] = list.map((p: Record<string, unknown>, i: number) => {
    const k = (f: string) => `p${i}.${f}`;
    const sessionIds = [...new Set((Array.isArray(p.sessionIds) ? p.sessionIds : []).map(Number))].filter((id) => sessionDates.has(id));
    const healthNone = p.healthNone === true;
    const v: ParticipantInput = {
      fullName: str(p.fullName, 120),
      dateOfBirth: str(p.dateOfBirth, 10),
      phone: str(p.phone, 30),
      email: str(p.email, 200).toLowerCase(),
      emergencyName: str(p.emergencyName, 120),
      emergencyPhone: str(p.emergencyPhone, 30),
      healthNotes: healthNone ? '' : str(p.healthNotes, 2000),
      healthNone,
      acknowledgements: Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, (p.acknowledgements as Record<string, unknown>)?.[a.key] === true])),
      signature: str(p.signature, 120),
      guardianName: str(p.guardianName, 120),
      guardianRelationship: str(p.guardianRelationship, 60),
      guardianSignature: str(p.guardianSignature, 120),
      sessionIds,
    };
    if (!v.fullName) errors[k('fullName')] = 'Enter the participant’s full name.';
    if (!isIsoDate(v.dateOfBirth) || v.dateOfBirth > today || v.dateOfBirth < '1900-01-01') errors[k('dateOfBirth')] = 'Enter a valid date of birth.';
    if (!PHONE.test(v.phone)) errors[k('phone')] = 'Enter a phone number.';
    if (!EMAIL.test(v.email)) errors[k('email')] = 'Enter a valid email address.';
    if (!v.emergencyName) errors[k('emergencyName')] = 'Enter an emergency contact name.';
    if (!PHONE.test(v.emergencyPhone)) errors[k('emergencyPhone')] = 'Enter an emergency contact phone number.';
    if (!v.healthNone && !v.healthNotes) errors[k('health')] = 'Describe any injuries or medical conditions, or tick “None”.';
    if (!sessionIds.length) errors[k('sessions')] = 'Choose at least one class.';
    for (const a of ACKNOWLEDGEMENTS) if (!v.acknowledgements[a.key]) errors[k('acks')] = 'Tick every acknowledgement to continue.';
    if (!v.signature) errors[k('signature')] = 'Type the participant’s full name to sign.';
    if (isIsoDate(v.dateOfBirth) && sessionIds.length && isMinorForSessions(v.dateOfBirth, sessionIds, sessionDates)) {
      if (!v.guardianName) errors[k('guardianName')] = 'Enter the parent or guardian’s name.';
      if (!v.guardianRelationship) errors[k('guardianRelationship')] = 'Enter the relationship to the participant.';
      if (!v.guardianSignature) errors[k('guardianSignature')] = 'Parent or guardian: type your full name to sign.';
    }
    return v;
  });

  // The same person twice in one cart would double-book them.
  const seen = new Set<string>();
  participants.forEach((p, i) => {
    const key = `${p.fullName.toLowerCase()}|${p.dateOfBirth}`;
    if (p.fullName && seen.has(key)) errors[`p${i}.fullName`] = 'This participant is already in your booking.';
    seen.add(key);
  });

  const b = (body.booker ?? {}) as Record<string, unknown>;
  const booker = { name: str(b.name, 120), email: str(b.email, 200).toLowerCase(), phone: str(b.phone, 30) };
  if (!booker.name) errors['booker.name'] = 'Enter your name.';
  if (!EMAIL.test(booker.email)) errors['booker.email'] = 'Enter a valid email address.';
  if (!PHONE.test(booker.phone)) errors['booker.phone'] = 'Enter a phone number.';
  const payment = body.payment === 'card' || body.payment === 'cash' ? body.payment : null;
  if (!payment) errors.payment = 'Choose how you would like to pay.';

  if (Object.keys(errors).length) return { errors };
  return { value: { participants, booker, payment: payment!, waiverVersion: str(body.waiverVersion, 40) }, errors };
}

/** Under 18 on the earliest of their class dates means a parent/guardian must sign. */
export function isMinorForSessions(dob: string, sessionIds: number[], sessionDates: Map<number, string>): boolean {
  const dates = sessionIds.map((id) => sessionDates.get(id)).filter((d): d is string => !!d).sort();
  return dates.length > 0 && ageOn(dob, dates[0]) < 18;
}
