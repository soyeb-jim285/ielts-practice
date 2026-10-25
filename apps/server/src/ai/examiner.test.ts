import { expect, it } from 'vitest';
import type { SpeakingTest } from '../routes/prompts';
import { examinerPrompt, liveQuestions, newState, sessionScript } from './examiner';

const prompt = (id: string, part: number, extra = {}) => ({
  id, slug: id, skill: 'speaking' as const, part, variant: null, type: 't', topic: `topic ${id}`, title: `Describe ${id}`, body: `body ${id}`,
  bullets: null, followUps: null, chart: null, imageUrl: null, source: 'generated' as const, sourceRef: null, groupId: 'g', done: false, ...extra,
});
const test: SpeakingTest = {
  part1: ['a', 'b', 'c'].map((t) => prompt(t, 1, { followUps: [1, 2, 3, 4].map((n) => `${t} question ${n}?`) })),
  part2: prompt('a book', 2, { bullets: ['what it is', 'why you liked it'] }),
  part3: prompt('reading', 3, { followUps: ['Do people read less now?', 'Why?'] }),
};

it('the introduction follows the real frame and varies per session', () => {
  const seq = (...xs: number[]) => () => xs.shift() ?? 0;
  expect(sessionScript(9, '', () => 0.9).intro).toEqual([`Good morning. I'm Charlie, and I'm going to be your examiner. What's your full name, please?`]);
  expect(sessionScript(14, 'Work or study', () => 0).intro).toEqual(["Good afternoon. My name is Alex, and I'll be your examiner today. Can you tell me your full name, please?", 'Thank you. And what shall I call you?', "Thank you. And can you tell me where you're from?"]);
  expect(sessionScript(20, '', seq(0, 0, 0, 0.9, 0)).intro[1]).toBe("Thank you. And can you tell me where you're from?"); // no preferred-name question this time
  expect(sessionScript(undefined, '', () => 0.9).intro[0]).toMatch(/^Hello\./);
  expect(sessionScript(2, '', () => 0.9).intro[0]).toMatch(/^Hello\./); // never "Good morning" in the small hours
  for (const topic of ['Your hometown', 'Hometown']) expect(sessionScript(14, topic, () => 0).intro.join(' ')).not.toMatch(/where/i); // the hometown frame asks it next
  const many = Array.from({ length: 300 }, () => sessionScript(10));
  expect(new Set(many.map((x) => x.intro[0])).size).toBeGreaterThan(30);
  expect(new Set(many.map((x) => x.intro.length))).toEqual(new Set([1, 2, 3]));
  expect(new Set(many.map((x) => x.p1Lead)).size).toBeGreaterThan(2);
  for (const x of many) {
    expect(x.intro.every((l) => l.endsWith('?') && !/introduce yourself|tell me about yourself|identification|\bID\b/i.test(l))).toBe(true);
    expect(x.intro[0]).toMatch(/\b(Alex|Sam|Chris|Jamie|Robin|Charlie)\b/);
    expect(x.p1Lead).toMatch(/\bfirst part\b|\bquestions about yourself\b/i); // the clients move intro → Part 1 on this (web duplex.ts P1_START)
  }
});

it('the LiveKit prompt scripts the introduction word for word and gives Parts 1 and 3 as topics only, no question list', () => {
  const s = newState('s', { ...test, script: { intro: ['Hello. Full name?', 'Thank you. And what shall I call you?'], p1Lead: 'Thank you. In this first part, I have some questions about yourself.', moveOn: "Let's move on to talk about" } }, 0);
  expect(s.history[0]!.text).toBe('Hello. Full name?');
  const p = examinerPrompt({ ...s.test, part3: { ...test.part3, bullets: ['reading habits', 'libraries'] } });
  expect(p).toContain('Say "Hello. Full name?" and wait for the answer. Then say "Thank you. And what shall I call you?" and wait for the answer.');
  expect(p).toContain('Topics, in this order: "topic a", "topic b", "topic c".');
  expect(p).toContain('first "reading habits", then "libraries"');
  // the owner's rule (2026-10-26): no forced questions; the model asks what fits the conversation
  for (const q of ['a question 1?', 'Do people read less now?']) expect(p).not.toContain(q);
  expect(p).toContain('there is no question list');
  expect(p).toContain('Never ask for information they have already given'); // "I work at a software company" was followed by "What kind of work do you do?"
  expect(p).toContain('Describe a book'); // Part 2 card stays word for word
  expect(p).toContain('read aloud by a text-to-speech voice');
  const ws = { ...test, part1: [prompt('ws', 1, { topic: 'Work or study', followUps: ['Do you work or are you a student?'] })], branches: { work: ['What kind of work do you do?'], study: ['What subject are you studying?'] } };
  expect(examinerPrompt(ws)).not.toContain('What kind of work do you do?');
});

it('live Part 1 is marked against the examiner lines, else the scripted questions', () => {
  const s = newState('s', test, 0);
  expect(liveQuestions(s, 1)).toEqual(test.part1.flatMap((p) => p.followUps!));
  expect(liveQuestions(s, 3)).toBeNull();
  s.history.push({ role: 'examiner', text: 'Why?', at: 0, phase: 'p3' });
  expect(liveQuestions(s, 3)).toEqual(['Why?']);
});
