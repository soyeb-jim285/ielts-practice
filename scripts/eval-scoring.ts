// Writing scoring harness (docs/scoring-research.md §4.5). Scores the private gold set with the production scorer, caches every raw
// scoring sample, prints the agreement panel, per-band error 3..9 and probe checks, and with --fit writes the per-model calibration record.
//
//   pnpm eval:scoring --model <id> --split calib|test|probe [--fit] [--activate] [--k 3] [--ablate per-criterion]
//                     [--feedback] [--limit N] [--ids a,b] [--conc 16] [--yes]
//
// --fit (calib split): leave-one-group-out fitCalibration on the raw means, CV panel on out-of-fold predictions, record written to
//   scoring_calibrations (active only with --activate and a passing gate). Other splits apply the key's active record, else identity.
// --feedback also runs the feedback call (the production path), so a major task.relevance error can cap the overall; off by default to save
//   cost: scoring alone decides the calibration, and the TA ≤ 4 cap still applies.
// Raw outputs are cached in .eval/scoring-cache/<model>/<promptHash>-<effort>-k<K>-<mode>/<id>-<sha8>.json (gitignored): a rerun only pays
// for new scripts or a changed prompt. Script text never leaves the DB / .eval.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
// Relative imports: bare specifiers do not resolve from scripts/ (no root node_modules for workspace packages).
import { agreement, BAND_GROUPS, fitCalibration, pairedBootstrap, type Agreement } from '../packages/core/src/index';
import { db, sql } from '../apps/server/src/db/client';
import { scoringCalibrations, type scoringScripts } from '../apps/server/src/db/schema';
import { asCalibration, calibrationKey, getCalibration, type Calibration } from '../apps/server/src/ai/calibration';
import { listModels, setFetch } from '../apps/server/src/ai/openrouter';
import { loadAnchors, promptHash, WRITING_KEYS, type ScoringMode } from '../apps/server/src/ai/prompts';
import { analyzeWriting, ownWords, scoreWriting, settleWriting, TOO_SHORT_WORDS, WRITING_EFFORT, WRITING_K, type Scored, type WritingInput } from '../apps/server/src/ai/writing';
import { DEFAULT_SETTINGS } from '../apps/server/src/settings';
import { storage } from '../apps/server/src/storage';

const { values: a } = parseArgs({
  options: {
    model: { type: 'string', default: DEFAULT_SETTINGS.models.analysis }, split: { type: 'string', default: 'calib' }, k: { type: 'string', default: '3' },
    fit: { type: 'boolean' }, activate: { type: 'boolean' }, fitted: { type: 'boolean' }, ablate: { type: 'string' }, feedback: { type: 'boolean' },
    limit: { type: 'string' }, ids: { type: 'string' }, conc: { type: 'string', default: '16' }, yes: { type: 'boolean' },
  },
});
const K = Number(a.k), model = a.model!, split = a.split === 'calibration' ? 'calib' : a.split!;
// User decision 2026-09-30: Qwen is too slow (repeated >90 s timeouts); validate luna + deepseek only.
if (/qwen/i.test(model)) { console.error('SKIPPED: Qwen was dropped by the user (too slow). Do not retry it; finish with openai/gpt-6-luna and deepseek/deepseek-v4.1-flash only.'); process.exit(0); }
if (!['calib', 'test', 'probe'].includes(split)) throw new Error('--split calib|test|probe');
if (a.ablate && a.ablate !== 'per-criterion') throw new Error('--ablate per-criterion');
if (a.feedback && (a.ablate || K !== WRITING_K)) throw new Error('--feedback runs the production path: joint mode, K = WRITING_K');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const settings = { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, analysis: model } };

// ---------- scripts ----------
type Row = typeof scoringScripts.$inferSelect;
let rows = (await sql<Row[]>`select id, skill, task_family as "taskFamily", role, split, band, group_id as "groupId", prompt, text, note, expect, sha256
  from scoring_scripts where skill = 'writing' and ${split === 'probe' ? sql`role = 'probe' and split <> 'anchor'` : sql`role = ${split} and split = ${split === 'calib' ? 'calibration' : 'test'}`} order by id`).slice();
