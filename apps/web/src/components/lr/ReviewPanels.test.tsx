import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { DictationResult, PacingPanel, QuestionDetail, TfngPanel, timesText, wrongNote } from './ReviewPanels';
import { Transcript, Passage } from './Passage';

afterEach(cleanup);
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('wrongNote', () => {
  const q: any = { n: 1, review: { wrong: { A: 'too early', 'NOT GIVEN': 'nothing said', FALSE: 'it says so' } } };
  it('finds the note for the pick', () => {
    expect(wrongNote(q, 'a')).toBe('too early');
    expect(wrongNote(q, 'ng')).toBe('nothing said');
    expect(wrongNote(q, 'F')).toBe('it says so');
    expect(wrongNote(q, 'C')).toBeUndefined();
  });
});
it('timesText', () => expect([timesText(1), timesText(2), timesText(3)]).toEqual(['once', '2 times', '3 times']));

describe('QuestionDetail', () => {
  const q: any = { n: 7, review: { evidence: 'It was founded in 1895.', why: 'The date is given.', wrong: { B: 'Not the founder.' }, paraphrase: [['established', 'founded']] } };
  const section: any = { part: 1, groups: [] };
  const mark = { n: 7, given: 'B', correct: false, answer: ['A'] };
  it('shows why, the note for your wrong pick, paraphrases and the evidence', () => {
    wrap(<QuestionDetail q={q} group={{} as any} section={section} mark={mark} />);
    expect(screen.getByText('The date is given.')).toBeTruthy();
    expect(screen.getByText('Not the founder.')).toBeTruthy();
    expect(screen.getByText('established')).toBeTruthy();
    expect(screen.getByText('founded')).toBeTruthy();
    expect(screen.getByText('It was founded in 1895.')).toBeTruthy();
  });
  it('leads with the verdict: what you wrote and the answer, or that it was left blank', () => {
    const { rerender } = wrap(<QuestionDetail q={q} group={{} as any} section={section} mark={mark} />);
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    rerender(<QueryClientProvider client={new QueryClient()}><QuestionDetail q={q} group={{} as any} section={section} mark={{ ...mark, given: '' }} /></QueryClientProvider>);
    expect(screen.getByText(/You left it blank/)).toBeTruthy();
  });
  it('shows the spelling label, correction and the misspelt-before note', () => {
    const entry: any = { n: 7, kind: 'spelling', label: 'Spelling slip', message: 'Learn it.', word: 'accommodation', typed: 'acommodation', before: 2 };
    wrap(<QuestionDetail q={{ n: 7 } as any} group={{} as any} section={section} mark={mark} entry={entry} />);
    expect(screen.getByText('Spelling slip')).toBeTruthy();
    expect(screen.getByText("You've misspelt 'accommodation' 2 times before.")).toBeTruthy();
  });
  it('Play from here and Dictation only for listening with timings; Dictation only when wrong', () => {
    const ls: any = { part: 1, audio: 'a.mp3', timings: [['It', 1, 1.2], ['was', 1.3, 1.5], ['founded', 1.6, 2], ['in', 2.1, 2.2], ['1895.', 2.3, 3]], groups: [] };
    const { rerender } = wrap(<QuestionDetail q={q} group={{} as any} section={ls} mark={mark} onPlay={() => {}} onDictate={() => {}} />);
    expect(screen.getByRole('button', { name: /Play from 0:00/ })).toBeTruthy();
    expect(screen.getByText(/Answer heard at 0:01/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Dictation/ })).toBeTruthy();
    rerender(<QueryClientProvider client={new QueryClient()}><QuestionDetail q={q} group={{} as any} section={ls} mark={{ ...mark, correct: true }} onPlay={() => {}} onDictate={() => {}} /></QueryClientProvider>);
    expect(screen.queryByRole('button', { name: /^Dictation/ })).toBeNull();
    rerender(<QueryClientProvider client={new QueryClient()}><QuestionDetail q={{ n: 7 } as any} group={{} as any} section={{ ...ls, timings: undefined }} mark={mark} onPlay={() => {}} onDictate={() => {}} /></QueryClientProvider>);
    expect(screen.queryByRole('button', { name: /Play from 0:00/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Dictation/ })).toBeNull();
  });
});

describe('DictationResult', () => {
  it('reports the score and marks each kind of slip', () => {
    render(<DictationResult typed="the tour start at six" expected="The tour starts at half past six" />);
    expect(screen.getByText('4 of 7 words right')).toBeTruthy();
    expect(screen.getAllByText(/\(missing\)/).length).toBe(2);
    expect(screen.getByText(/\(wrong\)/)).toBeTruthy();
  });
});

describe('TfngPanel', () => {
  const rows: any[] = [
    { n: 1, kind: 'tfng', answer: 'NOT GIVEN', chose: 'FALSE' },
    { n: 2, kind: 'tfng', answer: 'TRUE', chose: 'TRUE' },
  ];
  it('renders the confusion table, rules and the personal pattern', () => {
    render(<TfngPanel rows={rows} pattern={{ text: 'You turn NOT GIVEN into FALSE 60% of the time (3 of 5).' } as any} />);
    expect(screen.getByText(/You turn NOT GIVEN into FALSE 60%/)).toBeTruthy();
    const row = screen.getByRole('row', { name: /^NOT GIVEN/ });
    expect(row.textContent).toContain('1');
    expect(screen.getByText(/never settles it/)).toBeTruthy();
  });
  it('renders nothing without statement questions', () => expect(render(<TfngPanel rows={[]} />).container.textContent).toBe(''));
});

describe('PacingPanel', () => {
  const marks = new Map([[5, { correct: false }], [6, { correct: true }]]);
  it('shows time per part, changes, late answers (with wrong ones) and blanks', () => {
    render(<PacingPanel stats={{ partS: { '1': 2500, '2': 600 }, changes: { '5': 3, '2': 1 }, late: [5, 6] }} parts={[{ part: 1, questions: [] }, { part: 2, questions: [] }]} noun="Passage" totalS={3600} marks={marks} blank={[9]} />);
    expect(screen.getByText(/Passage 1/)).toBeTruthy();
    expect(screen.getByText(/over the suggested time/)).toBeTruthy();
    expect(screen.getByText(/Q5 \(3×\)/)).toBeTruthy();
    expect(screen.getByText(/1 of them wrong \(5\)/)).toBeTruthy();
    expect(screen.getByText(/9\. There is no penalty/)).toBeTruthy();
  });
  it('hides when nothing was measured', () => expect(render(<PacingPanel stats={{ partS: {}, changes: {}, late: [] }} parts={[]} noun="Part" marks={new Map()} blank={[]} />).container.textContent).toBe(''));
});

describe('evidence highlight', () => {
  it('marks the evidence span in a passage and a transcript', () => {
    const section: any = { part: 1, passage: { title: 'T', paragraphs: [{ text: 'One. The answer is here. Two.' }] }, groups: [] };
    const { container } = render(<Passage section={section} evidence={{ p: 0, s: 5, e: 24 }} />);
    expect(container.querySelector('[data-evidence]')?.textContent).toBe('The answer is here.');
    cleanup();
    const t = render(<Transcript text={'Line one\nSecond line here'} evidence={{ p: 1, s: 0, e: 6 }} />);
    expect(t.container.querySelector('[data-evidence]')?.textContent).toBe('Second');
    fireEvent.click(t.container.querySelector('[data-evidence]')!); // not removable, no crash
  });
});
