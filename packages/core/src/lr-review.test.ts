import { describe, expect, it } from 'vitest';
import { canonAnswerText, type LrTest, type LrTimings } from './lr';
import { analyseAttempt, answerSentence, residualGaps, audioWindow, clusterMoments, questionMoments, classifyGap, dictationDiff, dictationScore, editDistance, evidenceSpan, locatePhrase, maskWord, tfngPattern, wordLimitOf } from './lr-review';

describe('wordLimitOf', () => {
  it.each([['ONE WORD ONLY', 1], ['NO MORE THAN TWO WORDS AND/OR A NUMBER', 2], ['Write THREE WORDS', 3], ['ONE WORD AND/OR A NUMBER', 1], ['A NUMBER', null], [undefined, null]])('%s', (s, n) => expect(wordLimitOf(s as string)).toBe(n));
});

describe('classifyGap', () => {
  const kind = (g: string, a: string[], limit?: string) => classifyGap(g, a, limit)?.kind ?? null;
  it('blank', () => expect(kind('  ', ['x'])).toBe('blank'));
  it('spelling: one slip, transposition, doubled letter, ie/ei, compound', () => {
    expect(classifyGap('acommodation', ['accommodation'])).toMatchObject({ kind: 'spelling', word: 'accommodation', typed: 'acommodation' });
    expect(kind('recieve', ['receive'])).toBe('spelling');
    expect(kind('Wensday', ['Wednesday'])).toBe('spelling');
    expect(kind('checkin', ['check-in'])).toBe('spelling');
    expect(kind('libary', ['library'])).toBe('spelling');
  });
  it('spelling not claimed for short words, digits or different words', () => {
    expect(kind('cat', ['car'])).toBeNull();
    expect(kind('museum', ['library'])).toBeNull();
    expect(kind('0794', ['0795'])).toBeNull();
  });
  it('plural', () => {
    expect(classifyGap('museums', ['(the) museum'])).toMatchObject({ kind: 'plural', word: 'museum', typed: 'museums' });
    expect(kind('library', ['libraries'])).toBe('plural');
  });
  it('word limit', () => {
    expect(kind('the old town hall', ['town hall'], 'NO MORE THAN TWO WORDS')).toBe('word-limit');
    expect(kind('green bicycle', ['bicycle'], 'ONE WORD ONLY')).toBe('word-limit');
  });
  it('article and extra word within the limit', () => {
    expect(kind('the harbour', ['harbour'], 'NO MORE THAN THREE WORDS')).toBe('article');
    expect(kind('city museum', ['museum'], 'NO MORE THAN THREE WORDS')).toBe('extra-word');
    expect(kind('swimming', ['swimming pool'])).toBe('missing-word');
    expect(kind('pool', ['the swimming pool'])).toBe('missing-word');
  });
  it('number format', () => {
    expect(kind('1,000', ['1000'])).toBe('number-format');
    expect(kind('£1,000', ['1000'])).toBe('number-format');
    expect(kind('five', ['5'])).toBe('number-format');
    expect(kind('6:45', ['6.30'])).toBeNull();
  });
  it('plain wrong answer has no label', () => expect(kind('station', ['harbour'])).toBeNull());
});

describe('misc', () => {
  it('edit distance counts a transposition once', () => expect(editDistance('recieve', 'receive')).toBe(1));
  it('maskWord', () => {
    expect(maskWord('accommodation')).toBe('acco_____tion');
    expect(maskWord('cat')).toBe('cat');
  });
});

describe('tfngPattern', () => {
  const r = (answer: string, chose: string) => ({ kind: 'tfng' as const, answer, chose });
  it('finds the repeated confusion', () => {
    const p = tfngPattern([r('NOT GIVEN', 'FALSE'), r('NOT GIVEN', 'FALSE'), r('NOT GIVEN', 'NOT GIVEN'), r('TRUE', 'TRUE'), r('NOT GIVEN', 'TRUE'), r('NOT GIVEN', 'FALSE')]);
    expect(p).toMatchObject({ answer: 'NOT GIVEN', chose: 'FALSE', count: 3, of: 5, pct: 60 });
    expect(p!.text).toBe('You turn NOT GIVEN into FALSE 60% of the time (3 of 5).');
  });
  it('needs enough data', () => expect(tfngPattern([r('FALSE', 'TRUE'), r('FALSE', 'TRUE')])).toBeNull());
});

