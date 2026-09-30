import { expect, it } from 'vitest';
import { chatReply, fakeFetch } from '../test/helpers';
import { setFetch } from './openrouter';
import { analyzeWriting } from './writing';
import { settings, writingLlm } from './fixtures';
import { keepVerbatimEvidence, medianCriteria, settleRanges } from './schemas';

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
  expect(r.overallRaw).toBe(6.25);
  expect(r.overall).toBe(6.5);
  expect(r.topFixes).toHaveLength(3);
  expect(r.textMetrics!.words).toBeGreaterThan(20);
  const user = JSON.parse(f.calls[0]!.body.messages[1].content);
  expect(user).toMatchObject({ wordCount: r.textMetrics!.words, minimumWords: 250 });
  expect(user.underLength).toBeUndefined(); // never a flag the model can copy into errors
  expect(user.essay).toBe(essay);
  expect(f.calls.every((c) => c.body.reasoning?.effort === 'low')).toBe(true);
  expect(f.calls.map((c) => c.body.response_format.json_schema.name)).toEqual(['writing_analysis', 'writing_scores', 'writing_scores']);
  expect(r.criteria.ta!.evidence).toEqual([]); // fixture quote 'I goes' is not in the essay
});

it('median of samples per criterion, range covers every sample', async () => {
  const ta = [6, 5, 7];
  const f = fakeFetch({
    '/chat/completions': () => {
      const l = writingLlm('people has');
      const band = ta.shift()!;
      l.criteria.ta = { ...l.criteria.ta, band, range: [band, band] };
      return chatReply(l);
    },
  });
  setFetch(f);
  const r = await analyzeWriting({ text: essay, task: 2, variant: 'academic', prompt, settings: settings() });
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
  expect(medianCriteria([{ a: c(5, [5, 6]) }, { a: c(7, [7, 7]) }, { a: c(6, [6, 6]) }]).a).toMatchObject({ band: 6, range: [5, 7] });
});

it('keepVerbatimEvidence drops metric facts and paraphrases', () => {
  const crit = { fc: { band: 6, range: [5, 6] as [number, number], descriptor: '', summary: '', evidence: ['"he, he don\u2019t use"', 'durationS 39.4 (under ~60s target)', 'speechRateWpm 187', 'my father \u2026 the computer', 'he never uses it'] } };
  keepVerbatimEvidence(crit, "Also, um, my father, he, he don't use the computer.");
  expect(crit.fc.evidence).toEqual(['"he, he don\u2019t use"', 'my father \u2026 the computer']);
});
