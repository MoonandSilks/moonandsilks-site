import { WAIVER_TEXT } from './waiver-text';

export type Block =
  | { type: 'org'; text: string }
  | { type: 'title'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] };

const SPLIT = 'PARTICIPANT DETAILS';

/** Parses waiver text (sections 1–10) into blocks without altering any wording. */
export function waiverBodyBlocks(text = WAIVER_TEXT): Block[] {
  const body = text.slice(0, text.indexOf(SPLIT));
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: Block[] = [];
  lines.forEach((line, i) => {
    if (i === 0) return blocks.push({ type: 'org', text: line });
    if (i === 1) return blocks.push({ type: 'title', text: line });
    if (/^\d+\.\s/.test(line)) return blocks.push({ type: 'heading', text: line });
    if (line.startsWith('- ')) {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'list') last.items.push(line.slice(2));
      else blocks.push({ type: 'list', items: [line.slice(2)] });
      return;
    }
    blocks.push({ type: 'p', text: line });
  });
  return blocks;
}

/** The signing-section wording (headings and sentences) that sits around the form fields. */
export function waiverSigningText(text = WAIVER_TEXT) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const after = (heading: string) => lines[lines.findIndex((l) => l.startsWith(heading)) + 1];
  const guardianHeading = lines.find((l) => l.startsWith('PARENT / LEGAL GUARDIAN'))!;
  return {
    detailsHeading: SPLIT,
    declarationHeading: 'PARTICIPANT DECLARATION',
    declaration: after('PARTICIPANT DECLARATION'),
    guardianHeading,
    guardianStatement: after('PARENT / LEGAL GUARDIAN'),
  };
}
