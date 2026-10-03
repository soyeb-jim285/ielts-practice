import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LrGroup } from '@/lib/lr';
import { QuestionGroup } from './QuestionGroup';

afterEach(cleanup);
const opts = (o: Record<string, string>) => Object.entries(o).map(([key, text]) => ({ key, text }));
const base = { instructions: 'Questions 1-3. Do the thing.' };
const setup = (group: LrGroup, responses: Record<string, string> = {}) => {
  const onChange = vi.fn();
  render(<QuestionGroup group={group} responses={responses} onChange={onChange} assets={{ 'map.svg': '/map.svg' }} />);
  return onChange;
};

describe('gap', () => {
  const g: LrGroup = { ...base, from: 1, to: 2, type: 'gap', wordLimit: 'ONE WORD ONLY', content: '| Item | Detail |\n|---|---|\n| Name | {{1}} |\n| Day | {{2}} evenings |', questions: [{ n: 1 }, { n: 2 }] };
  it('renders inputs inside the table with a word-limit hint and reports typing', () => {
    const onChange = setup(g, { '2': 'Thursday' });
    expect(screen.getByText('Write ONE WORD ONLY.')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    const q1 = screen.getByLabelText(/^Question 1/) as HTMLInputElement;
    fireEvent.change(q1, { target: { value: 'Smith' } });
    expect(onChange).toHaveBeenCalledWith({ '2': 'Thursday', '1': 'Smith' });
    expect((screen.getByLabelText(/^Question 2/) as HTMLInputElement).value).toBe('Thursday');
  });
  it('Enter does not submit anything', () => {
    setup(g);
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    screen.getByLabelText(/^Question 1/).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
  it('sizes the input to its content', () => {
    setup(g, { '1': 'extraordinarily' });
    expect((screen.getByLabelText(/^Question 1/) as HTMLInputElement).style.width).toBe('18ch');
  });
});

describe('mcq', () => {
  const g: LrGroup = { ...base, from: 1, to: 1, type: 'mcq', questions: [{ n: 1, text: 'Pick one', options: opts({ A: 'one', B: 'two', C: 'three' }) }] };
  it('selects an option and clears on second click', () => {
    const onChange = setup(g);
    fireEvent.click(screen.getByLabelText(/two/));
    expect(onChange).toHaveBeenCalledWith({ '1': 'B' });
  });
  it('clicking the chosen option clears it', () => {
    const onChange = setup(g, { '1': 'B' });
    fireEvent.click(screen.getByLabelText(/two/));
    expect(onChange).toHaveBeenCalledWith({});
  });
});

describe('mcq-multi', () => {
  const g: LrGroup = { ...base, from: 1, to: 2, type: 'mcq-multi', options: opts({ A: 'a', B: 'b', C: 'c' }), questions: [{ n: 1, text: 'Choose TWO' }, { n: 2 }] };
  it('stores picks across the slots and enforces the maximum', () => {
    const onChange = setup(g, { '1': 'A', '2': 'B' });
    expect((screen.getByLabelText(/^Cc$/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('2 of 2 selected');
    fireEvent.click(screen.getByLabelText(/^Aa$/));
    expect(onChange).toHaveBeenCalledWith({ '1': 'B' });
  });
  it('adds a pick into the first free slot', () => {
    const onChange = setup(g, { '1': 'A' });
    fireEvent.click(screen.getByLabelText(/^Cc$/));
    expect(onChange).toHaveBeenCalledWith({ '1': 'A', '2': 'C' });
  });
});

describe('tfng / ynng', () => {
  it('offers the three TRUE/FALSE/NOT GIVEN options', () => {
    const onChange = setup({ ...base, from: 1, to: 1, type: 'tfng', questions: [{ n: 1, text: 'Statement' }] });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    fireEvent.click(screen.getByLabelText('Not given'));
    expect(onChange).toHaveBeenCalledWith({ '1': 'NOT GIVEN' });
  });
  it('uses YES/NO for ynng', () => {
    setup({ ...base, from: 1, to: 1, type: 'ynng', questions: [{ n: 1, text: 'Statement' }] });
    expect(screen.getByLabelText('Yes')).toBeTruthy();
  });
});

describe('match', () => {
  const g: LrGroup = { ...base, from: 1, to: 2, type: 'match', options: opts({ i: 'First heading', ii: 'Second heading' }), questions: [{ n: 1, text: 'Paragraph A' }, { n: 2, text: 'Paragraph B' }] };
  it('lists the options once and gives each item a select', () => {
    const onChange = setup(g);
    expect(screen.getAllByText('First heading')).toHaveLength(1);
    expect(screen.getByText('List of headings')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Question 2'), { target: { value: 'i' } });
    expect(onChange).toHaveBeenCalledWith({ '2': 'i' });
  });
  it('shows the figure for image groups and no list when options are bare letters', () => {
    setup({ ...g, image: 'map.svg', options: opts({ A: '', B: '' }) });
    expect(screen.getByRole('img').getAttribute('src')).toBe('/map.svg');
    expect(screen.queryByText('Options')).toBeNull();
  });
});

describe('word box', () => {
  const g: LrGroup = { ...base, from: 1, to: 2, type: 'gap', content: 'Teens need more {{1}} and fewer {{2}}.', options: opts({ A: 'sleep', B: 'homework' }), questions: [{ n: 1 }, { n: 2 }] };
  it('shows the box and a select per gap', () => {
    const onChange = setup(g);
    expect(screen.getByText('Word box')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Question 1'), { target: { value: 'A' } });
    expect(onChange).toHaveBeenCalledWith({ '1': 'A' });
  });
});

describe('review', () => {
  it('marks wrong answers and shows the expected one', () => {
    const g: LrGroup = { ...base, from: 1, to: 1, type: 'gap', questions: [{ n: 1, text: 'The {{1}} is red.' }] };
    render(<QuestionGroup group={g} responses={{ '1': 'blue' }} onChange={() => {}} review={new Map([[1, { n: 1, given: 'blue', correct: false, answer: ['red'] }]])} />);
    expect((screen.getByLabelText(/^Question 1/) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText('red')).toBeTruthy();
  });
});
