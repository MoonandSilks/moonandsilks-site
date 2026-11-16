import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { env } from './env';

export const COOKIE = 'ms_admin';
const TTL_SECONDS = 60 * 60 * 12; // 12 hours

const sign = (payload: string) => createHmac('sha256', env.authSecret!).update(payload).digest('base64url');
const sha = (s: string) => createHash('sha256').update(s).digest();

export function adminConfigured(): boolean {
  return !!env.adminPassword && !!env.authSecret && env.authSecret.length >= 32;
}

export function checkPassword(input: string): boolean {
  if (!adminConfigured()) return false;
  return timingSafeEqual(sha(input), sha(env.adminPassword!));
}

export function issueSession(cookies: AstroCookies, secure: boolean) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `admin.${exp}`;
  cookies.set(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: TTL_SECONDS });
}

export function clearSession(cookies: AstroCookies) {
  cookies.delete(COOKIE, { path: '/' });
}

export function isAdmin(cookies: AstroCookies): boolean {
  if (!adminConfigured()) return false;
  const v = cookies.get(COOKIE)?.value;
  if (!v) return false;
  const [who, exp, mac] = v.split('.');
  if (who !== 'admin' || !exp || !mac) return false;
  const expected = Buffer.from(sign(`${who}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(exp) > Date.now() / 1000;
}