describe('locating evidence in text', () => {
  const paras = ['The museum opened in 1895. It was designed by a local architect, who later moved abroad.', 'Visitors can park behind the library on Fridays. Entry is free.'];
  it('exact, ignoring case and punctuation', () => {
    const sp = evidenceSpan(paras, { review: { evidence: 'it was designed by a local architect' } }, false)!;
    expect(sp.p).toBe(0);
    expect(paras[0]!.slice(sp.s, sp.e).toLowerCase()).toBe('it was designed by a local architect');
  });
  it('fragments with an ellipsis, then closest sentence', () => {
    const f = evidenceSpan(paras, { review: { evidence: 'The museum opened in 1895 ... who later moved abroad' } }, false)!;
    expect(paras[0]!.slice(f.s, f.e)).toContain('abroad');
    const n = evidenceSpan(paras, { review: { evidence: 'Visitors are able to park behind the library on Friday. Entry is free.' } }, false)!;
    expect(n.p).toBe(1);
  });
  it('gap: sentence around the accepted answer', () => {
    const sp = evidenceSpan(paras, { answer: ['(the) library'] }, true)!;
    expect(paras[1]!.slice(sp.s, sp.e)).toBe('Visitors can park behind the library on Fridays.');
    expect(answerSentence(paras, ['nowhere'])).toBeNull();
  });
  it('non-gap without evidence: nothing', () => expect(evidenceSpan(paras, { answer: ['B'] }, false)).toBeNull());
});

describe('locatePhrase', () => {
  const t: LrTimings = [['The', 0, 0.2], ['tour', 0.3, 0.6], ['starts', 0.7, 1], ['at', 1.1, 1.2], ['half', 1.3, 1.5], ['past', 1.6, 1.8], ['six,', 1.9, 2.3], ['not', 2.5, 2.7], ['seven.', 2.8, 3.2], ['Please', 6, 6.4], ['bring', 6.5, 6.8], ['a', 6.9, 7], ['coat.', 7.1, 7.6]];
  it('exact run', () => expect(locatePhrase(t, 'half past six')).toEqual({ start: 1.3, end: 2.3 }));
  it('single word', () => expect(locatePhrase(t, 'Seven')).toEqual({ start: 2.8, end: 3.2 }));
  it('fuzzy window for a paraphrased evidence', () => expect(locatePhrase(t, 'The tour starts at half-past six, not seven')).toMatchObject({ start: 0, end: 3.2 }));
  it('missing', () => {
    expect(locatePhrase(t, 'elephant')).toBeNull();
    expect(locatePhrase(undefined, 'six')).toBeNull();
    expect(locatePhrase([], 'six')).toBeNull();
  });
  it('audioWindow: evidence, answer, review.at, none', () => {
    expect(audioWindow({ timings: t }, { review: { evidence: 'Please bring a coat' } })).toMatchObject({ from: 4, to: 8.1, start: 6, end: 7.6, exact: true });
    expect(audioWindow({ timings: t }, { answer: ['coat'] })).toMatchObject({ exact: true, from: 5.1 });
    expect(audioWindow({}, { review: { at: 1 } })).toMatchObject({ from: 0, to: 7, exact: false });
    expect(audioWindow({}, { answer: ['x'] })).toBeNull();
  });
});

describe('locatePhrase: numbers spoken as words', () => {
  const sp = (words: string): LrTimings => words.split(' ').map((w, i) => [w, i, i + 0.9] as [string, number, number]);
  it('time: 11.30 = eleven thirty', () => expect(locatePhrase(sp('we finish at eleven thirty sharp'), '11.30')).toEqual({ start: 3, end: 4.9 }));
  it('money: £35 = thirty-five pounds', () => expect(locatePhrase(sp('it costs thirty five pounds an hour'), '£35')).toEqual({ start: 2, end: 3.9 }));
  it('ordinal: 15th = fifteenth, hundred', () => {
    expect(locatePhrase(sp('on the fifteenth of june'), '15th')).toMatchObject({ start: 2 });
    expect(locatePhrase(sp('about five hundred people'), '500')).toMatchObject({ start: 1, end: 2.9 });
  });
  it('postcode spelled out', () => expect(locatePhrase(sp('it is R H one two three T L thanks'), 'RH12 3TL')).toEqual({ start: 2, end: 8.9 }));
  it('audioWindow finds a two-digit answer', () => expect(audioWindow({ timings: sp('it costs thirty five pounds') }, { answer: ['35'] })).toMatchObject({ exact: true }));
});

describe('clusterMoments', () => {
  it('folds close markers, keeps far ones apart', () => {
    const g = clusterMoments([{ at: 100, n: 6 }, { at: 102, n: 7 }, { at: 104, n: 8 }, { at: 200, n: 9 }], 400);
    expect(g.map((x) => x.map((m) => m.n))).toEqual([[6, 7, 8], [9]]);
  });
});

