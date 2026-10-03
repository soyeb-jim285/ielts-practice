import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Navigator, type NavPart } from './Navigator';

afterEach(cleanup);
const parts: NavPart[] = [
  { part: 1, label: 'Part 1', questions: [1, 2, 3] },
  { part: 2, label: 'Part 2', questions: [4, 5, 6] },
];

describe('Navigator', () => {
  const props = { parts, isAnswered: (n: number) => n === 1 || n === 5, flagged: new Set([2]), current: 2, onJump: vi.fn(), onPart: vi.fn() };
  it('opens the current part and folds the others into a count chip', () => {
    render(<Navigator {...props} />);
    expect(screen.getAllByRole('button', { name: /^Question/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Part 2, 1 of 3 answered' }));
    expect(props.onPart).toHaveBeenCalledWith(2);
  });
  it('exposes answered, flagged and current state', () => {
    render(<Navigator {...props} />);
    expect(screen.getByRole('button', { name: 'Question 1, answered' })).toBeTruthy();
    const q2 = screen.getByRole('button', { name: 'Question 2, not answered, flagged for review' });
    expect(q2.getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: 'Question 3, not answered' }));
    expect(props.onJump).toHaveBeenCalledWith(3);
  });
  it('full variant lists every question', () => {
    render(<Navigator {...props} variant="full" />);
    expect(screen.getAllByRole('button', { name: /^Question/ })).toHaveLength(6);
  });
});
