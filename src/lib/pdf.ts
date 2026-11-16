import { eq } from 'drizzle-orm';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { getDb, schema } from './db/client';
import { waiverBodyBlocks, waiverSigningText } from './waiver-render';
import { ACKNOWLEDGEMENTS } from './validate';

const INK = rgb(0.227, 0.208, 0.184);
const MUTED = rgb(0.36, 0.34, 0.31);
const ACCENT = rgb(0.184, 0.345, 0.455);

/** Standard PDF fonts only cover Windows-1252; replace anything else so generation never fails. */
const safe = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E -ÿ–—…•]/g, '?');

/** Builds the admin copy of a signed waiver from the stored record. Includes health notes (admin only). */
export async function waiverPdf(waiverId: string): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const db = getDb();
  const [w] = await db.select().from(schema.waivers).where(eq(schema.waivers.id, waiverId));
  if (!w) return null;
  const [version] = await db.select().from(schema.waiverVersions).where(eq(schema.waiverVersions.version, w.waiverVersion));
  const f = w.fields as Record<string, string | boolean | null>;

  const doc = await PDFDocument.create();
  doc.setTitle(`Waiver — ${safe(String(f.fullName))}`);
  doc.setAuthor('Moon & Silks Circus Co');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 56;
  const width = 595.28 - margin * 2; // A4
  let page: PDFPage = doc.addPage([595.28, 841.89]);
  let y = 841.89 - margin;

  const newPageIfNeeded = (h: number) => {
    if (y - h < margin) {
      page = doc.addPage([595.28, 841.89]);
      y = 841.89 - margin;
    }
  };
  const wrap = (text: string, font: PDFFont, size: number, maxW: number) => {
    const words = safe(text).split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxW && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  const write = (text: string, opts: { font?: PDFFont; size?: number; color?: typeof INK; indent?: number; gap?: number } = {}) => {
    const { font = regular, size = 10, color = INK, indent = 0, gap = 4 } = opts;
    for (const line of wrap(text, font, size, width - indent)) {
      newPageIfNeeded(size + 3);
      page.drawText(line, { x: margin + indent, y: y - size, size, font, color });
      y -= size + 3;
    }
    y -= gap;
  };
  const field = (label: string, value: string | null | undefined) => {
    write(`${label}: ${value || '—'}`, { size: 10.5, gap: 2 });
  };

  // Legal text, verbatim from the stored version.
  const text = version?.text;
  for (const b of waiverBodyBlocks(text)) {
    if (b.type === 'org') write(b.text, { font: bold, size: 11, color: MUTED, gap: 2 });
    else if (b.type === 'title') write(b.text, { font: bold, size: 14, color: ACCENT, gap: 8 });
    else if (b.type === 'heading') {
      y -= 4;
      write(b.text, { font: bold, size: 11.5, gap: 3 });
    } else if (b.type === 'list') for (const item of b.items) write(`•  ${item}`, { indent: 10, gap: 1 });
    else write(b.text);
  }
  const signing = waiverSigningText(text);

  y -= 8;
  write(signing.detailsHeading, { font: bold, size: 12, color: ACCENT, gap: 6 });
  field('Full Name', String(f.fullName ?? ''));
  field('Date of Birth', String(f.dateOfBirth ?? ''));
  field('Phone', String(f.phone ?? ''));
  field('Email', String(f.email ?? ''));
  field('Emergency Contact', String(f.emergencyName ?? ''));
  field('Emergency Contact Phone', String(f.emergencyPhone ?? ''));
  y -= 4;
  write('Injuries or medical conditions (added field — CONFIDENTIAL)', { font: bold, size: 10.5, gap: 2 });
  write(f.healthNone ? 'None' : String(f.healthNotes ?? 'Not recorded'), { gap: 8 });

  write('Acknowledgements ticked online', { font: bold, size: 10.5, gap: 2 });
  const acks = w.acknowledgements as Record<string, boolean>;
  for (const a of ACKNOWLEDGEMENTS) write(`[${acks[a.key] ? 'x' : ' '}] ${a.label}`, { indent: 6, gap: 1 });

  y -= 8;
  write(signing.declarationHeading, { font: bold, size: 12, color: ACCENT, gap: 4 });
  write(signing.declaration);
  field('Participant Signature (typed)', w.participantSignature);
  field('Date', w.signedAtPerth);

  if (w.under18) {
    y -= 8;
    write(signing.guardianHeading, { font: bold, size: 12, color: ACCENT, gap: 4 });
    write(signing.guardianStatement);
    field('Parent/Guardian Name', w.guardianName);
    field('Relationship to Participant', w.guardianRelationship);
    field('Signature (typed)', w.guardianSignature);
    field('Date', w.signedAtPerth);
  }

  y -= 10;
  write('Signing record', { font: bold, size: 10, color: MUTED, gap: 2 });
  for (const line of [
    `Signed (UTC): ${w.signedAtUtc.toISOString()}`,
    `Signed (Perth): ${w.signedAtPerth}`,
    `IP address: ${w.ipAddress ?? 'not recorded'}`,
    `Waiver version: ${w.waiverVersion} · SHA-256 ${w.waiverSha256}`,
    `Record ID: ${w.id}`,
  ])
    write(line, { size: 8.5, color: MUTED, gap: 0 });

  const bytes = await doc.save();
  const slug = String(f.fullName ?? 'participant').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { bytes, filename: `waiver-${slug}-${w.signedAtUtc.toISOString().slice(0, 10)}.pdf` };
}
