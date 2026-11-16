// Knocks out the near-white background of the supplied logo and writes web-sized PNG/WebP assets.
// Uses "colour to alpha" against white so soft watercolour edges keep their tone on any light page.
import sharp from 'sharp';

const SRC = 'assets/Aerial-Silks-Logo.jpg';
const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });

// Estimate the paper colour from the corners and treat it as white.
const sample = (x, y) => { const i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
const corners = [[5, 5], [info.width - 6, 5], [5, info.height - 6], [info.width - 6, info.height - 6]].map(([x, y]) => sample(x, y));
const paper = [0, 1, 2].map((c) => Math.min(...corners.map((p) => p[c])) - 2);

const out = Buffer.alloc(info.width * info.height * 4);
for (let p = 0; p < info.width * info.height; p++) {
  const rgb = [0, 1, 2].map((c) => Math.min(255, (data[p * 3 + c] * 255) / paper[c]));
  let a = Math.max(...rgb.map((v) => (255 - v) / 255));
  a = a < 0.03 ? 0 : Math.min(1, (a - 0.03) / 0.97);
  for (let c = 0; c < 3; c++) out[p * 4 + c] = a ? Math.max(0, Math.min(255, Math.round((rgb[c] - 255 * (1 - a)) / a))) : 255;
  out[p * 4 + 3] = Math.round(a * 255);
}
const cut = sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } });
const trimmed = await cut.png().toBuffer().then((b) => sharp(b).trim({ threshold: 1 }).png().toBuffer());

const write = (size) => sharp(trimmed).resize({ width: size, height: size, fit: 'inside' });
await write(512).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile('public/logo.png');
await sharp(trimmed).resize({ height: 160 }).webp({ quality: 85, alphaQuality: 90 }).toFile('public/logo-header.webp');
await write(640).webp({ quality: 82, alphaQuality: 90 }).toFile('public/logo-640.webp');
await write(1024).webp({ quality: 82, alphaQuality: 90 }).toFile('public/logo-1024.webp');
// Icons on cream, padded square.
const cream = { r: 255, g: 249, b: 241, alpha: 1 };
const icon = (size) => sharp(trimmed).resize({ width: Math.round(size * 0.9), height: Math.round(size * 0.9), fit: 'contain', background: { ...cream, alpha: 0 } })
  .extend({ top: Math.round(size * 0.05), bottom: Math.round(size * 0.05), left: Math.round(size * 0.05), right: Math.round(size * 0.05), background: { ...cream, alpha: 0 } })
  .resize(size, size).flatten({ background: cream });
await icon(180).png().toFile('public/apple-touch-icon.png');
await icon(32).png().toFile('public/favicon-32.png');
await icon(192).png().toFile('public/icon-192.png');
// Open Graph image: logo centred on cream.
const og = await sharp(trimmed).resize({ height: 540, fit: 'inside' }).toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: cream } }).composite([{ input: og, gravity: 'centre' }]).jpeg({ quality: 85 }).toFile('public/og-image.jpg');
for (const f of ['logo.png', 'logo-header.webp', 'logo-640.webp', 'logo-1024.webp']) {
  const m = await sharp('public/' + f).metadata(); console.log(f, m.width, 'x', m.height);
}
console.log('paper', paper);
