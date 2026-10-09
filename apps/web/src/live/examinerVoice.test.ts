import { describe, expect, it } from 'vitest';
import { voiceGate } from './examinerVoice';
import { answerWindows } from './turn';

describe('voiceGate', () => {
  it('opens on audible frames and holds through gaps shorter than the hangover', () => {
    const g = voiceGate(600, 50);
    expect(g(0)).toBe(false);
    expect(g(0.2)).toBe(true);
    for (let i = 0; i < 11; i++) expect(g(0)).toBe(true); // 550 ms between words: still the same line
    expect(g(0.2)).toBe(true);
    for (let i = 0; i < 11; i++) g(0);
    expect(g(0)).toBe(false); // 600 ms of silence: the examiner has stopped
  });
});

describe('answerWindows', () => {
  it('records the candidate between examiner lines, numbers answers by question, and skips breaths', () => {
    let t = 0;
    const w = answerWindows(() => t);
    w.examiner(false); // part starts while nobody is talking
    t = 4000;
    w.examiner(true); // Q1 follows an answer: question 0 was the part opening
    w.examiner(false); // the recorder clock does not move while paused
    t = 4800;
    w.examiner(true); // 0.8 s: a breath, not an answer, so the question index stays
    w.examiner(false);
    t = 12_000;
    w.examiner(true);
    w.examiner(false);
    t = 15_000;
    expect(w.finish()).toEqual([
      { q: 0, startMs: 0, endMs: 4000 },
      { q: 1, startMs: 4800, endMs: 12_000 },
      { q: 2, startMs: 12_000, endMs: 15_000 },
    ]);
  });
  it('a part that starts with the examiner speaking has no window until the examiner stops', () => {
    let t = 0;
    const w = answerWindows(() => t);
    w.examiner(true);
    w.examiner(false);
    t = 6000;
    expect(w.finish()).toEqual([{ q: 0, startMs: 0, endMs: 6000 }]);
  });
  it('a silent wait before the first question is not an answer, so the next answer still gets question 0', () => {
    let t = 0;
    const voiced = ([from, to]: [number, number]) => Math.max(0, to - Math.max(from, 3000)); // the candidate only speaks after the examiner's first line, from 3 s on
    const w = answerWindows(() => t, (a, b) => voiced([a, b]));
    w.examiner(false); // the part starts before the examiner's question is audible
    t = 2500;
    w.examiner(true); // 2.5 s of silence: long enough by time, but nobody spoke
    w.examiner(false);
    t = 3000;
    t = 9000;
    w.examiner(true); // a real answer
    w.examiner(false);
    t = 14_000;
    expect(w.finish()).toEqual([{ q: 0, startMs: 2500, endMs: 9000 }, { q: 1, startMs: 9000, endMs: 14_000 }]);
  });
});