if (a.ids) rows = rows.filter((r) => a.ids!.split(',').includes(r.id));
if (a.limit) rows = rows.slice(0, Number(a.limit));
if (rows.some((r) => r.role === 'anchor' || r.split === 'anchor')) throw new Error('refusing to score an anchor');
const anchors = await loadAnchors();
if (rows.some((r) => anchors.some((x) => x.promptBody.trim() === (r.prompt?.body ?? '').trim()))) throw new Error('a scored script shares its prompt with an anchor');
if (!rows.length) throw new Error('no scripts selected');

const slugs = rows.map((r) => r.prompt?.slug).filter((s): s is string => !!s);
const charts = new Map((await sql<{ slug: string; chart: unknown }[]>`select slug, chart from prompts where slug = any(${slugs}) and chart is not null`).map((p) => [p.slug, p.chart]));
async function input(r: Row): Promise<WritingInput> {
  const p = r.prompt ?? { title: '', body: '' };
  const chart = (p.slug && charts.get(p.slug)) || undefined;
  const image = !chart && p.imageKey ? await storage.get(p.imageKey).then((b) => `data:image/png;base64,${Buffer.from(b).toString('base64')}`, () => null) : null;
  return { text: r.text ?? '', task: r.taskFamily === 't2' ? 2 : 1, variant: r.taskFamily === 't1g' ? 'general' : 'academic', prompt: { title: p.title, body: p.body, bullets: p.bullets, chart, image }, settings };
}

// ---------- scoring with cache ----------
let cost = 0;
setFetch(async (url, init) => {
  const res = await fetch(url, init);
  if (!String(url).includes('/chat/completions') || !res.ok) return res;
  const u = ((await res.clone().json().catch(() => ({}))) as { usage?: { cost?: number } }).usage?.cost ?? 0;
  cost += u; // not `cost += await …`: that reads cost before the await and loses concurrent calls
  return res;
});
type Cached = Scored & { id: string; offTopic?: boolean; ms: number; tooShort?: boolean };
const dirOf = (mode: ScoringMode) => `${ROOT}.eval/scoring-cache/${model.replace(/\W/g, '_')}/${promptHash(anchors, mode)}-${WRITING_EFFORT}-k${K}-${mode}${a.feedback ? '-fb' : ''}`;
const fileOf = (mode: ScoringMode, r: Row) => `${dirOf(mode)}/${r.id}-${r.sha256.slice(0, 8)}.json`;
const read = (f: string): Cached | undefined => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined);

async function scoreAll(mode: ScoringMode): Promise<Map<string, Cached>> {
  mkdirSync(dirOf(mode), { recursive: true });
  const out = new Map<string, Cached>(), todo = rows.filter((r) => { const c = read(fileOf(mode, r)); if (c) out.set(r.id, c); return !c; });
  if (todo.length) {
    const m = (await listModels()).find((x) => x.id === model);
    const calls = (mode === 'joint' ? K : 4 * K) + (a.feedback ? 1 : 0);
    // ponytail: rough per-call token guess (6k in / 1.5k out, anchors included); the real spend is printed at the end.
    const est = m ? todo.length * calls * (6000 * Number(m.pricing.prompt) + 1500 * Number(m.pricing.completion)) : NaN;
    console.error(`${mode}: ${todo.length} to score (${out.size} cached), ~${calls} calls each, estimated $${est.toFixed(2)}`);
    if (!(est <= 5) && !a.yes) throw new Error('estimated cost above $5 (or unknown model price): pass --yes');
  }
  const queue = [...todo];
  await Promise.all(Array.from({ length: Number(a.conc) }, async () => {
    for (let r; (r = queue.shift()); ) {
      for (let attempt = 0; ; attempt++) {
        try {
          const t0 = Date.now(), inp = await input(r);
          let scored!: Scored, offTopic: boolean | undefined, tooShort: true | undefined;
          // Production rule: 20 own words or fewer is Band 1 with no AI call (analyzeWriting); cached as empty samples.
          if (ownWords(inp) <= TOO_SHORT_WORDS) [scored, tooShort] = [{ samples: [], served: [], flags: [], words: 0, copied: 0, figure: 'none', family: 't2', promptHash: '', key: '' }, true];
          else if (a.feedback && mode === 'joint') {
            const res = await analyzeWriting({ ...inp, onScored: (s) => (scored = s) });
            offTopic = res.errors.some((e) => e.category === 'task.relevance' && e.severity === 'major');
          } else scored = await scoreWriting(inp, { mode, k: K });
          const c: Cached = { id: r.id, ...scored, offTopic, tooShort, ms: Date.now() - t0 };
          writeFileSync(fileOf(mode, r), JSON.stringify(c));
          out.set(r.id, c);
          console.error(`  ${r.id} m=${tooShort ? 'band 1 (too short)' : (WRITING_KEYS.reduce((s, k) => s + c.samples.reduce((t, x) => t + x[k].band, 0) / c.samples.length, 0) / 4).toFixed(2)} official=${r.band ?? '-'} ${c.ms} ms`);
          break;
        } catch (e) {
          if (attempt >= 2) { console.error(`  FAILED ${r.id}`, (e as Error).message); break; }
          await new Promise((res) => setTimeout(res, 5000));
        }
      }
    }
  }));
  return out;
}

