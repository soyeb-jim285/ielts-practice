import { describe, it, expect } from 'vitest';
import { expandAnswer, isCorrect, lrBand, scoreLr, stripAnswers, validateLrTest, type LrTest } from './lr';

describe('answer matching', () => {
  it('expands optional words', () => expect(expandAnswer('(the) old (town) hall').sort()).toEqual(['old hall', 'old town hall', 'the old hall', 'the old town hall']));
  it.each([
    ['The Museum', ['(the) museum'], true],
    ['museum.', ['(the) museum'], true],
    ['24-hour', ['24 hour'], true],
    ['muzeum', ['(the) museum'], false],
    ['ng', ['NOT GIVEN'], true],
    ['', ['x'], false],
    ['b', ['B'], true],
    ['F', ['F'], true],
    ['f', ['FALSE'], true],
  ])('%s vs %j → %s', (g, a, ok) => expect(isCorrect(g, a)).toBe(ok));
});

it('band tables', () => {
  expect(lrBand('listening', 'academic', 30)).toBe(7);
  expect(lrBand('reading', 'academic', 30)).toBe(7);
  expect(lrBand('reading', 'general', 30)).toBe(6);
  expect(lrBand('listening', 'academic', 0)).toBe(0);
  expect(lrBand('reading', 'academic', 20, 20)).toBe(9);
});

const test: LrTest = {
  slug: 't', skill: 'listening', variant: 'academic', source: 'generated', ref: 'G1', title: 'x',
  sections: [{
    part: 1, audio: 'a.mp3', transcript: 'secret', groups: [
      { from: 1, to: 1, type: 'gap', instructions: 'i', content: 'Name: {{1}}', questions: [{ n: 1, answer: ['Smith'] }] },
      { from: 2, to: 3, type: 'mcq-multi', instructions: 'Choose TWO', options: ['A', 'B', 'C', 'D'].map((key) => ({ key, text: key })), questions: [{ n: 2, answer: ['B', 'D'] }, { n: 3, answer: ['B', 'D'] }] },
    ],
  }],
};

it('scores mcq-multi in any order without double counting', () => {
  expect(scoreLr(test, { 1: 'smith', 2: 'D', 3: 'B' }).raw).toBe(3);
  expect(scoreLr(test, { 2: 'B', 3: 'B' }).raw).toBe(1);
});
it('strips answers and transcript', () => {
  const s = stripAnswers(test);
  expect(JSON.stringify(s)).not.toContain('Smith');
  expect(s.sections[0]!.transcript).toBeUndefined();
});
it('validates', () => expect(validateLrTest(test)).toEqual(['3 questions (expected 40)']));
