import { roundBand } from './band';

// Scoring statistics and per-model calibration (docs/scoring-research.md §2.4, §4.3, §7.2).
// Error metrics (kappas, exact/adjacent, MAE, bias, confusion) use the displayed band roundBand(pred);
// distribution metrics (Pearson, Spearman, SMD, SD ratio) use the raw continuous prediction.

export type Group = string | number;
export const BAND_GROUPS = ['<=5', '5.5-6.5', '>=7'] as const;
export type BandGroup = (typeof BAND_GROUPS)[number];
export const bandGroup = (y: number): BandGroup => (y <= 5 ? '<=5' : y >= 7 ? '>=7' : '5.5-6.5');

/** Seedable PRNG (mulberry32), uniform in [0, 1). */
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)); };
const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2; };

export function pearson(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const a = x[i]! - mx, b = y[i]! - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy);
}

/** Average ranks (ties share the mean rank), 1-based. */
function ranks(x: number[]): number[] {
  const idx = x.map((_, i) => i).sort((a, b) => x[a]! - x[b]!), r = new Array<number>(x.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && x[idx[j + 1]!] === x[idx[i]!]) j++;
    for (let k = i; k <= j; k++) r[idx[k]!] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
export const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));

/** Cohen's weighted kappa on the half-band scale (band × 2 as integer categories); power 2 = quadratic, 1 = linear. */
export function weightedKappa(a: number[], b: number[], power: 1 | 2): number {
  const ca = new Array(19).fill(0), cb = new Array(19).fill(0), n = a.length;
  const cat = (v: number) => Math.min(18, Math.max(0, Math.round(v * 2)));
  let obs = 0;
  for (let i = 0; i < n; i++) { const x = cat(a[i]!), y = cat(b[i]!); ca[x]++; cb[y]++; obs += Math.abs(x - y) ** power; }
  let exp = 0;
  for (let x = 0; x < 19; x++) if (ca[x]) for (let y = 0; y < 19; y++) exp += ca[x] * cb[y] * Math.abs(x - y) ** power;
  return 1 - (obs / n) / (exp / (n * n)); // NaN when both raters use a single category
}

export function coverage(ranges: [number, number][], human: number[]) {
  return {
    rate: mean(human.map((y, i) => (y >= ranges[i]![0] && y <= ranges[i]![1] ? 1 : 0))),
    meanWidth: mean(ranges.map(([lo, hi]) => hi - lo)),
  };
}

type Scalars = Record<'n' | 'qwk' | 'lwk' | 'exact' | 'adjacent' | 'within1' | 'mae' | 'maxErr' | 'pearson' | 'spearman' | 'smd' | 'sdRatio' | 'meanPred' | 'meanHuman', number>
  & Partial<Record<`bias${BandGroup}` | 'coverage' | 'meanWidth', number>>;

/** Flat scalar metrics; the unit the bootstraps resample. */
function scalars(pred: number[], human: number[], ranges?: [number, number][]): Scalars {
  const r = pred.map(roundBand), err = r.map((v, i) => v - human[i]!), abs = err.map(Math.abs);
  const out: Scalars = {
    n: pred.length,
    qwk: weightedKappa(r, human, 2),
    lwk: weightedKappa(r, human, 1),
    exact: mean(abs.map((e) => +(e < 1e-9))),
    adjacent: mean(abs.map((e) => +(e <= 0.5 + 1e-9))),
    within1: mean(abs.map((e) => +(e <= 1 + 1e-9))),
    mae: mean(abs),
    maxErr: Math.max(...abs),
    pearson: pearson(pred, human),
    spearman: spearman(pred, human),
    smd: (mean(pred) - mean(human)) / Math.sqrt((sd(pred) ** 2 + sd(human) ** 2) / 2),
    sdRatio: sd(human) / sd(pred),
    meanPred: mean(pred),
    meanHuman: mean(human),
  };
  for (const g of BAND_GROUPS) {
    const e = err.filter((_, i) => bandGroup(human[i]!) === g);
    out[`bias${g}`] = e.length ? mean(e) : NaN;
  }
  if (ranges) { const c = coverage(ranges, human); out.coverage = c.rate; out.meanWidth = c.meanWidth; }
  return out;
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const p = q * (sorted.length - 1), lo = Math.floor(p);
  return sorted[lo]! + (sorted[Math.min(lo + 1, sorted.length - 1)]! - sorted[lo]!) * (p - lo);
}

