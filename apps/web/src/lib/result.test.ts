import type { SpeechMetrics } from '@ielts/core';
import type { AnalysisResult } from '@server/ai/types';
import { describe, expect, it } from 'vitest';
import { bandColor, buildTokens, criterionLabel, sessionOverall, speechStats } from './result';

const metrics = (over: Partial<SpeechMetrics> = {}): SpeechMetrics => ({
  durationS: 60, wordCount: 6, speechRate: 140, articulationRate: 160, phonationRatio: 0.8, pauseRatio: 0.15, mlr: 9,
  pauses: [], longPauses: 0, midClausePauses: 0, fillers: [], fillersPerMin: 1, repetitions: [], selfCorrections: [], unclear: [],
  wpmSeries: [], wpmStdDev: 10, ...over,
});

const result = (over: Partial<AnalysisResult> = {}): AnalysisResult => ({
  v: 1, skill: 'speaking', part: 1, overall: 6.5, overallRaw: 6.25, range: [6, 7], criteria: {}, topFixes: [], errors: [], vocabUpgrades: [],
  rewrite: { text: '', note: '' }, ...over,
});

describe('buildTokens', () => {
  const words = [
    { w: 'um', start: 0, end: 0.3 },
    { w: 'I', start: 0.9, end: 1 },
    { w: 'goes', start: 1, end: 1.3, conf: 0.35 },
    { w: 'to', start: 1.3, end: 1.4 },
    { w: 'school', start: 1.4, end: 1.8 },
    { w: 'you', start: 2, end: 2.1 },
    { w: 'know', start: 2.1, end: 2.3 },
  ];
  const r = result({
    words,
    errors: [
      { id: 'e0', category: 'grammar.agreement', severity: 'major', start: 1, end: 2, original: 'I goes', correction: 'I go', explanation: '' },
      { id: 'e1', category: 'task.relevance', severity: 'minor', start: -1, end: -1, original: '', correction: '', explanation: '' },
    ],
    metrics: metrics({
      pauses: [{ start: 0.3, end: 0.9, dur: 0.6, kind: 'short', midClause: false, voiced: false }],
      fillers: [
        { word: 'um', time: 0, kind: 'lexical' },
        { word: 'you know', time: 2, kind: 'lexical' },
        { word: '(voiced)', time: 0.3, kind: 'voiced' },
      ],
      unclear: [{ wordIdx: 2, w: 'goes', conf: 0.35, tier: 3 }],
    }),
  });
  const t = buildTokens(r);

  it('attaches error ids to every spanned word and skips unlocatable errors', () => {
    expect(t.map((x) => x.errorIds)).toEqual([[], ['e0'], ['e0'], [], [], [], []]);
  });
  it('attaches a pause to the preceding word', () => {
    expect(t[0]!.pauseAfter?.dur).toBe(0.6);
    expect(t.filter((x) => x.pauseAfter)).toHaveLength(1);
  });
  it('flags single and two-word fillers, ignoring voiced ones', () => {
    expect(t.map((x) => !!x.filler)).toEqual([true, false, false, false, false, true, true]);
  });
  it('marks unclear tiers', () => expect(t[2]!.unclearTier).toBe(3));
  it('handles a result without words', () => expect(buildTokens(result())).toEqual([]));
});

describe('labels and colours', () => {
  it('labels criteria', () => {
    expect(criterionLabel('fc')).toBe('Fluency & Coherence');
    expect(criterionLabel('gra')).toBe('Grammar');
  });
  it('colours bands against the target', () => {
    expect(bandColor(7, 7)).toBe('good');
    expect(bandColor(6.5, 7)).toBe('warn');
    expect(bandColor(6, 7)).toBe('bad');
  });
});

describe('speechStats', () => {
  it('rates a fluent answer good and a halting one bad', () => {
    expect(speechStats(metrics()).every((s) => s.tone === 'good')).toBe(true);
    const bad = speechStats(metrics({ speechRate: 70, mlr: 3, pauseRatio: 0.5, fillersPerMin: 8 }));
    expect(bad.find((s) => s.key === 'rate')!.tone).toBe('bad');
    expect(bad.find((s) => s.key === 'mlr')!.tone).toBe('bad');
  });
});

describe('sessionOverall', () => {
  const c = (b: number) => ({ band: b, range: [b, b] as [number, number], descriptor: '', evidence: [], summary: '' });
  it('weights criteria by speaking time', () => {
    const s = sessionOverall([
      { result: result({ criteria: { fc: c(6), lr: c(6), gra: c(6), p: c(6) } }), durationMs: 30_000 },
      { result: result({ criteria: { fc: c(8), lr: c(7), gra: c(7), p: c(7) } }), durationMs: 90_000 },
      { result: null, durationMs: 60_000 },
    ])!;
    expect(s.scored).toBe(2);
    expect(s.criteria).toEqual({ fc: 8, lr: 7, gra: 7, p: 7 }); // 7.5→8, 6.75→7
    expect(s.band).toBe(7.5); // raw 7.25
  });
  it('returns null when nothing is scored', () => expect(sessionOverall([{ result: result({ noSpeech: true }), durationMs: 1 }])).toBeNull());
});