describe('questionMoments', () => {
  const t: LrTimings = [['Half', 1.3, 1.5], ['past', 1.6, 1.8], ['six', 1.9, 2.3], ['Please', 6, 6.4], ['bring', 6.5, 6.8], ['a', 6.9, 7], ['coat.', 7.1, 7.6]];
  const groups = [{ questions: [{ n: 2, answer: ['coat'] }, { n: 1, answer: ['half past'] }, { n: 3, answer: ['x'], review: { at: 20 } }, { n: 4, answer: ['y'] }] }];
  it('ordered by time, approx for review.at, unlocatable dropped', () => {
    expect(questionMoments({ timings: t, groups })).toEqual([
      { n: 1, at: 1.3, from: 0, to: 2.3, exact: true },
      { n: 2, at: 7.1, from: 5.1, to: 8.1, exact: true },
      { n: 3, at: 20, from: 18, to: 26, exact: false },
    ]);
  });
  it('no timings: only review.at', () => expect(questionMoments({ groups }).map((m) => m.n)).toEqual([3]));
});

describe('dictationDiff', () => {
  it('perfect', () => expect(dictationDiff('half past six', 'Half past six.').every((o) => o.status === 'correct')).toBe(true));
  it('wrong, missing and extra words', () => {
    const ops = dictationDiff('the tour start at six now', 'The tour starts at half past six');
    expect(ops.map((o) => `${o.word}:${o.status}`)).toEqual(['The:correct', 'tour:correct', 'starts:wrong', 'at:correct', 'half:missing', 'past:missing', 'six:correct', ':extra']);
    expect(dictationScore(ops)).toEqual({ right: 4, total: 7 });
  });
  it('nothing typed → all missing', () => expect(dictationDiff('', 'a b').map((o) => o.status)).toEqual(['missing', 'missing']));
});

describe('analyseAttempt', () => {
  const test: LrTest = {
    slug: 't', skill: 'reading', variant: 'academic', source: 'generated', ref: 'G', title: 'T',
    sections: [{ part: 1, passage: { title: 'p', paragraphs: [{ text: 'x' }] }, groups: [
      { from: 1, to: 2, type: 'gap', instructions: 'Complete the notes.', wordLimit: 'ONE WORD ONLY', content: '{{1}} {{2}}', questions: [{ n: 1, answer: ['accommodation'] }, { n: 2, answer: ['harbour'] }] },
      { from: 3, to: 5, type: 'tfng', instructions: 'x', questions: [{ n: 3, answer: ['NOT GIVEN'] }, { n: 4, answer: ['TRUE'] }, { n: 5, answer: ['FALSE'] }] },
    ] }],
  };
  it('labels gaps, collects tfng rows and per-type accuracy', () => {
    const marks = [
      { n: 1, given: 'acommodation', correct: false, answer: ['accommodation'] }, { n: 2, given: 'harbour', correct: true, answer: ['harbour'] },
      { n: 3, given: 'FALSE', correct: false, answer: ['NOT GIVEN'] }, { n: 4, given: 'TRUE', correct: true, answer: ['TRUE'] }, { n: 5, given: '', correct: false, answer: ['FALSE'] },
    ];
    const a = analyseAttempt(test, marks, { 1: 'acommodation', 2: 'harbour', 3: 'FALSE', 4: 'TRUE' }, (w) => (w === 'accommodation' ? 2 : 0));
    expect(a.gaps).toEqual([expect.objectContaining({ n: 1, kind: 'spelling', word: 'accommodation', typed: 'acommodation', before: 2 })]);
    expect(a.tfng).toEqual([{ n: 3, kind: 'tfng', chose: 'FALSE', answer: 'NOT GIVEN' }, { n: 4, kind: 'tfng', chose: 'TRUE', answer: 'TRUE' }]);
    expect(a.byType).toEqual([{ label: 'Note completion', right: 1, total: 2 }, { label: 'True / False / Not Given', right: 1, total: 3 }]);
  });
});

it('analyseAttempt keeps the key capitalisation of the word', () => {
  const t: LrTest = { slug: 't', skill: 'reading', variant: 'academic', source: 'generated', ref: 'G', title: 'T', sections: [{ part: 1, passage: { title: 'p', paragraphs: [{ text: 'x' }] }, groups: [{ from: 1, to: 1, type: 'gap', instructions: 'x', content: '{{1}}', questions: [{ n: 1, answer: ['Ethiopia'] }] }] }] };
  const seen: string[] = [];
  const a = analyseAttempt(t, [{ n: 1, given: 'ethiopa', correct: false, answer: ['Ethiopia'] }], { 1: 'ethiopa' }, (w) => (seen.push(w), 0));
  expect(a.gaps[0]).toMatchObject({ word: 'Ethiopia', typed: 'ethiopa' });
  expect(seen).toEqual(['Ethiopia']);
});