/** Cluster bootstrap: resample whole groups with replacement; yields index lists. */
function* resamples(n: number, groups: Group[] | undefined, B: number, seed: number) {
  const by = new Map<Group, number[]>();
  for (let i = 0; i < n; i++) { const g = groups ? groups[i]! : i; by.set(g, [...(by.get(g) ?? []), i]); }
  const clusters = [...by.values()], rand = rng(seed);
  for (let b = 0; b < B; b++) {
    const idx: number[] = [];
    for (let k = 0; k < clusters.length; k++) idx.push(...clusters[Math.floor(rand() * clusters.length)]!);
    yield idx;
  }
}

/** 95% percentile CIs per key; NaN resamples (e.g. an empty band group) are skipped. */
function ci(samples: Record<string, number | undefined>[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const k of Object.keys(samples[0] ?? {})) {
    if (k === 'n') continue;
    const v = samples.map((s) => s[k]).filter((x): x is number => Number.isFinite(x)).sort((a, b) => a - b);
    out[k] = [percentile(v, 0.025), percentile(v, 0.975)];
  }
  return out;
}

export interface BootOpts { ranges?: [number, number][]; resamples?: number; seed?: number }

export interface Agreement {
  n: number; qwk: number; lwk: number; exact: number; adjacent: number; within1: number;
  mae: number; maxErr: number; pearson: number; spearman: number;
  /** (mean pred − mean human) / pooled SD */ smd: number;
  /** SD human / SD pred; > 1 means the model compresses the scale */ sdRatio: number;
  meanPred: number; meanHuman: number;
  /** mean(roundBand(pred) − human) by official band group */
  biasByGroup: Record<BandGroup, { n: number; bias: number }>;
  /** by whole official band (floor), always including 3..9 */
  byBand: Record<number, { n: number; bias: number; mae: number }>;
  /** rows = human band, cols = predicted (rounded) band */
  confusion: { labels: number[]; rows: number[][] };
  coverage?: { rate: number; meanWidth: number };
  /** grouped-bootstrap 95% CIs, keyed by metric name and `bias<=5` / `bias5.5-6.5` / `bias>=7` / `coverage` / `meanWidth` */
  ci: Record<string, [number, number]>;
}

/** Human-vs-machine agreement panel (§4.3). `groups` makes the bootstrap resample whole groups (e.g. prompts). */
export function agreement(pred: number[], human: number[], groups?: Group[], opts: BootOpts = {}): Agreement {
  if (pred.length !== human.length || !pred.length) throw new Error('agreement: pred and human must be non-empty and equal length');
  const { ranges, resamples: B = 2000, seed = 1 } = opts;
  const s = scalars(pred, human, ranges), r = pred.map(roundBand);
  const byBand: Agreement['byBand'] = {};
  for (let b = 3; b <= 9; b++) byBand[b] = { n: 0, bias: NaN, mae: NaN };
  for (const b of new Set(human.map(Math.floor))) {
    const e = r.map((v, i) => v - human[i]!).filter((_, i) => Math.floor(human[i]!) === b);
    byBand[b] = { n: e.length, bias: mean(e), mae: mean(e.map(Math.abs)) };
  }
  const labels = [...new Set([...human, ...r])].sort((a, b) => a - b);
  const rows = labels.map(() => labels.map(() => 0));
  human.forEach((y, i) => rows[labels.indexOf(y)]![labels.indexOf(r[i]!)]!++);
  const boot = [...resamples(pred.length, groups, B, seed)].map((idx) =>
    scalars(idx.map((i) => pred[i]!), idx.map((i) => human[i]!), ranges && idx.map((i) => ranges[i]!)));
  return {
    n: s.n, qwk: s.qwk, lwk: s.lwk, exact: s.exact, adjacent: s.adjacent, within1: s.within1, mae: s.mae, maxErr: s.maxErr,
    pearson: s.pearson, spearman: s.spearman, smd: s.smd, sdRatio: s.sdRatio, meanPred: s.meanPred, meanHuman: s.meanHuman,
    biasByGroup: Object.fromEntries(BAND_GROUPS.map((g) => [g, { n: human.filter((y) => bandGroup(y) === g).length, bias: s[`bias${g}`] ?? NaN }])) as Agreement['biasByGroup'],
    byBand,
    confusion: { labels, rows },
    ...(ranges ? { coverage: { rate: s.coverage!, meanWidth: s.meanWidth! } } : {}),
    ci: ci(boot),
  };
}