// ---------- panel ----------
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const ci = (g: Agreement, k: string) => (g.ci[k] ? ` [${f2(g.ci[k][0])}, ${f2(g.ci[k][1])}]` : '');
function panel(title: string, g: Agreement) {
  console.log(`\n### ${title} (n=${g.n})\n`);
  console.log(`| QWK | LWK | exact | ±0.5 | ±1 | MAE | max | r | ρ | SMD | SD ratio h/m | mean m/h |\n|---|---|---|---|---|---|---|---|---|---|---|---|`);
  console.log(`| ${f2(g.qwk)}${ci(g, 'qwk')} | ${f2(g.lwk)} | ${f2(g.exact)} | ${f2(g.adjacent)} | ${f2(g.within1)} | ${f2(g.mae)}${ci(g, 'mae')} | ${f2(g.maxErr)} | ${f2(g.pearson)} | ${f2(g.spearman)} | ${f2(g.smd)}${ci(g, 'smd')} | ${f2(g.sdRatio)} | ${f2(g.meanPred)}/${f2(g.meanHuman)} |`);
  console.log(`\nBias by band group: ${BAND_GROUPS.map((b) => `${b}: n=${g.biasByGroup[b].n} ${f2(g.biasByGroup[b].bias)}${ci(g, `bias${b}`)}`).join('; ')}`);
  if (g.coverage) console.log(`Range coverage ${f2(g.coverage.rate)}${ci(g, 'coverage')}, mean width ${f2(g.coverage.meanWidth)}`);
  console.log(`\n| band | ${Object.keys(g.byBand).join(' | ')} |\n|---|${Object.keys(g.byBand).map(() => '---').join('|')}|`);
  console.log(`| n | ${Object.values(g.byBand).map((b) => b.n).join(' | ')} |\n| bias | ${Object.values(g.byBand).map((b) => f2(b.bias)).join(' | ')} |\n| MAE | ${Object.values(g.byBand).map((b) => f2(b.mae)).join(' | ')} |`);
  console.log(`\nConfusion (rows official, cols predicted): ${g.confusion.labels.join(' ')}\n${g.confusion.rows.map((r, i) => `  ${g.confusion.labels[i]}: ${r.join(' ')}`).join('\n')}`);
}

/** §2.4 activation gate with the §7.2 revision: band-group bias gated (CI bound) only when the group has n ≥ 15. */
function gate(g: Agreement) {
  const fails = [
    g.qwk < 0.7 && `QWK ${f2(g.qwk)} < 0.70`, Math.abs(g.smd) > 0.15 && `|SMD| ${f2(g.smd)} > 0.15`,
    g.adjacent < 0.8 && `within ±0.5 ${f2(g.adjacent)} < 0.80`, g.mae > 0.45 && `MAE ${f2(g.mae)} > 0.45`,
    ...BAND_GROUPS.map((b) => { const c = g.ci[`bias${b}`]; return g.biasByGroup[b].n >= 15 && c && Math.max(Math.abs(c[0]), Math.abs(c[1])) > 0.35 && `bias ${b} CI ${f2(c[0])}..${f2(c[1])} beyond ±0.35`; }),
  ].filter((x): x is string => !!x);
  return { pass: !fails.length, fails };
}