describe('classifyGap with section context', () => {
  const text = ` ${canonAnswerText('We sent sixty invitations, but fourteen cannot come, so plan for forty-six. The venue is the Memorial Hall, and there is a garden behind it.')} `;
  const ctx = (skill: 'listening' | 'reading' = 'listening') => ({ skill, text, others: [{ n: 2, keys: ['hargreaves'] }, { n: 4, keys: ['74'] }] });
  const kind = (g: string, a: string[], skill?: 'listening' | 'reading') => classifyGap(g, a, undefined, ctx(skill))?.kind ?? null;
  it('answer that belongs to a nearby question', () => {
    expect(classifyGap('Hargreeves', ['46'], undefined, ctx())).toMatchObject({ kind: 'lost-place', other: 2 });
    expect(kind('seventy four', ['garden'])).toBe('lost-place');
  });
  it('wrong kind of answer: a word for a number, digits for a word', () => {
    expect(kind('afternoon', ['07700 900316'])).toBe('wrong-type');
    expect(kind('12', ['garden'])).toBe('wrong-type');
  });
  it('distractor: said in the section, not the key (number words and digits alike)', () => {
    expect(kind('sixty', ['46'])).toBe('trap');
    expect(kind('60', ['46'])).toBe('trap');
    expect(kind('garden', ['Memorial Hall'])).toBe('trap');
    expect(kind('the', ['Memorial Hall'])).not.toBe('trap'); // a stopword alone is no distractor
  });
  it('different number not in the section', () => {
    expect(kind('50', ['46'])).toBe('number');
  });
  it('reading wording for reading tests', () => {
    expect(classifyGap('garden', ['Memorial Hall'], undefined, ctx('reading'))?.message).toMatch(/passage/);
    expect(classifyGap('garden', ['Memorial Hall'], undefined, ctx('listening'))?.message).toMatch(/speaker/);
  });
  it('unexplained answers stay null for the model to judge', () => expect(kind('cheap', ['inexpensive'])).toBeNull());
  it('form rules still win', () => expect(kind('memorial hal', ['Memorial Hall'])).toBe('spelling'));
  it('listening: a near miss that is a real word was misheard; reading keeps it a spelling slip', () => {
    expect(kind('beach', ['peach'])).toBe('misheard');
    expect(kind('beach', ['peach'], 'reading')).toBe('spelling');
    expect(kind('libary', ['library'])).toBe('spelling');
  });
});

describe('analyseAttempt causes', () => {
  const test: LrTest = {
    slug: 't', skill: 'listening', variant: 'academic', source: 'generated', ref: 'G', title: 'T',
    sections: [{ part: 1, audio: 'a', transcript: 'The rooms are fairly inexpensive. We sent sixty invitations but plan for forty-six.', groups: [
      { from: 1, to: 4, type: 'gap', instructions: 'x', content: '{{1}} {{2}} {{3}} {{4}}', questions: [{ n: 1, answer: ['inexpensive'] }, { n: 2, answer: ['46'] }, { n: 3, answer: ['receive'] }, { n: 4, answer: ['apricot'] }] },
      { from: 5, to: 6, type: 'mcq', instructions: 'x', questions: [{ n: 5, answer: ['A'] }, { n: 6, answer: ['B'] }] },
    ] }],
  };
  const marks = [
    { n: 1, given: 'cheap', correct: false, answer: ['inexpensive'] }, { n: 2, given: 'sixty', correct: false, answer: ['46'] },
    { n: 3, given: 'recieve', correct: false, answer: ['receive'] }, { n: 4, given: 'apple', correct: false, answer: ['apricot'] },
    { n: 5, given: 'C', correct: false, answer: ['A'] }, { n: 6, given: '', correct: false, answer: ['B'] },
  ];
  const responses = { 1: 'cheap', 2: 'sixty', 3: 'recieve', 4: 'apple', 5: 'C' };
  it('residual gaps are the ones no rule explains', () => expect(residualGaps(test, marks, responses).map((r) => r.n)).toEqual([1, 4]));
  it('groups every lost mark by cause, largest first, with model reasons merged', () => {
    const a = analyseAttempt(test, marks, responses, () => 0, new Map([[1, 'synonym'], [4, 'misheard']] as const));
    expect(a.gaps.map((g) => [g.n, g.kind])).toEqual([[1, 'synonym'], [2, 'trap'], [3, 'spelling'], [4, 'misheard']]);
    expect(a.causes!.map((c) => [c.family, c.questions])).toEqual([['slip', [1, 3]], ['trap', [2, 5]], ['missed', [4]], ['blank', [6]]]);
  });
  it('without a model reason the answer is a different detail', () => {
    expect(analyseAttempt(test, marks, responses).gaps.find((g) => g.n === 4)).toMatchObject({ kind: 'other', label: 'Different detail' });
  });
});
