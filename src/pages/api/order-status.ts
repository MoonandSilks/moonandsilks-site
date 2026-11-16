import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../lib/db/client';

export const prerender = false;

/** Lets the confirmation page poll until the webhook lands. Returns status only. */
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('o') ?? '';
  const [order] = token
    ? await getDb().select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.publicToken, token))
    : [];
  return new Response(JSON.stringify({ status: order?.status ?? 'unknown' }), {
    status: order ? 200 : 404,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
