import type { SpeechMetrics } from '@ielts/core';
import type { AnalysisResult } from '@server/ai/types';
import { describe, expect, it } from 'vitest';
import { bandColor, buildTokens, criterionLabel, disfluencyTypes, errorGroup, isLongPause, isSentenceNote, notAssessed, offTopicAnswers, paceTone, pauseSec, questionHead, sessionOverall, speechStats, splitFirstSentence } from './result';

const metrics = (over: Partial<SpeechMetrics> = {}): SpeechMetrics => ({
  durationS: 60, wordCount: 140, speechRate: 140, articulationRate: 160, phonationRatio: 0.8, pauseRatio: 0.15, mlr: 9,
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
    expect(bandColor(6, 7)).toBe('warn');
    expect(bandColor(5.5, 7)).toBe('bad');
  });
});

describe('speechStats', () => {
  it('rates a fluent answer good and a halting one bad', () => {
    expect(speechStats(metrics()).every((s) => s.tone === 'good')).toBe(true);
    const bad = speechStats(metrics({ speechRate: 70, mlr: 3, pauseRatio: 0.5, fillersPerMin: 8 }));
    expect(bad.find((s) => s.key === 'rate')!.tone).toBe('bad');
    expect(bad.find((s) => s.key === 'mlr')!.tone).toBe('bad');
  });
  it('gives no verdicts when there is almost no speech', () => {
    for (const m of [metrics({ wordCount: 5, fillersPerMin: 0 }), metrics({ durationS: 8 })]) expect(speechStats(m).every((s) => s.tone === 'na' && s.value === '—')).toBe(true);
  });
});

describe('pauses', () => {
  const p = (dur: number, kind: 'short' | 'long' = 'short') => ({ start: 0, end: dur, dur, kind, midClause: false, voiced: false });
  it('classifies by the shown value, so "1.0" is always long', () => {
    expect([pauseSec(p(5.3 - 4.3)), isLongPause(p(5.3 - 4.3))]).toEqual(['1.0', true]); // 0.9999…96
    expect([pauseSec(p(0.93)), isLongPause(p(0.93))]).toEqual(['0.9', false]);
    expect(speechStats(metrics({ pauses: [p(5.3 - 4.3)], longPauses: 0 })).find((s) => s.key === 'long')!.value).toBe('1');
  });
});

