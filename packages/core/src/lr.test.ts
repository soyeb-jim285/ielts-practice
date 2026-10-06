import { describe, it, expect } from 'vitest';
import { checkEndsAt, expandAnswer, isCorrect, lrBand, normalizeLrContent, scoreLr, stripAnswers, validateLrTest, type LrTest } from './lr';

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
    ['4', ['four'], true],
    ['four', ['4'], true],
    ['fifteenth', ['15th'], true],
    ['15', ['fifteenth'], true],
    ['twenty-one', ['21'], true],
    ['1000', ['1,000'], true],
    ['six hundred and eighty', ['680'], true],
    ['£680', ['680'], true],
    ['2nd floor', ['second floor'], true],
    ['5', ['four'], false],
    ['f', ['FALSE'], true],
    ['0412665903', ['0412 665 903'], true],
    ['0412 665 903', ['0412665903'], true],
    ['0412 665 904', ['0412 665 903'], false],
    ['b 12', ['b12'], true],
    ['AC936', ['AC 936'], true],
    ['AC 937', ['AC 936'], false],
    ['flat 6', ['flat6'], false],
    ['city center', ['city centre'], true],
    ['colour', ['color'], true],
    ['organized', ['organised'], true],
    ['analyze', ['analyse'], true],
    ['size', ['seize'], false],
    ['water', ['waiter'], false],
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
it('strips answers, transcript and review data', () => {
  const t2: LrTest = JSON.parse(JSON.stringify(test));
  t2.sections[0]!.timings = [['secret', 0, 1]];
  t2.sections[0]!.vocab = [{ word: 'secret', meaning: 'x' }];
  t2.sections[0]!.groups[0]!.questions[0]!.review = { evidence: 'secret', why: 'secret' };
  expect(JSON.stringify(stripAnswers(t2))).not.toContain('secret');
  const s = stripAnswers(test);
  expect(JSON.stringify(s)).not.toContain('Smith');
  expect(s.sections[0]!.transcript).toBeUndefined();
});
it('validates', () => expect(validateLrTest(test)).toEqual(['3 questions (expected 40)']));

it('normalizes content to the shared markdown subset', () => {
  expect(normalizeLrContent('### Regular activities\n\n**Beach**\n- no {{2}}')).toBe('**Regular activities**\n\n**Beach**\n- no {{2}}');
  expect(normalizeLrContent('| a | x {{40}} eat<br>– more |')).toBe('| a | x {{40}} eat · – more |');
  expect(normalizeLrContent('| *Example* Tickets | **The** {{1}} |')).toBe('| Example Tickets | **The** {{1}} |');
});

describe('checkEndsAt', () => {
  const t = (words: string[], skill: 'listening' | 'reading' = 'listening') =>
    ({ skill, sections: [{ part: 1, groups: [] }, { part: 4, groups: [], timings: words.map((w, i) => [w, 100 + i, 100.5 + i]) }] }) as unknown as LrTest;
  it.each([
    ['That is the end of the listening test. In the IELTS test, you would now have ten minutes to transfer your answers to the answer sheet.', 600],
    ['That is the end of part four. You now have one minute to check your answers to part four.', 60],
    ['That is the end of section four. You now have half a minute to check your answers.', 30],
  ])('%s', (line, add) => {
    const words = line.split(' ');
    expect(checkEndsAt(t(words))).toBe(Math.round(100.5 + words.length - 1 + add));
  });
  it('nothing announced, no timings, or reading: undefined', () => {
    expect(checkEndsAt(t('and that brings us to the end of the lecture'.split(' ')))).toBeUndefined();
    expect(checkEndsAt(t([]))).toBeUndefined();
    expect(checkEndsAt(t('you now have one minute to check your answers'.split(' '), 'reading'))).toBeUndefined();
  });
  it('the stripped copy keeps only the end time', () => {
    const s = stripAnswers(t('you now have one minute to check your answers'.split(' ')));
    expect(s.checkEndsAt).toBe(Math.round(100.5 + 8 + 60));
    expect(s.sections[1]!.timings).toBeUndefined();
  });
});
