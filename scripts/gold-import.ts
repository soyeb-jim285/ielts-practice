// Upserts data/scoring-gold/scripts.json (written by scripts/gold-build.py) into the scoring_scripts table.
// PRIVATE data: the texts never go into git. Usage: pnpm -F @ielts/server exec tsx ../../scripts/gold-import.ts [--dry] [--prune]
//   --prune  delete rows whose id is no longer in the file
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { scoringScripts } from '../apps/server/src/db/schema';

type Row = typeof scoringScripts.$inferInsert;
const args = process.argv.slice(2);
const file = fileURLToPath(new URL('../data/scoring-gold/scripts.json', import.meta.url));
const rows = (JSON.parse(readFileSync(file, 'utf8')) as Row[]).map(({ createdAt: _c, updatedAt: _u, ...r }) => r);

const bad = rows.filter((r) => !r.id || !r.sha256 || !['anchor', 'calib', 'test', 'probe'].includes(r.role) || !['anchor', 'calibration', 'test'].includes(r.split));
if (bad.length) throw new Error(`invalid rows: ${bad.map((r) => r.id).join(', ')}`);
const count: Record<string, number> = {};
for (const r of rows) count[`${r.skill}/${r.role}`] = (count[`${r.skill}/${r.role}`] ?? 0) + 1;
console.log(`${rows.length} rows: ${Object.entries(count).map(([g, n]) => `${g}=${n}`).join(' ')}`);
if (args.includes('--dry')) process.exit(0);

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // env may come from the shell instead
}
// server modules parse env on import, so load them only after .env
const { db, sql } = await import('../apps/server/src/db/client');
const { scoringScripts: table } = await import('../apps/server/src/db/schema');
for (const r of rows) {
  const { id: _id, ...set } = r;
  await db.insert(table).values(r).onConflictDoUpdate({ target: table.id, set: { ...set, updatedAt: new Date() } });
}
if (args.includes('--prune')) {
  const gone = await sql`delete from scoring_scripts where not (id = any(${rows.map((r) => r.id)})) returning id`;
  console.log(`pruned ${gone.length}`);
}
console.log(`upserted ${rows.length} scoring_scripts rows`);
await sql.end();