describe('errorGroup / questionHead', () => {
  it('puts non-grammar/lexis errors under other', () => {
    const e = (category: string) => ({ id: 'e', category, severity: 'minor' as const, start: -1, end: -1, original: '', correction: '', explanation: '' });
    expect(['grammar.tense', 'lexis.collocation', 'task.relevance'].map((c) => errorGroup(e(c)))).toEqual(['grammar', 'vocab', 'other']);
  });
  it('treats only long task/other spans as sentence notes', () => {
    const e = (category: string, end: number) => ({ id: 'e', category, severity: 'major' as const, start: 0, end, original: '', correction: '', explanation: '' });
    expect([e('task.relevance', 12), e('task.relevance', 2), e('grammar.sentence-structure', 12)].map(isSentenceNote)).toEqual([true, false, false]);
  });
  it('drops a cue-card title the body repeats', () => {
    expect(questionHead('Describe a website.\nDescribe a website.\nand explain why.\nYou should say: what; how')).toEqual({ head: 'Describe a website.', rest: 'and explain why. You should say: what; how' });
    expect(questionHead('Do you work or study?')).toEqual({ head: 'Do you work or study?', rest: '' });
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
  it('returns null when nothing is scored', () => expect(sessionOverall([{ result: result({ noSpeech: true }), durationMs: 1 }, { result: result({ overall: 0, criteria: { fc: c(0), lr: c(0), gra: c(0), p: c(0) } }), durationMs: 1 }])).toBeNull());
  it('treats overall 0 as not assessed', () => expect([result(), result({ overall: 0 }), result({ noSpeech: true })].map(notAssessed)).toEqual([false, true, true]));
});

describe('offTopicAnswers', () => {
  const rel = (...on: boolean[]) => ({ relevance: on.map((onTopic, questionIdx) => ({ questionIdx, onTopic, note: '' })) }) as AnalysisResult;
  it('flags only when most answers missed the question', () => {
    expect(offTopicAnswers(rel(false, false, false, true, true))).toEqual({ off: 3, total: 5 });
    expect(offTopicAnswers(rel(false, false, true, true))).toBeNull();
    expect(offTopicAnswers(rel(false))).toEqual({ off: 1, total: 1 });
    expect(offTopicAnswers({} as AnalysisResult)).toBeNull();
  });
  it('counts only answered questions, the unit the transcript shows', () => {
    // 5 questions, one answered (the rest have no start word): "5 of 5 off topic" must read "1 of 1".
    const r = { ...rel(false, false, false, false, false), words: [{ w: 'hi', start: 0, end: 1 }], questions: [0, -1, -1, -1, -1].map((startWord) => ({ text: 'q', startWord })) } as AnalysisResult;
    expect(offTopicAnswers(r)).toEqual({ off: 1, total: 1 });
    // A skipped question shares its start word with the next one: empty range, not answered.
    const two = { ...rel(true, false, false), words: [{ w: 'a', start: 0, end: 1 }, { w: 'b', start: 1, end: 2 }], questions: [0, 1, 1].map((startWord) => ({ text: 'q', startWord })) } as AnalysisResult;
    expect(offTopicAnswers(two)).toBeNull(); // Q1 on topic, Q2 off topic, Q3 skipped
  });
});

describe('disfluencies', () => {
  const words = ['he', 'go', 'um', 'he', 'goes', 'to', 'the', 'the', 'shop'].map((w, i) => ({ w, start: i, end: i + 0.9 }));
  const m = metrics({
    durationS: 60,
    fillers: [{ word: 'um', time: 2, kind: 'lexical' }],
    repetitions: [{ phrase: 'the', time: 6, wordIdx: 6 }],
    selfCorrections: [{ time: 3, wordIdx: 3 }],
    // the audio model also heard a false start at 8 s and a filler the transcript lacks
    ...{ fluency: { events: [
      { kind: 'filled', start: 2, end: 2, sources: ['stt'] },
      { kind: 'repair', start: 3, end: 3, sources: ['stt'] },
      { kind: 'repetition', start: 6, end: 6, sources: ['stt'] },
      { kind: 'false_start', start: 8, end: 8, sources: ['audio'] },
      { kind: 'filled', start: 8.5, end: 8.5, sources: ['audio'] },
    ] } },
  });
  it('attaches typed, explained marks to the word where the event happens', () => {
    const t = buildTokens(result({ words, metrics: m }));
    expect(t[2]!.disfluency).toBeUndefined(); // a transcript filler is struck through, not chipped
    expect(t[3]!.disfluency).toEqual([{ kind: 'repair', time: 3, short: 'repair', detail: 'Self-correction: “he go” → “he goes”' }]);
    expect(t[6]!.disfluency![0]).toMatchObject({ kind: 'repetition', detail: 'Repetition: “the” said twice' });
    expect(t[8]!.disfluency!.map((d) => d.kind)).toEqual(['false_start', 'filled']);
  });
  it('gives each type a count, a rate and a verdict', () => {
    const by = Object.fromEntries(disfluencyTypes(m).map((t) => [t.kind, t]));
    expect(by.filled).toMatchObject({ count: 2, perMin: 2, tone: 'good' });
    expect(by.repair!.count).toBe(1);
    expect(by.partial).toBeUndefined(); // only shown when present
    expect(disfluencyTypes(metrics({ wordCount: 10 })).every((t) => t.tone === 'na')).toBe(true);
  });
});

describe('paceTone', () => {
  it('uses the band-7 speech-rate range', () => {
    expect([95, 110, 145, 180, 200].map(paceTone)).toEqual(['bad', 'warn', 'good', 'warn', 'bad']);
  });
});

describe('splitFirstSentence', () => {
  it('splits after the first sentence end', () => {
    expect(splitFirstSentence('Good range. Some slips! More here.')).toEqual(['Good range.', 'Some slips! More here.']);
    expect(splitFirstSentence('Only one sentence.')).toEqual(['Only one sentence.', '']);
    expect(splitFirstSentence('Uses e.g.no space. Next')).toEqual(['Uses e.g.no space.', 'Next']);
  });
});
