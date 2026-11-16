// Usage: npm run import:csv -- path/to/bookings.csv
import { readFileSync } from 'node:fs';
import { closeDb } from '../src/lib/db/client';
import { importCsv } from '../src/lib/importer';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import:csv -- path/to/bookings.csv');
  process.exit(1);
}
const report = await importCsv(readFileSync(file, 'utf8'));
for (const r of report.results) console.log(`line ${r.line}\t${r.outcome}\t${r.name}\t${r.message}`);
console.log(`\nImported ${report.imported} of ${report.results.length} rows.`);
await closeDb();
