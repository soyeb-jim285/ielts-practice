import { describe, it, expect } from 'vitest';
import { agreement, applyCalibration, applyKnotMap, fitKnotMap, conformalQ, coverage, fitCalibration, pairedBootstrap, rng, spearman, weightedKappa } from './calibration';

const normal = (rand: () => number) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

describe('weightedKappa (half-band categories)', () => {
  // pred 5,6,7 vs human 5,6,6 -> cats 10,12,14 vs 10,12,12.
  // quadratic: obs Σw/n = 4/3; exp Σ_ab w(r_a,h_b)/n² = (8+4+24)/9 = 4 -> 1 − (4/3)/4 = 2/3
  // linear:    obs 2/3;       exp (4+2+8)/9 = 14/9          -> 1 − (2/3)/(14/9) = 4/7
  it('matches hand-computed values', () => {
    expect(weightedKappa([5, 6, 7], [5, 6, 6], 2)).toBeCloseTo(2 / 3, 12);
    expect(weightedKappa([5, 6, 7], [5, 6, 6], 1)).toBeCloseTo(4 / 7, 12);
  });
  it('is 1 for perfect agreement and −1 for a full reversal', () => {
    expect(weightedKappa([4, 5.5, 8], [4, 5.5, 8], 2)).toBe(1);
    expect(weightedKappa([5, 6, 7], [7, 6, 5], 2)).toBeCloseTo(-1, 12); // obs 32/3, exp 48/9
  });
  it('is NaN when both raters use one category', () => expect(weightedKappa([6, 6], [6, 6], 2)).toBeNaN());
});

describe('agreement', () => {
  const a = agreement([5, 6, 7], [5, 6, 6], undefined, { resamples: 200 });
  it('point metrics match hand calculation', () => {
    expect(a.qwk).toBeCloseTo(2 / 3, 12);
    expect(a.lwk).toBeCloseTo(4 / 7, 12);
    expect(a.exact).toBeCloseTo(2 / 3);
    expect(a.adjacent).toBeCloseTo(2 / 3);
    expect(a.within1).toBe(1);
    expect(a.mae).toBeCloseTo(1 / 3);
    expect(a.maxErr).toBe(1);
    // var(pred)=1, var(human)=1/3, cov=1/2
    expect(a.smd).toBeCloseTo(1 / 3 / Math.sqrt(2 / 3), 12);
    expect(a.sdRatio).toBeCloseTo(Math.sqrt(1 / 3), 12);
    expect(a.pearson).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(a.spearman).toBeCloseTo(Math.sqrt(3) / 2, 12); // ranks 1,2,3 vs 1,2.5,2.5
  });
  it('bias by band group and by whole band', () => {
    expect(a.biasByGroup['<=5']).toEqual({ n: 1, bias: 0 });
    expect(a.biasByGroup['5.5-6.5']).toEqual({ n: 2, bias: 0.5 });
    expect(a.biasByGroup['>=7'].n).toBe(0);
    expect(a.byBand[6]).toEqual({ n: 2, bias: 0.5, mae: 0.5 });
    expect(Object.keys(a.byBand).map(Number)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(a.byBand[9]!.n).toBe(0);
  });
  it('confusion matrix rows = human, cols = rounded pred', () =>
    expect(a.confusion).toEqual({ labels: [5, 6, 7], rows: [[1, 0, 0], [0, 1, 1], [0, 0, 0]] }));
  it('rounds predictions to the displayed half band for error metrics', () => {
    const b = agreement([6.3, 6.7, 5.2], [6.5, 6.5, 5], undefined, { resamples: 0 });
    expect(b.exact).toBe(1);
    expect(b.qwk).toBe(1);
  });
  it('coverage and its CI', () => {
    expect(coverage([[5, 6], [6, 7], [4, 4.5]], [5.5, 7.5, 4])).toEqual({ rate: 2 / 3, meanWidth: 2.5 / 3 });
    const c = agreement([5, 6, 7], [5, 6, 6], undefined, { ranges: [[4.5, 5.5], [5.5, 6.5], [6.5, 7.5]], resamples: 100 });
    expect(c.coverage).toEqual({ rate: 2 / 3, meanWidth: 1 });
    expect(c.ci.coverage![0]).toBeLessThanOrEqual(c.ci.coverage![1]);
  });
  it('bootstrap CIs are deterministic per seed and bracket the estimate', () => {
    const rand = rng(7), human: number[] = [], pred: number[] = [], groups: number[] = [];
    for (let i = 0; i < 80; i++) { const y = 4 + Math.round(rand() * 8) / 2; human.push(y); pred.push(y + normal(rand) * 0.5); groups.push(i % 20); }
    const x = agreement(pred, human, groups), y = agreement(pred, human, groups);
    expect(x.ci).toEqual(y.ci);
    expect(agreement(pred, human, groups, { seed: 2 }).ci.mae).not.toEqual(x.ci.mae);
    for (const k of ['qwk', 'mae', 'smd', 'pearson', 'sdRatio'] as const) {
      expect(x.ci[k]![0]).toBeLessThanOrEqual(x[k]);
      expect(x.ci[k]![1]).toBeGreaterThanOrEqual(x[k]);
    }
    expect(x.ci['bias>=7']![0]).toBeLessThanOrEqual(x.ci['bias>=7']![1]);
  });
  it('grouped bootstrap: one group gives a degenerate CI', () => {
    const g = agreement([5, 6, 7, 6], [5, 6, 6, 7], [1, 1, 1, 1], { resamples: 50 });
    expect(g.ci.mae).toEqual([g.mae, g.mae]);
  });
});

it('spearman handles ties with average ranks', () => expect(spearman([1, 2, 3, 4], [1, 1, 2, 2])).toBeCloseTo(Math.sqrt(0.8), 12));

describe('conformalQ', () => {
  it('takes the ⌈(1−α)(n+1)⌉-th smallest residual, rounded up to 0.5', () => {
    const r = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.7, 1.5]; // n=10, k=ceil(9.9)=10
    expect(conformalQ(r, 0.1)).toBe(1.5);
    expect(conformalQ(r, 0.2)).toBe(1); // k=ceil(8.8)=9 -> 0.7 -> 1
    expect(conformalQ([0.5, 0.5], 0.1)).toBe(9); // too few residuals
  });
});

