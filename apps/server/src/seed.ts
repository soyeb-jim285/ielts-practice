import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { ChartSpec } from './ai/types';
import type { DB } from './db/client';
import { prompts } from './db/schema';

type Row = typeof prompts.$inferInsert;

export const DEFAULT_BANK_DIR = fileURLToPath(new URL('../../../data/bank/', import.meta.url));

const str = z.string().trim().min(1);
const strs = z.array(str).min(1);
const sameLen = (n: number, arrs: unknown[][]) => arrs.every((a) => a.length === n);

const Chart: z.ZodType<ChartSpec> = z.union([
  z
    .object({ kind: z.enum(['line', 'bar']), title: str, xLabel: z.string(), yLabel: z.string(), unit: z.string(), categories: strs, series: z.array(z.object({ name: str, values: z.array(z.number()) })).min(1) })
    .refine((c) => sameLen(c.categories.length, c.series.map((s) => s.values)), 'series length must match categories'),
  z.object({ kind: z.literal('pie'), title: str, unit: z.string(), pies: z.array(z.object({ name: str, slices: z.array(z.object({ label: str, value: z.number() })).min(1) })).min(1) }),
  z
    .object({ kind: z.literal('table'), title: str, columns: strs, rows: z.array(z.array(z.union([z.string(), z.number()]))).min(1) })
    .refine((c) => sameLen(c.columns.length, c.rows), 'row length must match columns'),
  z.object({ kind: z.literal('process'), title: str, steps: strs }),
  z.object({ kind: z.literal('map'), title: str, before: z.object({ label: str, features: strs }), after: z.object({ label: str, features: strs }) }),
]);

const topic = str.transform((t) => t[0]!.toUpperCase() + t.slice(1));
const Base = z.object({ slug: str.regex(/^[a-z0-9-]+$/), topic });
/** First sentence of a writing prompt, used as its list title. */
const firstSentence = (s: string) => {
  const t = s.split(/(?<=[.?!])\s|\n/)[0]!.trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
};

/** Bank file kinds by filename prefix: entry schema and the prompt rows each entry becomes. Also used by scripts/gen-bank.ts. */
export const BANK_KINDS: { prefix: string; schema: z.ZodType; rows: (e: any) => Row[] }[] = [
  {
    prefix: 'speaking-p1',
    schema: Base.extend({ questions: strs }),
    rows: (e) => [{ slug: e.slug, skill: 'speaking', part: 1, type: 'p1-topic', topic: e.topic, title: e.topic, body: e.questions[0], followUps: e.questions }],
  },
  {
    prefix: 'speaking-p2',
    schema: Base.extend({ title: str, bullets: strs, explain: str, followUps: z.array(str), p3: strs }),
    rows: (e) => [
      { slug: e.slug, skill: 'speaking', part: 2, type: 'cue-card', topic: e.topic, title: e.title, body: `${e.title}\n${e.explain}`, bullets: e.bullets, followUps: e.followUps, groupId: e.slug },
      { slug: `${e.slug}-p3`, skill: 'speaking', part: 3, type: 'p3-linked', topic: e.topic, title: `Discussion: ${e.title.replace(/^Describe\s+/i, '')}`, body: e.p3[0], followUps: e.p3, groupId: e.slug },
    ],
  },
  {
    prefix: 'speaking-p3',
    schema: Base.extend({ questions: strs }),
    rows: (e) => [{ slug: e.slug, skill: 'speaking', part: 3, type: 'p3-discussion', topic: e.topic, title: e.topic, body: e.questions[0], followUps: e.questions }],
  },
  {
    prefix: 'writing-t2',
    schema: Base.extend({ type: z.enum(['opinion', 'discussion', 'problem-solution', 'adv-disadv', 'two-part']), body: str }),
    rows: (e) => [{ slug: e.slug, skill: 'writing', part: 2, type: e.type, topic: e.topic, title: firstSentence(e.body), body: e.body }],
  },
  {
    prefix: 'writing-t1a',
    schema: Base.extend({ type: z.enum(['line', 'bar', 'pie', 'table', 'mixed', 'process', 'map']), body: str, chart: Chart }),
    rows: (e) => [{ slug: e.slug, skill: 'writing', part: 1, variant: 'academic', type: e.type, topic: e.topic, title: e.chart.title, body: e.body, chart: e.chart }],
  },
  {
    prefix: 'writing-t1g',
    schema: Base.extend({ type: z.enum(['letter-formal', 'letter-semi', 'letter-informal']), body: str, bullets: strs }),
    rows: (e) => [{ slug: e.slug, skill: 'writing', part: 1, variant: 'general', type: e.type, topic: e.topic, title: firstSentence(e.body), body: e.body, bullets: e.bullets }],
  },
];

const excluded = (c: PgColumn) => sql.raw(`excluded."${c.name}"`);

/** Upserts the generated bank from data/bank/*.json (idempotent on slug). Invalid entries are skipped with a warning. */
export async function seedBank(db: DB, dir = DEFAULT_BANK_DIR, warn: (msg: string) => void = console.warn) {
  const bySlug = new Map<string, Row>();
  let skipped = 0;
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
    const kind = BANK_KINDS.find((k) => file.startsWith(k.prefix));
    if (!kind) {
      warn(`seed: ${file}: unknown bank file prefix, skipped`);
      continue;
    }
    let entries: unknown;
    try {
      entries = JSON.parse(await readFile(join(dir, file), 'utf8'));
    } catch (e) {
      warn(`seed: ${file}: ${(e as Error).message}`);
      continue;
    }
    if (!Array.isArray(entries)) {
      warn(`seed: ${file}: expected a JSON array`);
      continue;
    }
    entries.forEach((raw, i) => {
      const r = kind.schema.safeParse(raw);
      if (!r.success) {
        skipped++;
        return warn(`seed: ${file}[${i}] skipped: ${r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
      }
      for (const row of kind.rows(r.data)) {
        if (bySlug.has(row.slug)) warn(`seed: duplicate slug ${row.slug} (${file}), last one wins`);
        bySlug.set(row.slug, row);
      }
    });
  }
  const rows = [...bySlug.values()];
  const p = prompts;
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(p)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: p.slug,
        set: {
          skill: excluded(p.skill), part: excluded(p.part), variant: excluded(p.variant), type: excluded(p.type), topic: excluded(p.topic),
          title: excluded(p.title), body: excluded(p.body), bullets: excluded(p.bullets), followUps: excluded(p.followUps), chart: excluded(p.chart), groupId: excluded(p.groupId),
        },
      });
  }
  return { upserted: rows.length, skipped };
}
