// Seeds the generated prompt bank (idempotent). Usage: pnpm -F @ielts/server exec tsx --env-file-if-exists=../../.env ../../scripts/seed-bank.ts [bankDir]
import { db, sql } from '../apps/server/src/db/client';
import { seedBank } from '../apps/server/src/seed';

const r = await seedBank(db, process.argv[2]);
console.log(`seed: upserted ${r.upserted} prompts, skipped ${r.skipped} invalid entries`);
await sql.end();
