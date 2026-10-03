import { describe, expect, it } from 'vitest';
import { activeAt, alignWords, frameMsOf } from './timing';
import type { Word } from './types';

const W = (w: string, start: number, end: number): Word => ({ w, start, end });

describe('alignWords', () => {
  it('moves a stretched word start up to its voiced part (Whisper hides the pause inside the next word)', () => {
    const out = alignWords([W('call.', 10, 10.6), W('I', 10.6, 12.3)]);
    expect(out[1]!.start).toBeCloseTo(12.3 - 0.07);
    expect(out[0]).toEqual(W('call.', 10, 10.6));
  });

  it('cuts a 200+ ms quiet run off a word head using the energy frames, and is idempotent', () => {
    // frames of 50 ms: speech 0-1 s, silence 1-2 s, speech 2-3 s; the word window is 1.2-2.4
    const energy = Array.from({ length: 80 }, (_, k) => (k < 20 || (k >= 40 && k < 60) ? 120 : 0));
    const words = [W('end', 0.5, 0.9), W('wonderful', 1.2, 2.4)];
    const out = alignWords(words, energy);
    expect(out[1]!.start).toBeCloseTo(1.95, 1); // first voiced frame 2.0 s minus 50 ms
    expect(out[1]!.end).toBe(2.4);
    expect(alignWords(out, energy)).toEqual(out);
  });

  it('keeps a short quiet onset (soft consonant) and words with no voiced frame', () => {
    const energy = Array.from({ length: 40 }, (_, k) => (k >= 22 ? 120 : 0)); // voiced from 1.1 s
    expect(alignWords([W('s', 1.0, 1.5)], energy)[0]!.start).toBe(1.0);
    expect(alignWords([W('q', 0.1, 0.5)], energy)[0]).toEqual(W('q', 0.1, 0.5)); // all quiet: signal says nothing
  });

  it('does nothing on a near-silent recording', () => {
    const energy = new Array<number>(100).fill(3);
    expect(alignWords([W('a', 0, 1)], energy)[0]).toEqual(W('a', 0, 1));
  });
});

describe('activeAt', () => {
  const words = [W('a', 1, 1.3), W('b', 1.4, 1.8), W('c', 4, 4.4)];
  it('is on the word while it is spoken, none before the first', () => {
    expect(activeAt(words, 0.5)).toEqual({ word: -1, pause: false });
    expect(activeAt(words, 1.1)).toEqual({ word: 0, pause: false });
    expect(activeAt(words, 4.2)).toEqual({ word: 2, pause: false });
  });
  it('holds the word through a short gap (no flicker) but switches to the pause marker in a long one', () => {
    expect(activeAt(words, 1.36)).toEqual({ word: 0, pause: false }); // 0.1 s gap
    expect(activeAt(words, 2.5)).toEqual({ word: 1, pause: true }); // 2.2 s gap, mid-pause
    expect(activeAt(words, 3.99)).toEqual({ word: 1, pause: true });
    expect(activeAt(words, 4.0)).toEqual({ word: 2, pause: false }); // resumes exactly at the next word's start
  });
  it('is on the last word, then its pause, at the end', () => {
    expect(activeAt(words, 4.44)).toEqual({ word: 2, pause: false });
    expect(activeAt(words, 9)).toEqual({ word: 2, pause: true });
  });
  it('handles an empty list', () => {
    expect(activeAt([], 3)).toEqual({ word: -1, pause: false });
  });
});

describe('frameMsOf', () => {
  it('spreads energy frames over the real recording length when a throttled timer stretched them', () => {
    expect(frameMsOf(new Array(560).fill(0), 30_000)).toBeCloseTo(53.57, 1);
    expect(frameMsOf(new Array(600).fill(0), 30_000)).toBe(50);
    expect(frameMsOf(null, 30_000)).toBe(50);
    expect(frameMsOf(new Array(10).fill(0), 30_000)).toBe(50); // implausible
  });
});
