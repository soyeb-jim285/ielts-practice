import { expect, it } from 'vitest';
import { chatReply, fakeFetch } from '../test/helpers';
import { setFetch } from './openrouter';
import { analyzeWriting } from './writing';
import { settings, writingLlm } from './fixtures';

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
  expect(user.underLength).toContain('UNDER LENGTH');
  expect(user.essay).toBe(essay);
});
