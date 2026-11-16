import type { APIRoute } from 'astro';
import { rosterCsv } from '../../lib/admin';
export const prerender = false;

/** Sensitive download: includes health notes. Protected by middleware. */
export const GET: APIRoute = async ({ url }) => {
  const session = url.searchParams.get('session');
  const id = session ? Number(session) : undefined;
  const csv = await rosterCsv(Number.isInteger(id) ? id : undefined);
  const name = id ? `roster-session-${id}` : 'rosters-all';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-SENSITIVE.csv"`,
      'Cache-Control': 'no-store, private',
    },
  });
};
