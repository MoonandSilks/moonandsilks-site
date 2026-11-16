import { TIMEZONE } from './env';

/** YYYY-MM-DD of an instant in Perth. */
export function perthDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** HH:MM (24h) of an instant in Perth. */
export function perthTime24(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** "Saturday 28 November" */
export function formatDay(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

/** "Sat 28 Nov" */
export function formatDayShort(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TIMEZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/** "9:00 am" */
export function formatTime(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(d)
    .replace(/\s?([ap])\.?m\.?/i, ' $1m')
    .toLowerCase();
}

/** "16/11/2026, 3:04:05 pm AWST" style stamp for records. */
export function perthStamp(d: Date): string {
  return (
    new Intl.DateTimeFormat('en-AU', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d) + ' AWST (Australia/Perth)'
  );
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whole years between DOB and a date (both YYYY-MM-DD). */
export function ageOn(dob: string, onDate: string): number {
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

export function outsideBand(age: number, min: number | null, max: number | null): boolean {
  return (min !== null && age < min) || (max !== null && age > max);
}
