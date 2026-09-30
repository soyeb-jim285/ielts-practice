// Imports data/cambridge/C*.json (written by cambridge-extract.py) as restricted prompts, uploading T1 figures to R2 cambridge/….
// PRIVATE data: never commit the output. Usage: pnpm tsx scripts/cambridge-import.ts [--dry] [dataDir]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { prompts as promptsTable } from '../apps/server/src/db/schema';

type Row = typeof promptsTable.$inferInsert;
type QBlock = { topic: string; questions: string[] };
type Test = {
  book: number;
  test: string;
  variant: 'academic' | 'general';
  image?: string;
  writing: { t1?: { body: string; hasFigure: boolean }; t2?: { body: string } };
  speaking: { p1?: QBlock[]; p2?: { title: string; bullets: string[]; explain: string } | null; p3?: QBlock[] } | null;
};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const dir = args.find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../data/cambridge/', import.meta.url));

const firstSentence = (s: string) => {
  const t = s.split(/(?<=[.?!])\s|\n/)[0]!.trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
};

function t1Type(body: string, variant: Test['variant']) {
  if (variant === 'general') return /Dear (Sir|Madam)/i.test(body) ? 'letter-formal' : /Dear (Mr|Mrs|Ms|Miss|Dr)\b/.test(body) ? 'letter-semi' : 'letter-informal';
  const b = body.toLowerCase();
  if (/\b(maps?|plans?)\b/.test(b)) return 'map';
  if (/\b(process|diagram|stages|how .* (is|are) (made|produced))\b/.test(b)) return 'process';
  const kinds = ['table', 'pie', 'graph', 'bar'].filter((k) => b.includes(k));
  if (kinds.length > 1 || /\b(charts|and (a )?(chart|graph|table))\b/.test(b)) return 'mixed';
  return kinds[0] === 'graph' ? 'line' : kinds[0] ?? (b.includes('chart') ? 'bar' : 'mixed');
}

function t2Type(body: string) {
  if (/discuss both/i.test(body)) return 'discussion';
  if (/advantages[\s\S]*disadvantages/i.test(body)) return 'adv-disadv';
  if (/(causes|problems?)[\s\S]*(solutions?|measures|solve)/i.test(body)) return 'problem-solution';
  if (/agree or disagree|to what extent|positive or (a )?negative/i.test(body)) return 'opinion';
  return (body.match(/\?/g)?.length ?? 0) > 1 ? 'two-part' : 'opinion';
}

function rows(t: Test): { rows: Row[]; image?: { file: string; key: string } } {
  const id = `cam-${t.book}-${t.test}`;
  const base = { source: 'cambridge' as const, sourceRef: `C${t.book} T${t.test}`, restricted: true };
  const topic = `Cambridge ${t.book}`;
  const out: Row[] = [];
  let image: { file: string; key: string } | undefined;
  const { t1, t2 } = t.writing;
  if (t1?.body) {
    const bullets = t1.body.split('\n').filter((l) => l.startsWith('• ')).map((l) => l.slice(2));
    if (t1.hasFigure && t.image) image = { file: join(dir, t.image), key: `cambridge/C${t.book}T${t.test}.png` };
    out.push({ ...base, slug: `${id}-w1`, skill: 'writing', part: 1, variant: t.variant, type: t1Type(t1.body, t.variant), topic, title: firstSentence(t1.body), body: t1.body, bullets: bullets.length ? bullets : null, imageKey: image?.key ?? null });
  }
  if (t2?.body) out.push({ ...base, slug: `${id}-w2`, skill: 'writing', part: 2, type: t2Type(t2.body), topic, title: firstSentence(t2.body), body: t2.body });
  const sp = t.speaking;
  (sp?.p1 ?? []).filter((b) => b.questions.length).forEach((b, i) => {
    out.push({ ...base, slug: i ? `${id}-p1-${i + 1}` : `${id}-p1`, skill: 'speaking', part: 1, type: 'p1-topic', topic: b.topic, title: b.topic, body: b.questions[0]!, followUps: b.questions });
  });
  const p3 = (sp?.p3 ?? []).flatMap((b) => b.questions);
  const group = sp?.p2 ? `${id}-p2` : null;
  if (sp?.p2) {
    const { title, bullets, explain } = sp.p2;
    out.push({ ...base, slug: `${id}-p2`, skill: 'speaking', part: 2, type: 'cue-card', topic: sp.p3?.[0]?.topic ?? topic, title, body: `${title}\n${explain}`, bullets, followUps: [], groupId: group });
  }
  if (p3.length) {
    const title = sp?.p2 ? `Discussion: ${sp.p2.title.replace(/^Describe\s+/i, '')}` : sp!.p3![0]!.topic;
    out.push({ ...base, slug: `${id}-p3`, skill: 'speaking', part: 3, type: group ? 'p3-linked' : 'p3-discussion', topic: sp!.p3![0]!.topic, title, body: p3[0]!, followUps: p3, groupId: group });
  }
  return { rows: out, image };
}

if (!dry) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch {
    // env may come from the shell instead
  }
}
const files = readdirSync(dir).filter((f) => /^C\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
if (!files.length) throw new Error(`no C*.json in ${dir} - run scripts/cambridge-extract.py first`);

// server modules parse env on import, so load them only after .env
const server = dry ? null : { ...(await import('../apps/server/src/db/client')), ...(await import('../apps/server/src/storage')), ...(await import('../apps/server/src/db/schema')) };
let total = 0;
// extraction can pick up the same test twice (e.g. from sample-answer pages): skip tests whose T2 / cue card was already seen
const seen = new Set<string>();
const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().slice(0, 120);
const isDup = (t: Test) => {
  const keys = [norm(t.writing.t2?.body), norm(t.speaking?.p2?.title)].filter(Boolean);
  const dup = keys.length > 0 && keys.every((k) => seen.has(k));
  keys.forEach((k) => seen.add(k));
  return dup;
};
for (const f of files) {
  const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { book: number; tests: Test[] };
  const book = parsed.book;
  const tests = parsed.tests.filter((t) => !isDup(t));
  const built = tests.map(rows);
  const all = built.flatMap((b) => b.rows);
  let imgs = 0;
  if (server) {
    const { db, storage, prompts } = server;
    for (const { image } of built) {
      if (!image || !existsSync(image.file)) continue;
      await storage.put(image.key, readFileSync(image.file), 'image/png');
      imgs++;
    }
    for (const r of all) {
      const { slug: _slug, ...rest } = r;
      await db.insert(prompts).values(r).onConflictDoUpdate({ target: prompts.slug, set: rest });
    }
  } else {
    imgs = built.filter((b) => b.image && existsSync(b.image.file)).length;
    console.log(JSON.stringify(all.slice(0, 7), null, 1));
  }
  const n = (skill: string, part: number) => all.filter((r) => r.skill === skill && r.part === part).length;
  console.log(`C${book}: ${tests.length} tests, ${all.length} prompts (w1 ${n('writing', 1)}, w2 ${n('writing', 2)}, p1 ${n('speaking', 1)}, p2 ${n('speaking', 2)}, p3 ${n('speaking', 3)}), ${imgs} images${dry ? ' [dry run]' : ''}`);
  total += all.length;
}
console.log(`cambridge: ${dry ? 'would upsert' : 'upserted'} ${total} prompts`);
if (server) await server.sql.end();