describe('applyCalibration', () => {
  const c = { slope: 1.4, intercept: -2, mLo: 5, mHi: 7 };
  it('linear inside, slope 1 outside, monotone, clamped', () => {
    expect(applyCalibration(c, 6)).toBeCloseTo(6.4);
    expect(applyCalibration(c, 8) - applyCalibration(c, 7)).toBeCloseTo(1); // no stretch beyond mHi
    expect(applyCalibration(c, 4) - applyCalibration(c, 5)).toBeCloseTo(-1);
    let prev = -Infinity;
    for (let m = 0; m <= 9; m += 0.05) { const y = applyCalibration(c, m); expect(y).toBeGreaterThanOrEqual(prev); prev = y; }
    expect(applyCalibration(c, 9.9)).toBe(9);
    expect(applyCalibration({ ...c, intercept: -9 }, 0)).toBe(0);
  });
});

describe('fitCalibration', () => {
  const sim = (n: number, f: (m: number) => number, noise = 0, seed = 3) => {
    const rand = rng(seed), raw: number[] = [], human: number[] = [], groups: string[] = [];
    for (let i = 0; i < n; i++) { const m = 4.5 + rand() * 2.5; raw.push(m); human.push(f(m) + noise * normal(rand)); groups.push(`b${i % 8}`); }
    return { raw, human, groups };
  };
  it('recovers a known slope and intercept (mean/SD equating)', () => {
    const { raw, human, groups } = sim(40, (m) => 1.3 * m - 1.5);
    const fit = fitCalibration(raw, human, groups);
    expect(fit.form).toBe('linear');
    expect(fit.lambda).toBe(1);
    expect(fit.slope).toBeCloseTo(1.3, 10);
    expect(fit.intercept).toBeCloseTo(-1.5, 10);
    expect(fit.mLo).toBe(Math.min(...raw));
    expect(fit.mHi).toBe(Math.max(...raw));
    fit.oof.forEach((p, i) => expect(Math.abs(p - human[i]!)).toBeLessThan(0.2)); // out-of-fold still close
  });
  it('uses shift = median(y − m) below 30 scripts', () => {
    const fit = fitCalibration([5, 6, 7, 5.5], [5.5, 7, 7.5, 6], ['a', 'a', 'b', 'b']);
    expect(fit).toMatchObject({ form: 'shift', slope: 1, intercept: 0.5 }); // diffs .5,1,.5,.5
    expect(fit.oof).toEqual([5.5, 6.5, 7.75, 6.25]); // held-out a: median(.5,.5)=.5; held-out b: median(.5,1)=.75
  });
  it('clamps the slope to [0.8, 1.8]', () => {
    const fit = (d: ReturnType<typeof sim>) => fitCalibration(d.raw, d.human, d.groups);
    expect(fit(sim(40, (m) => 3 * m - 12)).slope).toBe(1.8);
    expect(fit(sim(40, (m) => 0.3 * m + 4)).slope).toBe(0.8);
  });
  it('λ = 0 gives OLS (shrinks by r)', () => {
    const { raw, human, groups } = sim(60, (m) => 1.3 * m - 1.5, 0.5);
    const eq = fitCalibration(raw, human, groups), ols = fitCalibration(raw, human, groups, { lambda: 0 });
    expect(ols.slope).toBeLessThan(eq.slope);
  });
  it('requires ≥ 2 groups', () => expect(() => fitCalibration([5, 6], [5, 6], ['a', 'a'])).toThrow());
  it('conformal q90 covers about 90% of new scripts', () => {
    const f = (m: number) => 1.2 * m - 1;
    const { raw, human, groups } = sim(200, f, 0.4, 11);
    const fit = fitCalibration(raw, human, groups);
    const test = sim(2000, f, 0.4, 12);
    const hit = test.raw.map((m, i) => +(Math.abs(Math.round(applyCalibration(fit, m) * 2) / 2 - test.human[i]!) <= fit.q90));
    const rate = hit.reduce((s, v) => s + v, 0) / hit.length;
    expect(rate).toBeGreaterThan(0.85);
    expect(rate).toBeLessThan(0.99); // rounding q up to 0.5 over-covers a little
    expect(fit.q95).toBeGreaterThanOrEqual(fit.q90);
  });
});

