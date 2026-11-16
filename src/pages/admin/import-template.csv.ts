import type { APIRoute } from 'astro';
import { TEMPLATE_COLUMNS } from '../../lib/importer';
export const prerender = false;

export const GET: APIRoute = () =>
  new Response(TEMPLATE_COLUMNS.join(',') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="existing-bookings-template.csv"' },
  });