/** Paired grouped bootstrap of B vs A on the same scripts: per metric, delta = B − A with a 95% CI. */
export function pairedBootstrap(predA: number[], predB: number[], human: number[], groups?: Group[], opts: BootOpts = {}) {
  const { resamples: B = 2000, seed = 1 } = opts;
  const a = scalars(predA, human), b = scalars(predB, human);
  const deltas = [...resamples(human.length, groups, B, seed)].map((idx) => {
    const h = idx.map((i) => human[i]!), sa = scalars(idx.map((i) => predA[i]!), h), sb = scalars(idx.map((i) => predB[i]!), h);
    return Object.fromEntries(Object.keys(sa).map((k) => [k, sb[k as keyof Scalars]! - sa[k as keyof Scalars]!]));
  });
  const c = ci(deltas);
  return Object.fromEntries(Object.keys(c).map((k) => [k, { a: a[k as keyof Scalars]!, b: b[k as keyof Scalars]!, delta: b[k as keyof Scalars]! - a[k as keyof Scalars]!, ci: c[k]! }])) as
    Record<string, { a: number; b: number; delta: number; ci: [number, number] }>;
}

/** Split/CV+ conformal half-width: the ⌈(1−α)(n+1)⌉-th smallest residual, rounded up to 0.5. 9 (whole scale) if n is too small. */
export function conformalQ(residuals: number[], alpha = 0.1): number {
  const s = [...residuals].sort((a, b) => a - b), k = Math.ceil((1 - alpha) * (s.length + 1));
  return k > s.length ? 9 : Math.ceil(s[k - 1]! * 2 - 1e-9) / 2;
}

export interface CalibrationMap { form: 'shift' | 'linear'; slope: number; intercept: number; mLo: number; mHi: number; lambda: number }
export interface CalibrationFit extends CalibrationMap {
  n: number; q90: number; q95: number;
  /** leave-one-group-out predictions (unrounded), aligned with the input; feed to agreement() */
  oof: number[];
}

/** ŷ = slope·m + intercept inside [mLo, mHi]; outside, slope 1 from the edge (no stretch beyond labelled data). Clamped 0..9. */
export function applyCalibration(c: Pick<CalibrationMap, 'slope' | 'intercept' | 'mLo' | 'mHi'>, raw: number): number {
  const f = (m: number) => c.slope * m + c.intercept;
  const y = raw < c.mLo ? f(c.mLo) + raw - c.mLo : raw > c.mHi ? f(c.mHi) + raw - c.mHi : f(raw);
  return Math.min(9, Math.max(0, y));
}

