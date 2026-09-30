import { expect, it } from 'vitest';
import { disfluencyProfile, computeSpeechMetrics, fuseDisfluencies, tagDisfluencies, cleanTranscript } from './speech';
import { evaluateDisfluency, fixtureWords } from './disfluency.fixtures';

it('rule tagger: partials, dash cut-offs and held sounds; compounds are left alone', () => {
  const kinds = (s: string) => tagDisfluencies(fixtureWords(s).words).map((e) => e.kind);
  expect(kinds('I th- think b-but the— sooo')).toEqual(['partial', 'partial', 'false_start', 'prolongation']);
  expect(kinds('a well-known so-so t-shirt hmmm e-mail well… re-read')).toEqual([]);
  expect(kinds('the wh… water')).toEqual(['partial']);
});

it('rule + fusion reach the 0.8 recall and precision targets on the fixtures they can see', async () => {
  const s = await evaluateDisfluency();
  for (const k of ['filled', 'repetition', 'partial', 'prolongation'] as const) {
    expect(s[k].recall, `${k} recall`).toBeGreaterThanOrEqual(0.8);
    expect(s[k].precision, `${k} precision`).toBeGreaterThanOrEqual(0.8);
  }
  expect(s.false_start.recall).toBeGreaterThanOrEqual(0.5); // the dash cut-offs only; the rest needs the LLM tagger (scripts/eval-disfluency.ts --llm)
});

it('profile: per-type rates, run length and the mid-clause share', () => {
  const { words, durationS } = fixtureWords('I went home. um|F it was th- far and I I|R walked');
  const m = computeSpeechMetrics(words, { durationS });
  const ev = fuseDisfluencies(m, undefined, 0.3, tagDisfluencies(words));
  const p = disfluencyProfile(ev, m, words);
  expect(Object.keys(p.byKind).sort()).toEqual(['filled', 'partial', 'repetition']);
  expect(p.total.n).toBe(3);
  expect(p.byKind.partial!.per100w).toBeCloseTo(100 / m.wordCount);
  expect(p.meanRunLength).toBeCloseTo(m.wordCount / 4);
  expect(p.midClauseShare).toBeCloseTo(2 / 3); // the filler follows a full stop
  expect(cleanTranscript(words, m).map((w) => w.w)).not.toContain('th-');
});