// ---------- run ----------
const modes: ScoringMode[] = a.ablate ? ['joint', 'per-criterion'] : ['joint'];
const result: Record<string, unknown> = { model, split, k: K, effort: WRITING_EFFORT, at: new Date().toISOString() };
const preds: Record<string, number[]> = {};
for (const mode of modes) {
  const scored = await scoreAll(mode);
  const done = rows.filter((r) => scored.has(r.id));
  const key = calibrationKey(model, promptHash(anchors, mode), WRITING_EFFORT, K);
  const settle = (r: Row, cal: Pick<Calibration, 'map' | 'q'>) => {
    const s = scored.get(r.id)!, one = { band: 1, range: [1, 1] as [number, number], descriptor: '', evidence: [], summary: '' };
    if (s.tooShort) return { criteria: { ta: one, cc: one, lr: one, gra: one }, m: 1, overall: 1, overallRaw: 1, range: [1, 1] as [number, number], q: 0 };
    return settleWriting(s, cal, { task: r.taskFamily === 't2' ? 2 : 1, offTopic: s.offTopic });
  };
  const labelled = done.filter((r) => r.band != null && split !== 'probe');
  const human = labelled.map((r) => r.band!), groups = labelled.map((r) => r.groupId);
  const served = [...scored.values()].flatMap((s) => s.served);
  const modesServed = [...new Set(served.map((s) => s.mode))], providers = [...new Set(served.map((s) => s.provider))];
  console.log(`\n## ${model} · ${split} · ${mode} · K=${K} · effort ${WRITING_EFFORT} · promptHash ${promptHash(anchors, mode)} · key ${key.slice(0, 12)}`);
  console.log(`${done.length}/${rows.length} scored; served by ${providers.join(', ')}; output mode ${modesServed.join(', ')}`);

  // --fitted: apply the stored record even when its gate failed (inactive), to report what the map would do on test / probes.
  let cal = asCalibration(key, a.fitted ? (await sql<Calibration['record'][]>`select slope, intercept, m_lo as "mLo", m_hi as "mHi", q90 from scoring_calibrations where key = ${key}`)[0] : await getCalibration(key));
  let out = done.map((r) => settle(r, cal));
  if (a.fit && split === 'calib' && labelled.length) {
    const raw = labelled.map((r) => settle(r, asCalibration(key)).m);
    const fit = fitCalibration(raw, human, groups);
    const oof = labelled.map((r, i) => settle(r, { map: () => fit.oof[i]!, q: fit.q90 }));
    const g = agreement(oof.map((o) => o.overallRaw), human, groups, { ranges: oof.map((o) => o.range) });
    panel(`CV (leave-one-prompt-out), ${fit.form} slope ${f2(fit.slope)} intercept ${f2(fit.intercept)} m ${f2(fit.mLo)}..${f2(fit.mHi)} q90 ${fit.q90} q95 ${fit.q95}`, g);
    const verdict = gate(g);
    console.log(`\nGate: ${verdict.pass ? 'PASS' : `FAIL (${verdict.fails.join('; ')})`}`);
    const provider = providers.filter(Boolean).join(',') || null;
    const rec = {
      key, skill: 'writing' as const, modelId: model, promptHash: promptHash(anchors, mode), effort: WRITING_EFFORT, k: K, provider,
      form: fit.form, slope: fit.slope, intercept: fit.intercept, mLo: fit.mLo, mHi: fit.mHi, lambda: fit.lambda, q90: fit.q90, q95: fit.q95,
      cv: { n: g.n, qwk: g.qwk, lwk: g.lwk, mae: g.mae, smd: g.smd, sdRatio: g.sdRatio, exact: g.exact, within05: g.adjacent, within1: g.within1, pearson: g.pearson,
        biasByGroup: g.biasByGroup, coverage90: g.coverage?.rate, ci: g.ci, mode: modesServed.length === 1 ? modesServed[0] : modesServed, gate: verdict },
      scriptIds: labelled.map((r) => r.id), active: !!a.activate && verdict.pass,
    };
    await db.insert(scoringCalibrations).values(rec).onConflictDoUpdate({ target: scoringCalibrations.key, set: { ...rec, createdAt: new Date() } });
    console.log(`Record ${key.slice(0, 12)} written, active=${rec.active}${a.activate && !verdict.pass ? ' (gate failed)' : ''}`);
    cal = asCalibration(key, rec);
    out = done.map((r, i) => (labelled.includes(r) ? oof[labelled.indexOf(r)]! : settle(r, cal)));
    result[mode] = { record: rec, cv: g };
  } else if (labelled.length) {
    const g = agreement(labelled.map((r) => out[done.indexOf(r)]!.overallRaw), human, groups, { ranges: labelled.map((r) => out[done.indexOf(r)]!.range) });
    panel(cal.calibrated ? `Calibrated with active record (q90 ${cal.q})` : 'Uncalibrated (no active record: identity, q = 1)', g);
    for (const [name, keep] of [['reconstructed prompts', (r: Row) => !!r.prompt?.reconstructed], ['Task 1 without figure', (r: Row) => scored.get(r.id)!.figure === 'none' && r.taskFamily === 't1a']] as const) {
      const sub = labelled.filter(keep);
      if (sub.length) console.log(`${name}: n=${sub.length}, MAE ${f2(sub.reduce((s, r) => s + Math.abs(out[done.indexOf(r)]!.overall - r.band!), 0) / sub.length)} (reported separately; included above)`);
    }
    result[mode] = { panel: g };
  }
  if (labelled.length) {
    const fam = (f: string) => labelled.filter((r) => r.taskFamily === f);
    console.log(`\nSMD by task family: ${['t2', 't1a', 't1g'].map((f) => { const s = fam(f); if (s.length < 2) return `${f} n=${s.length}`; const g = agreement(s.map((r) => out[done.indexOf(r)]!.overallRaw), s.map((r) => r.band!), undefined, { resamples: 1 }); return `${f} n=${s.length} ${f2(g.smd)}`; }).join('; ')}`);
  }
  const crit = WRITING_KEYS.map((k) => { const b = out.map((o) => o.criteria[k].band), mu = b.reduce((s, x) => s + x, 0) / b.length; return `${k} ${f2(mu)}±${f2(Math.sqrt(b.reduce((s, x) => s + (x - mu) ** 2, 0) / b.length))}`; });
  console.log(`Criterion distributions (flat profiles show as small SDs): ${crit.join('; ')}`);

  if (split === 'probe') result[mode] = { probes: probes(done, out) };
  preds[mode] = labelled.map((r) => out[done.indexOf(r)]!.overallRaw);
  result[`${mode}Rows`] = done.map((r, i) => ({ id: r.id, band: r.band, group: r.groupId, family: r.taskFamily, m: settle(r, asCalibration(key)).m, pred: out[i]!.overall, raw: out[i]!.overallRaw, range: out[i]!.range, criteria: Object.fromEntries(WRITING_KEYS.map((k) => [k, out[i]!.criteria[k].band])), samples: scored.get(r.id)!.samples.map((s) => Object.fromEntries(WRITING_KEYS.map((k) => [k, s[k].band]))), flags: scored.get(r.id)!.flags, tooShort: scored.get(r.id)!.tooShort }));
}