function fitMap(m: number[], y: number[], lambda: number, minLinear: number): CalibrationMap {
  const mLo = Math.min(...m), mHi = Math.max(...m), sm = sd(m);
  if (m.length < minLinear || !(sm > 0)) return { form: 'shift', slope: 1, intercept: median(y.map((v, i) => v - m[i]!)), mLo, mHi, lambda };
  // λ = 1: mean/SD equating (shipped default, §7.2); λ = 0: OLS. Slope clamped so the map stays monotone and plausible.
  const r = Math.max(0, pearson(m, y)), raw = (sd(y) / sm) * r ** (1 - lambda);
  const slope = Math.min(1.8, Math.max(0.8, Number.isFinite(raw) ? raw : 1));
  return { form: 'linear', slope, intercept: mean(y) - slope * mean(m), mLo, mHi, lambda };
}

/**
 * Fit a per-model calibration map from raw model scores to official bands (§2.4): shift below `minLinear` scripts,
 * else linear equating. Leave-one-group-out CV gives out-of-fold predictions and the conformal half-widths.
 */
export function fitCalibration(raw: number[], human: number[], groups: Group[], opts: { lambda?: number; minLinear?: number } = {}): CalibrationFit {
  const { lambda = 1, minLinear = 30 } = opts;
  if (raw.length !== human.length || raw.length !== groups.length) throw new Error('fitCalibration: length mismatch');
  const ids = [...new Set(groups)];
  if (ids.length < 2) throw new Error('fitCalibration: need at least 2 groups for leave-one-group-out CV');
  const oof = new Array<number>(raw.length);
  for (const g of ids) {
    const tr = groups.map((x, i) => (x === g ? -1 : i)).filter((i) => i >= 0);
    const map = fitMap(tr.map((i) => raw[i]!), tr.map((i) => human[i]!), lambda, minLinear);
    groups.forEach((x, i) => { if (x === g) oof[i] = applyCalibration(map, raw[i]!); });
  }
  const res = oof.map((p, i) => Math.abs(roundBand(p) - human[i]!));
  return { ...fitMap(raw, human, lambda, minLinear), n: raw.length, q90: conformalQ(res, 0.1), q95: conformalQ(res, 0.05), oof };
}

/** Piecewise-linear calibration on a composite score z = m + w·(gd − gd0): m = the scorer's raw mean, gd = grammar errors per 100 words from the feedback call.
 *  The two-parameter linear map could not be steeper at both ends of the scale; knots can (docs/scoring-validation.md §8). Missing gd (scoring-only paths) means gd0. */
export interface KnotMap { w: number; gd0: number; knots: [number, number][] }
/** Beyond the end knots the map continues at the end segment's slope, kept within [1, 1.5] so the ends never flatten and never explode. */
export function applyKnotMap(c: KnotMap, m: number, gd?: number): number {
  const z = m + c.w * ((gd ?? c.gd0) - c.gd0), k = c.knots, n = k.length;
  const edge = (a: [number, number], b: [number, number]) => Math.min(1.5, Math.max(1, (b[1] - a[1]) / (b[0] - a[0] || 1)));
  let y: number;
  if (n === 1) y = k[0]![1] + z - k[0]![0];
  else if (z <= k[0]![0]) y = k[0]![1] + edge(k[0]!, k[1]!) * (z - k[0]![0]);
  else if (z >= k[n - 1]![0]) y = k[n - 1]![1] + edge(k[n - 2]!, k[n - 1]!) * (z - k[n - 1]![0]);
  else {
    const i = k.findIndex((_, j) => j < n - 1 && z <= k[j + 1]![0]);
    const [a, b] = [k[i]!, k[i + 1]!];
    y = a[1] + ((z - a[0]) * (b[1] - a[1])) / (b[0] - a[0] || 1);
  }
  return Math.min(9, Math.max(0, y));
}

