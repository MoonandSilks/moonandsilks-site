import type { APIRoute } from 'astro';
import { checkPassword, issueSession } from '../../../lib/auth';
export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const form = await request.formData().catch(() => null);
  const password = String(form?.get('password') ?? '');
  if (!password || !checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return redirect('/admin/login?failed', 303);
  }
  issueSession(cookies, url.protocol === 'https:');
  return redirect('/admin', 303);
};