/** Probe expectations (§ user decision: ceiling, floor, monotonic controlled variants). */
function probes(done: Row[], out: ReturnType<typeof settleWriting>[]) {
  const by = new Map(done.map((r, i) => [r.id, { r, o: out[i]! }]));
  const checks = done.map((r) => {
    const e = (r.expect ?? {}) as { kind?: string; base?: string; level?: number; minBand?: number; maxBand?: number; criterionMin?: number; criterionMax?: Record<string, number>; belowBase?: boolean; notAboveBase?: boolean; monotonic?: boolean };
    const o = by.get(r.id)!.o, bands = WRITING_KEYS.map((k) => o.criteria[k].band);
    const base = e.base ? by.get(e.base)?.o.overall : undefined;
    const prev = e.level === 1 ? base : by.get(`probe-${e.base}-err${(e.level ?? 0) - 1}`)?.o.overall;
    // [label, ok]; ok is null when the comparison script (base or previous error level) was not scored in this run.
    const vs = (x: number | undefined, f: (x: number) => boolean) => (x == null ? null : f(x));
    const need = ([
      e.minBand != null && [`overall >= ${e.minBand}`, o.overall >= e.minBand],
      e.criterionMin != null && [`criteria >= ${e.criterionMin}`, bands.every((b) => b >= e.criterionMin!)],
      e.maxBand != null && [`overall <= ${e.maxBand}`, o.overall <= e.maxBand],
      ...Object.entries(e.criterionMax ?? {}).map(([k, v]) => [`${k} <= ${v}`, o.criteria[k as 'ta'].band <= v]),
      e.belowBase && [`< base ${base}`, vs(base, (b) => o.overall < b)],
      e.notAboveBase && [`<= base ${base}`, vs(base, (b) => o.overall <= b)],
      e.monotonic && [`<= previous level ${prev}`, vs(prev, (p) => o.overall <= p)],
    ].filter(Boolean) as [string, boolean | null][]);
    const failed = need.filter(([, ok]) => ok === false).map(([n]) => n), missing = need.some(([, ok]) => ok === null);
    return { id: r.id, kind: e.kind ?? '?', overall: o.overall, bands, pass: !failed.length && !missing, failed, missing };
  });
  console.log(`\n### Probe checks\n\n| probe | kind | overall | TA CC LR GRA | result |\n|---|---|---|---|---|`);
  for (const c of checks) console.log(`| ${c.id} | ${c.kind} | ${c.overall} | ${c.bands.join(' ')} | ${c.failed.length ? `FAIL: ${c.failed.join(', ')}` : c.missing ? 'base not scored' : 'pass'} |`);
  const kinds = [...new Set(checks.map((c) => c.kind.replace(/\d$/, '')))];
  console.log(`\n${kinds.map((k) => { const s = checks.filter((c) => c.kind.replace(/\d$/, '') === k); return `${k} ${s.filter((c) => c.pass).length}/${s.length}`; }).join('; ')}`);
  const nominal = done.filter((r) => r.band != null);
  if (nominal.length > 1) { const g = agreement(nominal.map((r) => by.get(r.id)!.o.overallRaw), nominal.map((r) => r.band!), undefined, { resamples: 1 }); console.log(`Nominal-band error by band (probes: ceiling 9, floor 3): ${Object.entries(g.byBand).filter(([, b]) => b.n).map(([b, v]) => `${b}: n=${v.n} bias ${f2(v.bias)}`).join('; ')}`); }
  return checks;
}

if (a.ablate && preds.joint?.length && preds['per-criterion']?.length) {
  const labelled = rows.filter((r) => r.band != null && split !== 'probe');
  const d = pairedBootstrap(preds.joint, preds['per-criterion'], labelled.map((r) => r.band!), labelled.map((r) => r.groupId));
  console.log(`\n### Ablation: per-criterion − joint (paired grouped bootstrap)\n${['qwk', 'mae', 'exact', 'adjacent', 'pearson', 'smd'].map((k) => `${k}: ${f2(d[k]!.a)} → ${f2(d[k]!.b)} Δ ${f2(d[k]!.delta)} [${f2(d[k]!.ci[0])}, ${f2(d[k]!.ci[1])}]`).join('\n')}`);
  result.ablation = d;
}
console.log(`\nSpend this run: $${cost.toFixed(4)}`);
const outDir = `${ROOT}.eval/scoring/${model.replace(/\W/g, '_')}`;
mkdirSync(outDir, { recursive: true });
const outFile = `${outDir}/${split}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(outFile, JSON.stringify({ ...result, cost }, null, 1));
console.log(`Wrote ${outFile.replace(ROOT, '')}`);
await sql.end();
