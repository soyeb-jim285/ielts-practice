// Generates new prompt-bank entries with an LLM and appends them to data/bank/<file> (validated with the seeder's schemas, deduped by slug).
// Usage: pnpm -F @ielts/server exec tsx --env-file-if-exists=../../.env ../../scripts/gen-bank.ts <bank file, e.g. writing-t2-b.json> [count=10] [model]
// Then review the diff and run scripts/seed-bank.ts.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chatText } from '../apps/server/src/ai/openrouter';
import { BANK_KINDS, DEFAULT_BANK_DIR } from '../apps/server/src/seed';

const BATCH = 10;
const [file, count = '10', model = 'openai/gpt-6-luna'] = process.argv.slice(2);
const kind = BANK_KINDS.find((k) => file?.startsWith(k.prefix));
if (!file || !kind) throw new Error(`usage: gen-bank.ts <${BANK_KINDS.map((k) => `${k.prefix}*.json`).join(' | ')}> [count] [model]`);

const read = async (f: string): Promise<{ slug: string }[]> => JSON.parse(await readFile(join(DEFAULT_BANK_DIR, f), 'utf8').catch(() => '[]'));
const entries = await read(file);
const siblings = (await readdir(DEFAULT_BANK_DIR)).filter((f) => f.startsWith(kind.prefix));
const existing = (await Promise.all(siblings.map(read))).flat();
const slugs = new Set(existing.map((e) => e.slug));
if (!existing.length) throw new Error(`no existing ${kind.prefix} entries to use as the format example`);

const SYSTEM = `You write original practice prompts for the IELTS test, matching the official test's wording, difficulty and topic range.
Return ONLY a JSON array of new entries in exactly the same JSON shape as the examples. Slugs are unique, lowercase kebab-case with the same prefix style.
Never reuse or paraphrase an existing slug's subject; cover varied everyday and academic topics.`;

for (let made = 0, tries = 0; made < +count && tries < 10; tries++) {
  const n = Math.min(BATCH, +count - made);
  const reply = await chatText({
    model,
    temperature: 0.9,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify({ write: n, examples: existing.slice(0, 2), existingSlugs: [...slugs] }) },
    ],
  });
  let batch: unknown[] = [];
  try {
    batch = JSON.parse(reply.slice(reply.indexOf('['), reply.lastIndexOf(']') + 1));
  } catch {
    console.warn('gen-bank: unreadable batch, retrying');
  }
  for (const raw of batch.slice(0, n)) {
    const r = kind.schema.safeParse(raw);
    if (!r.success) console.warn('gen-bank: invalid entry skipped:', r.error.issues[0]?.message);
    else if (slugs.has((raw as { slug: string }).slug)) console.warn('gen-bank: duplicate slug skipped:', (raw as { slug: string }).slug);
    else {
      slugs.add((raw as { slug: string }).slug);
      entries.push(raw as { slug: string });
      made++;
    }
  }
  console.log(`gen-bank: ${made}/${count}`);
}
await writeFile(join(DEFAULT_BANK_DIR, file), `${JSON.stringify(entries, null, 2)}\n`);
console.log(`gen-bank: ${file} now has ${entries.length} entries`);