describe('pairedBootstrap', () => {
  it('delta = B − A with CI, deterministic', () => {
    const human = [5, 5.5, 6, 6.5, 7, 7.5, 6, 5];
    const res = pairedBootstrap(human.map((y) => y + 1), human, human, undefined, { resamples: 300 });
    expect(res.mae).toEqual({ a: 1, b: 0, delta: -1, ci: [-1, -1] });
    expect(res.smd!.delta).toBeLessThan(0);
    expect(pairedBootstrap(human.map((y) => y + 1), human, human)).toEqual(pairedBootstrap(human.map((y) => y + 1), human, human));
  });
});

describe('knot map', () => {
  const c = { w: -0.2, gd0: 3, knots: [[4, 3.5], [5, 5], [6, 6.5], [7.5, 8.5]] as [number, number][] };
  it('interpolates between knots, continues the end slopes (within 1..1.5) and clamps to 0..9', () => {
    expect(applyKnotMap(c, 5.5, 3)).toBeCloseTo(5.75);
    expect(applyKnotMap(c, 7.5, 3)).toBeCloseTo(8.5);
    expect(applyKnotMap(c, 7.65, 3)).toBeCloseTo(8.5 + 1.333 * 0.15, 1); // top segment slope 1.33
    expect(applyKnotMap(c, 3, 3)).toBeCloseTo(3.5 - 1.5); // bottom segment slope 1.5 (capped)
    expect(applyKnotMap(c, 20, 3)).toBe(9);
    expect(applyKnotMap(c, -5, 3)).toBe(0);
  });
  it('error density lowers the score, and a missing density means the training median', () => {
    expect(applyKnotMap(c, 6, 8)).toBeCloseTo(applyKnotMap(c, 5, 3));
    expect(applyKnotMap(c, 6)).toBeCloseTo(applyKnotMap(c, 6, 3));
  });
  it('fits a line through partial equating with refitted end slopes, a negative density weight and out-of-fold predictions', () => {
    const r = rng(3), m: number[] = [], gd: number[] = [], y: number[] = [], g: number[] = [];
    for (let i = 0; i < 132; i++) { const band = 3.5 + (i % 11) * 0.5, d = 14 - (band - 3.5) * 2.4 + (r() - 0.5) * 3; y.push(band); gd.push(Math.max(0, d)); m.push(3.5 + (band - 3.5) * 0.6 + (r() - 0.5) * 1.2); g.push(i % 12); }
    const f = fitKnotMap(m, gd, y, g);
    expect(f.w).toBeLessThan(0);
    expect(f.knots).toHaveLength(4);
    for (let i = 1; i < f.knots.length; i++) { expect(f.knots[i]![0]).toBeGreaterThan(f.knots[i - 1]![0]); expect(f.knots[i]![1]).toBeGreaterThan(f.knots[i - 1]![1]); } // monotone
    expect(f.oof).toHaveLength(132);
    expect(f.oof.reduce((s, p, i) => s + Math.abs(p - y[i]!), 0) / 132).toBeLessThan(0.9);
    expect(applyKnotMap(f, 3.2, 14)).toBeLessThan(applyKnotMap(f, 3.2, 2)); // more errors, lower band
    expect(() => fitKnotMap(m.slice(0, 10), gd.slice(0, 10), y.slice(0, 10), g.slice(0, 10))).toThrow();
  });
});
