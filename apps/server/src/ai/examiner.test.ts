import { expect, it } from 'vitest';
import type { SpeakingTest } from '../routes/prompts';
import { candidateFacts, detectBranch, direction, EXAMINER_SYSTEM, gptLiveCue, newState, nextPhase, p1Plan, realtimeInstructions, type LiveState } from './examiner';

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

it('Part 3 announces the sub-topic headings: the first in the lead, the second before the fourth question', () => {
  const t: SpeakingTest = { ...test, part2: { ...test.part2, title: 'Describe a book you read.' }, part3: { ...test.part3, bullets: ['Reading habits', 'Books and libraries'], followUps: ['q1?', 'q2?', 'q3?', 'q4?', 'q5?', 'q6?'] } };
  const st = (p3Asked: number) => ({ ...newState('s', t, T0), phase: 'p3' as const, p3Asked });
  expect(direction(st(0)).say).toContain("talking about a book you read, and I'd like to discuss with you one or two more general questions related to this. Let's consider first of all Reading habits.");
  expect(direction(st(3)).say).toContain("Now let's move on to consider Books and libraries.");
  expect(direction(st(2)).say).not.toContain('move on');
});

// ---- adaptive examiner
const wsTest = {
  ...test,
  part1: [prompt('ws', 1, { topic: 'Work or study', followUps: ['Do you work or are you a student?', 'What do you enjoy most about your work or studies?', 'x3?', 'x4?'] }), ...test.part1.slice(0, 1)],
  branches: { work: ['What kind of work do you do?', 'How long have you done it?', 'What do you like about it?'], study: ['What subject are you studying?', 'Why did you choose it?', 'Do you like your course?'] },
};
const talk = (text: string, phase: LiveState['phase'] = 'p1') => ({ role: 'candidate' as const, text, at: T0, phase });
const ex = (text: string) => ({ role: 'examiner' as const, text, at: T0, phase: 'p1' as const });
const wsState = (answer: string, extra: Partial<LiveState> = {}): LiveState => ({
  ...newState('s', wsTest, T0), phase: 'p1', p1Asked: 1, history: [ex('Do you work or are you a student?'), talk(answer)], ...extra,
});

it('detects the work/study branch from keywords, neutral when ambiguous', () => {
  expect(detectBranch('I work as a nurse in a hospital')).toBe('work');
  expect(detectBranch("I'm a student at Dhaka University")).toBe('study');
  expect(detectBranch("I don't work, I'm studying")).toBe('study');
  expect(detectBranch('I work part time and study at college')).toBe('both');
  expect(detectBranch('Uh, not really')).toBeNull();
});

it('continues Part 1 with the matching branch set', () => {
  expect(direction(wsState('I work in a bank')).say).toContain('What kind of work do you do?');
  expect(direction(wsState("I'm a student")).say).toContain('What subject are you studying?');
  expect(direction(wsState('both, work and study')).say).toContain('your work or studies');
  expect(p1Plan(wsState('I work')).length).toBe(p1Plan(wsState('both')).length);
});

it('Part 1 and 3 cues are guides, the cue card stays verbatim', () => {
  const s = wsState('I work as a nurse');
  expect(direction(s).say).not.toMatch(/exactly/);
  expect(direction({ ...s, phase: 'p3', p3Asked: 1 }).say).not.toMatch(/exactly/);
  expect(direction({ ...s, phase: 'p3', p3Asked: 0 }).say).toContain('suggested question');
  expect(direction({ ...s, phase: 'p2-follow' }).say).not.toMatch(/exactly/);
  for (const i of [realtimeInstructions(wsTest), gptLiveCue('begin', wsTest), gptLiveCue('follow', wsTest)]) expect(i).not.toMatch(/ask (its questions|these questions) in (this )?order|script exactly/i);
  expect(gptLiveCue('part2', wsTest)).toContain('Say exactly');
  expect(realtimeInstructions(wsTest)).toContain('What kind of work do you do?');
});

it('carries a facts note into later cues', () => {
  const h = [ex('Where are you from?'), talk("I'm from Dhaka", 'intro'), ex('Do you work or are you a student?'), talk('I work as a nurse in a clinic')];
  const f = candidateFacts(h);
  expect(f).toMatch(/works \(a nurse in a clinic\)/);
  expect(f).toContain('Dhaka');
  expect(direction(wsState('I work as a nurse')).say).toContain('works (a nurse)');
  expect(gptLiveCue('follow', wsTest, f)).toContain(f);
  expect(candidateFacts([])).toBe('');
});
