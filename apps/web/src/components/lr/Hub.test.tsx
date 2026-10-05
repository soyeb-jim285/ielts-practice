import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Schemas } from '@/lib/api';
import { groups, StartDialog } from './Hub';

afterEach(cleanup);
// jsdom has no ResizeObserver (Segmented measures its thumb)
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const base: Schemas['LrTestListItem'] = { id: 't1', slug: 's', skill: 'reading', variant: 'academic', source: 'generated', ref: 'G1', title: 'Reading 1', total: 13, status: 'in_progress', attemptId: 'a1', mode: 'exam', parts: [2], answered: 4, bestBand: null, attempts: 0 };
const props = () => ({ onClose: vi.fn(), onStart: vi.fn(), onContinue: vi.fn(), busy: false, error: false });

describe('StartDialog', () => {
  it('an unfinished attempt offers Continue, which resumes it', () => {
    const p = props();
    render(<StartDialog test={base} {...p} />);
    expect(screen.getByText(/unfinished exam attempt \(passage 2, 4 of 13 answered\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(p.onContinue).toHaveBeenCalledWith('a1');
  });
  it('Start new picks mode and a single part, and warns the old attempt goes', () => {
    const p = props();
    render(<StartDialog test={base} {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    expect(screen.getByText('Your unfinished attempt will be discarded.')).toBeTruthy();
    expect(screen.getByText(/60-minute countdown/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '3' }));
    expect(screen.getByText(/20-minute countdown/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Practice/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start practice passage 3' }));
    expect(p.onStart).toHaveBeenCalledWith('practice', [3]);
  });
  it('without an unfinished attempt it goes straight to the choice; All = the whole test', () => {
    const p = props();
    render(<StartDialog test={{ ...base, skill: 'listening', status: 'new', attemptId: null, mode: null, parts: null }} {...p} />);
    expect(screen.queryByText(/discarded/)).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2 + 5);
    fireEvent.click(screen.getByRole('button', { name: 'Start exam test' }));
    expect(p.onStart).toHaveBeenCalledWith('exam', null);
  });
});

describe('groups', () => {
  it('sorts own tests naturally: Test 9 before Test 10', () => {
    const t = (title: string) => ({ ...base, id: title, title });
    expect(groups([t('Reading 10'), t('Reading 9'), t('Reading 1')])[0]!.tests.map((x) => x.title)).toEqual(['Reading 1', 'Reading 9', 'Reading 10']);
  });
});
