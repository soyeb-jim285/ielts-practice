import { it, expect } from 'vitest';
import { cleanTranscript, computeSpeechMetrics, fluencyBand, fluencyComposite, fluencyFeatures, fuseDisfluencies, PROVISIONAL_FLUENCY_NORMS, type Word } from './speech';
const mk = (a: [string, number, number, number?][]): Word[] => a.map(([w, start, end, conf]) => ({ w, start, end, conf }));
it('detects short and long pauses, mid-clause flag', () => {
  const m = computeSpeechMetrics(mk([['I', 0, 0.2], ['love', 0.25, 0.5], ['the', 0.9, 1.0], ['city.', 1.1, 1.5], ['It', 2.8, 3.0]]), { durationS: 3 });
  expect(m.pauses.map(p => [p.kind, p.midClause])).toEqual([['short', true], ['long', false]]);
  expect(m.longPauses).toBe(1);
  expect(m.mlr).toBeCloseTo(5 / 3);
});
it('lexical fillers and repetitions and self-correction', () => {
  const m = computeSpeechMetrics(mk([['I', 0, .1], ['um', .2, .3], ['I', .35, .4], ['I', .45, .5], ['went', .55, .7], ['go', .75, .9], ['went', .95, 1.1]]), { durationS: 1.2 });
  expect(m.fillers.map(f => f.word)).toEqual(['um']);
  expect(m.repetitions.length).toBeGreaterThanOrEqual(1);
});
it('voiced gap from energy counts as filler', () => {
  const energy = Array.from({ length: 40 }, (_, i) => (i >= 10 && i < 20 ? 200 : i < 10 || i >= 30 ? 150 : 0)); // 50ms frames
  const m = computeSpeechMetrics(mk([['hello', 0, 0.45], ['there', 1.5, 1.9]]), { durationS: 2, energy, frameMs: 50, voiceThreshold: 60 });
  expect(m.fillers.some(f => f.kind === 'voiced')).toBe(true);
});
it('wpm series 10s windows 5s hop and unclear tiers', () => {
  const words = Array.from({ length: 60 }, (_, i) => ({ w: 'w', start: i * 0.5, end: i * 0.5 + 0.4, conf: i === 3 ? 0.3 : 0.95 }));
  const m = computeSpeechMetrics(words, { durationS: 30 });
  expect(m.wpmSeries[0]).toEqual({ t: 0, wpm: 120 });
  expect(m.wpmSeries.length).toBe(5);
  expect(m.unclear).toEqual([{ wordIdx: 3, w: 'w', conf: 0.3, tier: 3 }]);
});
it('empty words', () => expect(computeSpeechMetrics([], { durationS: 5 }).wordCount).toBe(0));
it('fillers are not counted as words and break runs', () => {
  const m = computeSpeechMetrics(mk([['I', 0, .2], ['um', .2, .5], ['think', .5, .8], ['it', .8, 1], ['uh', 1, 1.3], ['works', 1.3, 1.6]]), { durationS: 1.8 });
  expect(m.wordCount).toBe(4);
  expect(m.speechRate).toBeCloseTo(4 / (1.8 / 60));
  expect(m.mlr).toBeCloseTo(4 / 3);
});
it('parallel structures are not self-corrections; a paused content-word restart is', () => {
  const seq = (ws: string[], gapAt = -1) => mk(ws.map((w, i) => [w, i * 0.3 + (i >= gapAt && gapAt >= 0 ? 0.5 : 0), i * 0.3 + 0.25 + (i >= gapAt && gapAt >= 0 ? 0.5 : 0)]));
  const fluent = seq('the soaring rents and the constant noise of the centre of things, of being'.split(' '));
  expect(computeSpeechMetrics(fluent, { durationS: 5 }).selfCorrections).toEqual([]);
  // "people can ... people will": restart after a 550 ms pause
  expect(computeSpeechMetrics(seq(['people', 'can', 'people', 'will', 'earn'], 2), { durationS: 3 }).selfCorrections.map(s => s.wordIdx)).toEqual([2]);
  expect(computeSpeechMetrics(seq(['people', 'can', 'people', 'will', 'earn']), { durationS: 3 }).selfCorrections).toEqual([]);
});
it('stretched word timestamps expose hidden (filled) pauses', () => {
  // Whisper dropped an "um" and stretched "many" over it: 1.0 s for a 4-letter word
  const m = computeSpeechMetrics(mk([['there', 0, 0.3], ['are', 0.3, 0.5], ['many', 0.5, 1.5], ['jobs', 1.5, 1.8]]), { durationS: 2 });
  expect(m.pauses).toHaveLength(1);
  expect(m.pauses[0]).toMatchObject({ voiced: false, midClause: true }); // no energy data: silence or "um" cannot be told apart
  expect(m.pauses[0]!.dur).toBeCloseTo(1 - 0.28);
  expect(m.fillers).toEqual([]);
  expect(m.mlr).toBe(2);
  const voicedGap = computeSpeechMetrics(mk([['there', 0, 0.3], ['are', 0.3, 0.5], ['many', 0.5, 1.5], ['jobs', 1.5, 1.8]]), { durationS: 2, energy: new Array(40).fill(90) });
  expect(voicedGap.fillers.map(f => f.kind)).toEqual(['voiced']);
  // a normal-length long word is untouched
  expect(computeSpeechMetrics(mk([['it', 0, 0.2], ['unfortunately', 0.2, 1.0]]), { durationS: 1 }).pauses).toEqual([]);
});
it('lexical profile: mtld, ttr, less-common %, overused', () => {
  const m = computeSpeechMetrics(mk('I think commuting is exhausting because commuting takes time and commuting costs money commuting'.split(' ').map((w, i) => [w, i * 0.3, i * 0.3 + 0.25])), { durationS: 5 });
  expect(m.lexical).toMatchObject({ overused: [{ word: 'commuting', count: 4 }] });
  expect(m.lexical!.lessCommonPct).toBeCloseTo(35.7); // commuting ×4 + exhausting of 14
  expect(m.lexical!.ttr).toBeCloseTo(0.79);
  expect(m.lexical!.mtld).toBeGreaterThan(0);
});
it('fuses disfluencies by time: same-kind events within 0.3 s count once, sources merged', () => {
  const energy = Array.from({ length: 80 }, (_, i) => (i >= 20 && i < 40 ? 120 : 150)); // voiced gap 1.0-2.0 s
  const m = computeSpeechMetrics(mk([['I', 0, 0.3], ['um', 0.4, 0.6], ['went', 0.7, 1.0], ['home', 2.0, 2.3], ['home', 2.35, 2.6]]), { durationS: 4, energy, frameMs: 50, voiceThreshold: 60 });
  expect(m.fillers.map(f => f.kind)).toEqual(['lexical', 'voiced']);
  const ev = fuseDisfluencies(m, { filledPauses: [0.5, 1.6, 3.5], repetitions: [2.1], falseStarts: [3.0] });
  expect(ev.map(e => [e.kind, e.start, e.sources.join('+')])).toEqual([
    ['filled', 0.4, 'stt+audio'], // lexical "um" and the audio model's 0.5 s
    ['filled', 1.0, 'voiced+audio'], // audio 1.6 s falls inside the voiced gap
    ['repetition', 2.0, 'stt+audio'],
    ['false_start', 3.0, 'audio'],
    ['filled', 3.5, 'audio'], // only the audio model heard it
  ]);
  expect(fuseDisfluencies(m).length).toBe(3); // without the audio model: um, voiced gap, "home home"
  const f = fluencyFeatures(m, ev);
  expect(f.filledPausesPerMin).toBeCloseTo(3 / (4 / 60));
  expect(f.repairsPer100w).toBeCloseTo(100 / m.wordCount);
  expect(f.repetitionsPer100w).toBeCloseTo(100 / m.wordCount);
});
it('fluency composite: fixed signs, band-5/7 reference profiles map to 5/7, extremes clamp', () => {
  const at = (x: 'mu' | 'lo' | 'hi') => Object.fromEntries(Object.entries(PROVISIONAL_FLUENCY_NORMS).map(([k, n]) => [k, x === 'mu' ? n.mu : n.mu + (x === 'hi' ? 1 : -1) * n.sd])) as any;
  expect(fluencyComposite({ ...at('mu'), repetitionsPer100w: 0 })).toBeCloseTo(0);
  const b7 = { speechRate: 140, mlr: 9, filledPausesPerMin: 4, pauseRatio: 0.2, longPausesPerMin: 2, midClausePausesPerMin: 2, repairsPer100w: 1.5, repetitionsPer100w: 9 };
  const b5 = { speechRate: 95, mlr: 4.5, filledPausesPerMin: 10, pauseRatio: 0.35, longPausesPerMin: 6, midClausePausesPerMin: 6, repairsPer100w: 4, repetitionsPer100w: 0 };
  expect([fluencyBand(fluencyComposite(b7)), fluencyBand(fluencyComposite(b5))]).toEqual([7, 5]); // repetitions are not in the composite
  expect(fluencyComposite({ ...b7, mlr: 1000 })).toBeCloseTo((6 + 3) / 7); // one extreme feature clamps at z = 3
  expect(fluencyComposite({ ...b7, filledPausesPerMin: 30 })).toBeLessThan(fluencyComposite(b7)); // more fillers, less fluent
  expect(fluencyBand(50)).toBe(9);
});
it('cleanTranscript drops fillers, the first copy of repetitions and self-correction reparanda', () => {
  // "it take" is abandoned: 0.5 s pause, then "it took"
  // "you know" is dropped only between pauses (here 0.5 s on each side); "I like football" keeps its verb
  const off = (i: number) => (i >= 8 ? 0.5 : 0) + (i >= 10 ? 0.5 : 0) + (i >= 12 ? 0.5 : 0);
  const words = mk('um he say he say it it take it took you know a kind of long time'.split(' ').map((w, i) => [w, i * 0.3 + off(i), i * 0.3 + 0.25 + off(i)]));
  const m = computeSpeechMetrics(words, { durationS: 7 });
  expect(cleanTranscript(words, m).map(w => w.w).join(' ')).toBe('he say it took a kind of long time');
});
