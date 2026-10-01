import { expect, it } from 'vitest';
import type { SpeakingTest } from '../routes/prompts';
import { direction, EXAMINER_SYSTEM, newState, nextPhase, realtimeInstructions, type LiveState } from './examiner';

const prompt = (id: string, part: number, extra = {}) => ({
  id, slug: id, skill: 'speaking' as const, part, variant: null, type: 't', topic: `topic ${id}`, title: `Describe ${id}`, body: `body ${id}`,
  bullets: null, followUps: null, chart: null, imageUrl: null, source: 'generated' as const, sourceRef: null, groupId: 'g', done: false, ...extra,
});
const test: SpeakingTest = {
  part1: ['a', 'b', 'c'].map((t) => prompt(t, 1, { followUps: [1, 2, 3, 4].map((n) => `${t} question ${n}?`) })),
  part2: prompt('a book', 2, { bullets: ['what it is', 'why you liked it'] }),
  part3: prompt('reading', 3, { followUps: ['Do people read less now?', 'Why?'] }),
};
const T0 = 1_000_000;
const at = (phase: LiveState['phase'], extra: Partial<LiveState> = {}): LiveState => ({ ...newState('s', test, T0), phase, ...extra });
const cand = (phase: LiveState['phase']) => ({ role: 'candidate' as const, text: 'answer', at: T0, phase });

it('intro → p1 after the candidate answers', () => {
  expect(nextPhase(at('intro'), T0)).toBe('intro');
  const s = at('intro');
  s.history.push(cand('intro'));
  expect(nextPhase(s, T0 + 5000)).toBe('p1');
});

it('p1 → p2-prep after 12 questions or 4.5 min', () => {
  expect(nextPhase(at('p1', { p1Asked: 11 }), T0 + 60_000)).toBe('p1');
  expect(nextPhase(at('p1', { p1Asked: 12 }), T0 + 60_000)).toBe('p2-prep');
  expect(nextPhase(at('p1', { p1Asked: 5 }), T0 + 270_000)).toBe('p2-prep');
});

it('p2-prep → p2-talk at +60 s; p2-talk → p2-follow at 120 s or when the candidate stops', () => {
  expect(nextPhase(at('p2-prep'), T0 + 59_000)).toBe('p2-prep');
  expect(nextPhase(at('p2-prep'), T0 + 60_000)).toBe('p2-talk');
  expect(nextPhase(at('p2-talk'), T0 + 119_000)).toBe('p2-talk');
  expect(nextPhase(at('p2-talk'), T0 + 120_000)).toBe('p2-follow');
  const s = at('p2-talk');
  s.history.push(cand('p2-talk'));
  expect(nextPhase(s, T0 + 70_000)).toBe('p2-follow');
});

it('p2-follow → p3 after one answer; p3 → closing after 6 questions; closing → done', () => {
  const s = at('p2-follow');
  expect(nextPhase(s, T0)).toBe('p2-follow');
  s.history.push(cand('p2-follow'));
  expect(nextPhase(s, T0)).toBe('p3');
  expect(nextPhase(at('p3', { p3Asked: 5 }), T0 + 60_000)).toBe('p3');
  expect(nextPhase(at('p3', { p3Asked: 6 }), T0 + 60_000)).toBe('closing');
  expect(nextPhase(at('closing'), T0)).toBe('done');
});

it('directions use the real test wording and never ask for feedback', () => {
  expect(direction(at('p1')).fallback).toBe("Thank you. Now, in this first part, I'd like to ask you some questions about yourself. Let's talk about topic a. a question 1?");
  expect(direction(at('p1', { p1Asked: 4 })).fallback).toBe("Now let's talk about topic b. b question 1?");
  expect(direction(at('p1', { p1Asked: 5 })).fallback).toBe('b question 2?');
  const timedOut = at('p2-follow');
  timedOut.history.push({ ...cand('p2-talk'), durationMs: 120_000 });
  expect(direction(timedOut).fallback).toContain("That's the end of your time.");
  expect(direction(at('p3')).fallback).toMatch(/^We've been talking about a book.*Do people read less now\?$/);
  expect(EXAMINER_SYSTEM(at('p1'))).toMatch(/Never give feedback/);
  const rt = realtimeInstructions(test);
  expect(rt).toContain('Never give feedback');
  expect(rt).toContain("Now, I'm going to give you a topic");
  expect(rt).toContain('c question 4?');
  expect(rt).toContain('- why you liked it');
});
