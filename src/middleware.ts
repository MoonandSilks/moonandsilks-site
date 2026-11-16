import { defineMiddleware } from 'astro:middleware';
import { isAdmin } from './lib/auth';

const PUBLIC_ADMIN = new Set(['/admin/login', '/api/admin/login']);

/** Guards every admin page and admin API. Nothing sensitive is served without a valid session. */
export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname.replace(/\/$/, '') || '/';
  const isAdminPath = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');
  if (!isAdminPath) return next();

  if (!PUBLIC_ADMIN.has(path) && !isAdmin(ctx.cookies)) {
    if (path.startsWith('/api/')) return new Response('Unauthorised', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    return ctx.redirect('/admin/login', 303);
  }
  const res = await next();
  res.headers.set('Cache-Control', 'no-store, private');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
});