/** Least squares of y on (m, gd): the error density's weight in raw-score units, w = b_gd / b_m. */
function densityWeight(m: number[], gd: number[], y: number[]): number {
  const [mm, mg, my] = [mean(m), mean(gd), mean(y)];
  let smm = 0, sgg = 0, smg = 0, smy = 0, sgy = 0;
  m.forEach((v, i) => { const a = v - mm, b = gd[i]! - mg, c = y[i]! - my; smm += a * a; sgg += b * b; smg += a * b; smy += a * c; sgy += b * c; });
  const det = smm * sgg - smg * smg, bm = (smy * sgg - sgy * smg) / det, bg = (smm * sgy - smg * smy) / det;
  return det > 1e-9 && bm > 1e-9 ? bg / bm : 0;
}

export interface KnotFit extends KnotMap { n: number; q90: number; q95: number; oof: number[] }
/** Knot positions on z: below `lo` and above `hi` the map gets its own slope. */
export const KNOT_OPTS = { lo: 4.5, hi: 7.5 };
/** Middle: least squares of y on (m, gd), written as a line in z. Ends: below `lo` and above `hi` the slope is refitted on the scripts out there (within 1..1.5),
 *  so floor and ceiling scripts, which the scorer under-separates, can reach 3.5 and 8.5 (plain least squares keeps them near the middle). */
function fitKnotLine(m: number[], gd: number[], y: number[], o: typeof KNOT_OPTS): KnotMap {
  const w = densityWeight(m, gd, y), gd0 = [...gd].sort((a, b) => a - b)[Math.floor(gd.length / 2)]!;
  const z = m.map((v, i) => v + w * (gd[i]! - gd0)), [mz, my] = [mean(z), mean(y)];
  const slope = sum(z.map((v, i) => (v - mz) * (y[i]! - my))) / sum(z.map((v) => (v - mz) ** 2)), line = (v: number) => my + slope * (v - mz);
  // slope of the end segment through its knot, least squares on the points beyond it; too few points: keep the middle slope
  const end = (k: number, beyond: (v: number) => boolean, min: number) => {
    const d = z.filter(beyond).map((v) => v - k), r = z.map((v, i) => (beyond(v) ? y[i]! - line(v) : NaN)).filter((v) => !Number.isNaN(v));
    if (d.length < min) return slope;
    const dd = sum(d.map((v) => v * v));
    return Math.min(1.5, Math.max(1, (slope * dd + sum(d.map((v, i) => v * r[i]!))) / dd));
  };
  const [sLo, sHi] = [end(o.lo, (v) => v < o.lo, 5), end(o.hi, (v) => v > o.hi, 4)];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { w: r2(w), gd0: r2(gd0), knots: ([[o.lo - 1, line(o.lo) - sLo], [o.lo, line(o.lo)], [o.hi, line(o.hi)], [o.hi + 1, line(o.hi) + sHi]] as [number, number][]).map(([a, b]) => [r2(a), r2(b)]) };
}
const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);

/** Fits the knot map with leave-one-group-out out-of-fold predictions and conformal half-widths. */
export function fitKnotMap(m: number[], gd: number[], human: number[], groups: Group[]): KnotFit {
  const o = KNOT_OPTS;
  if (m.length !== human.length || m.length !== gd.length || m.length !== groups.length) throw new Error('fitKnotMap: length mismatch');
  const ids = [...new Set(groups)];
  if (ids.length < 2 || m.length < 20) throw new Error('fitKnotMap: need at least 2 groups and 20 scripts');
  const fit = (idx: number[]) => fitKnotLine(idx.map((i) => m[i]!), idx.map((i) => gd[i]!), idx.map((i) => human[i]!), o);
  const oof = new Array<number>(m.length);
  for (const g of ids) {
    const map = fit(groups.map((x, i) => (x === g ? -1 : i)).filter((i) => i >= 0));
    groups.forEach((x, i) => { if (x === g) oof[i] = applyKnotMap(map, m[i]!, gd[i]!); });
  }
  const res = oof.map((p, i) => Math.abs(roundBand(p) - human[i]!));
  return { ...fit(m.map((_, i) => i)), n: m.length, q90: conformalQ(res, 0.1), q95: conformalQ(res, 0.05), oof };
}
