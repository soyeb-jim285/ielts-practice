// Re-marks submitted Listening & Reading attempts with the current marking rules (run once after a marker fix) and saves
// raw, band, marks and analysis where the score changed. Idempotent.
// Usage: pnpm -F @ielts/server exec tsx --env-file-if-exists=../../.env src/lr-rescore.ts [--dry]   (in the app container: node --import tsx src/lr-rescore.ts [--dry])
import { and, eq } from 'drizzle-orm';
import { db, sql } from './db/client';
import { lrAttempts, lrTests } from './db/schema';
import { analyseAttempt, pickParts, scoreLr } from '@ielts/core';

const dry = process.argv.includes('--dry');
const rows = await db.select({ a: lrAttempts, t: lrTests }).from(lrAttempts).innerJoin(lrTests, eq(lrTests.id, lrAttempts.testId)).where(eq(lrAttempts.status, 'submitted'));
let changed = 0;
for (const { a, t } of rows) {
  const test = pickParts(t.data, a.parts);
  const responses = Object.fromEntries(Object.entries((a.responses ?? {}) as Record<string, string>).map(([k, v]) => [+k, v]));
  const score = scoreLr(test, responses);
  if (score.raw === a.raw) continue;
  changed++;
  console.log(`${a.id} ${t.ref}: ${a.raw} → ${score.raw}`);
  if (dry) continue;
  // ponytail: no prior-mistake counts here (the "missed before" hints of the original submit are not rebuilt)
  const analysis = analyseAttempt(test, score.marks, responses);
  await db.update(lrAttempts).set({ raw: score.raw, band: a.parts ? null : score.band, marks: score.marks, analysis }).where(and(eq(lrAttempts.id, a.id), eq(lrAttempts.status, 'submitted')));
}
console.log(`${dry ? 'would re-mark' : 're-marked'} ${changed} of ${rows.length} attempts`);
await sql.end();
