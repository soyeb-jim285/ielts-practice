import { expect, it } from 'vitest';
import { chatReply, fakeFetch } from '../test/helpers';
import { setFetch } from './openrouter';
import { analyzeWriting, calibrate, WRITING_CALIBRATION } from './writing';
import { settings, writingLlm } from './fixtures';
import { keepVerbatimEvidence, settleRanges } from './schemas';
import { roundBand } from '@ielts/core';
import { bandDescriptor, WRITING_DESCRIPTORS } from './descriptors';

const prompt = { title: 'Technology', body: 'Some people think technology makes life harder. Discuss.' };
const essay = `Many people has argued that technology makes life easier.\n\n${'In my view it helps us work, learn and stay in touch with family every day. '.repeat(4)}`;

it('20 words or fewer: Band 1 without any AI call', async () => {
  const f = fakeFetch({});
  setFetch(f);
  const r = await analyzeWriting({ text: 'Technology is good because it helps people. I agree with this idea a lot.', task: 2, variant: 'academic', prompt, settings: settings() });
  expect(r).toMatchObject({ overall: 1, tooShort: true, topFixes: [] });
  expect(Object.values(r.criteria).map((c) => c!.band)).toEqual([1, 1, 1, 1]);
  expect(r.criteria.ta!.descriptor).toBe('Responses of 20 words or fewer are rated at Band 1');
  expect(f.calls).toHaveLength(0);
});

it('maps quotes to char spans and rounds the overall', async () => {
  const quote = 'people has';
  const f = fakeFetch({ '/chat/completions': () => chatReply(writingLlm(quote)) });
  setFetch(f);
  const r = await analyzeWriting({ text: essay, task: 2, variant: 'academic', prompt, settings: settings() });
  const [e0, e1] = r.errors;
  expect(essay.slice(e0!.start, e0!.end)).toBe(quote);
  expect(e1).toMatchObject({ id: 'e1', start: -1, end: -1 });
  const bands = Object.values(r.criteria).map((c) => c!.band);
  expect(bands.every(Number.isInteger)).toBe(true);
  expect(r.overallRaw).toBe(bands.reduce((a, b) => a + b) / 4); // shown criteria average to the overall
  expect(r.overall).toBe(roundBand(r.overallRaw));
  expect(r.topFixes).toHaveLength(3);
  expect(r.textMetrics!.words).toBeGreaterThan(20);
  const user = JSON.parse(f.calls[0]!.body.messages[1].content);
  expect(user).toMatchObject({ wordCount: r.textMetrics!.words, minimumWords: 250 });
  expect(user.underLength).toBeUndefined(); // never a flag the model can copy into errors
  expect(user.essay).toBe(essay);
  expect(f.calls.every((c) => c.body.reasoning?.effort === 'low')).toBe(true);
  expect(f.calls.map((c) => c.body.response_format.json_schema.name)).toEqual(['writing_analysis', ...Array(4).fill('writing_scores')]);
  expect(r.criteria.ta!.evidence).toEqual([]); // fixture quote 'I goes' is not in the essay
});

it('mean of 5 samples per criterion, range covers every sample', async () => {
  const ta = [6, 5, 7, 6, 6];
  const f = fakeFetch({
    '/chat/completions': () => {
      const l = writingLlm('people has');
      const band = ta.shift()!;
      l.criteria.ta = { ...l.criteria.ta, band, range: [band, band] };
      return chatReply(l);
    },
  });
  setFetch(f);
  const other = settings();
  other.models = { ...other.models, analysis: 'other/model' }; // uncalibrated
  const r = await analyzeWriting({ text: essay, task: 2, variant: 'academic', prompt, settings: other });
  expect(r.criteria.ta).toMatchObject({ band: 6, range: [5, 7] });
});

it('a submitted plan makes planFollowed required in the schema', async () => {
  const f = fakeFetch({ '/chat/completions': () => chatReply({ ...writingLlm('x'), structure: { ...writingLlm('x').structure, planFollowed: { followed: true, note: 'ok' } } }) });
  setFetch(f);
  const r = await analyzeWriting({ text: essay, task: 2, variant: 'academic', prompt, plan: 'tech helps; example family', settings: settings() });
  expect(r.structure!.planFollowed).toEqual({ followed: true, note: 'ok' });
  expect(f.calls[0]!.body.response_format.json_schema.schema.properties.structure.properties.planFollowed.type).toBe('object');
});

