import type { APIRoute } from 'astro';
import { waiverPdf } from '../../../lib/pdf';
export const prerender = false;

const UUID = /^[0-9a-f-]{36}$/i;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  const pdf = UUID.test(id) ? await waiverPdf(id) : null;
  if (!pdf) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(pdf.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdf.filename}"`,
      'Cache-Control': 'no-store, private',
    },
  });
};
