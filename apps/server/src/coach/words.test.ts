import { fakeFetch, chatReply } from '../test/helpers'; // first: loads the app before the modules that import it back
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { db } from '../db/client';
import { aiCosts } from '../db/schema';
import { flushCosts } from '../ai/cost';
import { setFetch } from '../ai/openrouter';
import type { Candidate, CoachFacts, CoachWords, Skill } from './types';
import { templateWords, validateWords, writeWords } from './words';

const cand = (skill: Skill, kind: string, count = 6, tests = 3): Candidate => ({
  id: `${skill}:${kind}`, skill, kind, count, tests, share: 0.5, score: 1,
  facts: { count, tests, outOf: 5 }, evidence: { attemptIds: ['a'] }, actions: [skill === 'listening' ? 'listening-test' : 'write-task2', 'see-evidence'],
});
const facts = (candidates: Candidate[], over: Partial<CoachFacts> = {}): CoachFacts => ({
  version: 1, generatedFor: 'u', target: 7, examDate: null, daysToExam: null, totalTests: 9,
  skills: [{ skill: 'listening', tests: 5, band: 6.5, range: [6, 7], trend: 'steady', trendDelta: null, needMore: 0, gap: 0.5, series: [] }],
  overall: { band: 6.5, range: [6, 7] }, candidates, win: null, swaps: [], spelling: [],
  patterns: { listening: [], reading: [], writing: [], speaking: [] }, timing: {}, reviewDue: 0,
  weekStats: { tests: 1, minutes: 40, days: 1, prev: { tests: 0, minutes: 0, days: 0 } }, ...over,
});
const item = (c: Candidate, why = 'It cost marks in recent tests.') => ({ candidateId: c.id, title: 'Plural endings', why, action: c.actions[0]!, label: 'Practise this' });
const words = (focus: CoachWords['focus'], summary = 'Your Listening is steady at 6.5.'): CoachWords => ({ summary, focus, win: null, cheat: [], plan: [] });
const reply = (w: CoachWords) => ({ '/chat/completions': () => chatReply(w) });

it('returns valid model output as-is and records a coach cost row', async () => {
  const c = cand('listening', 'plural');
  const w = { ...words([item(c)]), plan: ['Mon', 'Wed', 'Fri'].map((day) => ({ day, text: 'Take a Listening test.', action: 'listening-test' as const })) };
  setFetch(fakeFetch(reply(w)));
  const r = await writeWords(facts([c]));
  expect(r).toEqual({ words: w, model: 'openai/gpt-6-luna' });
  await flushCosts();
  expect((await db.select().from(aiCosts).where(eq(aiCosts.stage, 'coach'))).length).toBeGreaterThan(0);
});

it('replaces an item with an invented number by its template line and drops unknown ids', () => {
  const c = cand('listening', 'plural');
  const f = facts([c]);
  const v = validateWords(words([item(c, 'You lost 9 marks'), { ...item(c), candidateId: 'nope' }]), f);
  expect(v.focus).toHaveLength(1);
  expect(v.focus[0]).toEqual(templateWords(f).focus[0]);
  expect(v.focus[0]!.why).not.toContain('9');
});

it('allows numbers from the candidate facts, rejects a summary with a stray number and digits in labels', () => {
  const c = cand('listening', 'plural');
  const f = facts([c]);
  expect(validateWords(words([item(c, 'It showed up 6 times in 3 tests, out of 5.')]), f).focus[0]!.why).toContain('6 times');
  expect(validateWords(words([item(c)], 'You are at band 8.'), f).summary).toBe(templateWords(f).summary);
  expect(validateWords(words([{ ...item(c), label: 'Do 5 minutes' }]), f).focus[0]!.label).not.toMatch(/\d/);
});

it('keeps at most 3 focus items and 2 per skill', () => {
  const cs = [cand('listening', 'a'), cand('listening', 'b'), cand('listening', 'c'), cand('writing', 'd')];
  const v = validateWords(words(cs.map((c) => item(c))), facts(cs));
  expect(v.focus.map((x) => x.candidateId)).toEqual(['listening:a', 'listening:b', 'writing:d']);
});

it('accepts the win candidate and its skill numbers', () => {
  const w = { ...cand('listening', 'improving', 0, 0), id: 'win:listening', facts: {} };
  const f = facts([], { win: w });
  expect(validateWords({ ...words([]), win: 'Listening is up to 6.5.' }, f).win).toBe('Listening is up to 6.5.');
  expect(validateWords({ ...words([]), win: 'Listening is up to 7.5.' }, f).win).toBe(templateWords(f).win);
});

it('falls back to templates with model null when both models fail', async () => {
  const f = facts([cand('listening', 'plural')]);
  const fake = fakeFetch({ '/chat/completions': () => new Response('{}', { status: 599 }) });
  setFetch(fake);
  const r = await writeWords(f);
  expect(r).toEqual({ words: templateWords(f), model: null });
  expect(fake.calls.map((c) => c.body.model)).toContain('deepseek/deepseek-v4.1-flash');
});