it('settleRanges widens a single-band range to band ±1 (clamped)', () => {
  const c = (band: number, range: [number, number]) => ({ band, range, descriptor: '', evidence: [], summary: '' });
  const crit = { ta: c(6, [6, 6]), cc: c(9, [9, 9]), lr: c(6, [6, 7]), gra: c(5, [6, 6]) };
  settleRanges(crit, () => 0);
  expect(Object.values(crit).map((x) => x.range)).toEqual([[5, 7], [8, 9], [6, 7], [5, 6]]);
});

it('keepVerbatimEvidence drops metric facts and paraphrases', () => {
  const crit = { fc: { band: 6, range: [5, 6] as [number, number], descriptor: '', summary: '', evidence: ['"he, he don\u2019t use"', 'durationS 39.4 (under ~60s target)', 'speechRateWpm 187', 'my father \u2026 the computer', 'he never uses it'] } };
  keepVerbatimEvidence(crit, "Also, um, my father, he, he don't use the computer.");
  expect(crit.fc.evidence).toEqual(['"he, he don\u2019t use"', 'my father \u2026 the computer']);
});

it('calibrate is continuous and monotonic over 1..9 and leaves band 3.5 and below alone', () => {
  for (const { b, s } of Object.values(WRITING_CALIBRATION))
    for (let m = 1; m < 9; m += 0.25) {
      const step = calibrate(m + 0.25, b, s) - calibrate(m, b, s);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(0.25 + b + Math.abs(s)); // no cliff (the old "+0.5 from band 5" jumped 0.75 between 4.75 and 5)
      if (m <= 3.5) expect(calibrate(m, b, s)).toBe(m);
    }
});

it('calibration applies only to the model it was fitted on, never to an off-topic (TA 4) script (capped at TA + 1), and shown criteria always average to the overall', async () => {
  const quote = 'people has';
  const avg = (r: { criteria: object }) => Object.values(r.criteria).reduce((a, c) => a + c.band, 0) / 4;
  setFetch(fakeFetch({ '/chat/completions': () => chatReply(writingLlm(quote)) }));
  const other = settings();
  other.models = { ...other.models, analysis: 'other/model' };
  const r = await analyzeWriting({ text: essay, task: 2, variant: 'academic', prompt, settings: other });
  expect([r.overallRaw, r.overall]).toEqual([6.25, 6.5]);
  expect(Object.values(r.criteria).map((c) => c!.band)).toEqual([6, 7, 6, 6]);

  const { b, s } = WRITING_CALIBRATION[settings().models.analysis]!;
  setFetch(fakeFetch({ '/chat/completions': () => chatReply(writingLlm(quote)) }));
  const cal = await analyzeWriting({ text: essay, task: 2, variant: 'academic', prompt, settings: settings() });
  expect(cal.overallRaw).toBe(Math.round(4 * calibrate(6.25, b, s)) / 4);
  expect(avg(cal)).toBe(cal.overallRaw);
  expect(cal.overall).toBe(roundBand(cal.overallRaw));
  // the shift lands on whole criterion bands (LR/GRA first on ties); a band no sample gave carries the official descriptor
  expect(Object.values(cal.criteria).map((c) => c!.band)).toEqual([6, 7, 7, 7]);
  expect(cal.criteria.gra).toMatchObject({ descriptor: bandDescriptor(WRITING_DESCRIPTORS.gra, 7), summary: `To reach band 8: ${bandDescriptor(WRITING_DESCRIPTORS.gra, 8)}` });

  const off = writingLlm(quote);
  off.criteria.ta = { ...off.criteria.ta, band: 4, range: [4, 5] };
  setFetch(fakeFetch({ '/chat/completions': () => chatReply(off) }));
  const w = await analyzeWriting({ text: essay, task: 2, variant: 'academic', prompt, settings: settings() });
  expect(Object.values(w.criteria).map((c) => c!.band)).toEqual([4, 7, 6, 6]);
  // uncalibrated mean 5.75, then the off-topic cap (TA + 1) applies to overall and range
  expect([w.overallRaw, w.overall, w.range[1]]).toEqual([5, 5, 5]);
});
