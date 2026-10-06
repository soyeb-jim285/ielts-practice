import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from '@/lib/mock';
import { MockResult } from './MockResult';
import { SectionList } from './SectionList';
import { Transition } from './Transition';

afterEach(cleanup);

const sec = (skill: Mock['sections'][number]['skill'], state: Mock['sections'][number]['state'], band: number | null = null): Mock['sections'][number] => ({ skill, state, band, attemptId: null, sessionId: null, elapsedS: null, limitS: null, mode: null });
const mock = (over: Partial<Mock>): Mock => ({
  id: 'm1', variant: 'academic', source: 'generated', ref: null, status: 'in_progress', startedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-08T00:00:00Z', completedAt: null, next: 'reading', overall: null,
  sections: [sec('listening', 'done', 7), sec('reading', 'todo'), sec('writing', 'todo'), sec('speaking', 'todo')], ...over,
});

describe('Transition', () => {
  it('says what finished and what is next, with one Start button', () => {
    const onStart = vi.fn();
    render(<Transition mock={mock({})} onStart={onStart} busy={false} />);
    expect(screen.getByText('Listening finished.')).toBeTruthy();
    expect(screen.getByText(/Next: Reading, 60 minutes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start Reading' }));
    expect(onStart).toHaveBeenCalled();
  });
  it('offers Continue for a section already under way', () => {
    const m = mock({ sections: [sec('listening', 'done', 7), sec('reading', 'in_progress'), sec('writing', 'todo'), sec('speaking', 'todo')] });
    render(<Transition mock={m} onStart={vi.fn()} busy={false} />);
    expect(screen.getByRole('button', { name: 'Continue Reading' })).toBeTruthy();
  });
  it('renders nothing for the Speaking choice (its own card)', () => {
    const { container } = render(<Transition mock={mock({ next: 'speaking' })} onStart={vi.fn()} busy={false} />);
    expect(container.textContent).toBe('');
  });
});

describe('MockResult', () => {
  it('waits for all four bands', () => {
    render(<MockResult mock={mock({})} target={7} />);
    expect(screen.getByText(/Overall appears when all four sections are marked/)).toBeTruthy();
  });
  it('says marking is in the background while a section is being marked', () => {
    render(<MockResult mock={mock({ sections: [sec('listening', 'done', 7), sec('reading', 'done', 7), sec('writing', 'marking'), sec('speaking', 'todo')] })} target={7} />);
    expect(screen.getByText(/Marking takes about a minute/)).toBeTruthy();
  });
  it('a mock closed without Speaking has no overall', () => {
    render(<MockResult mock={mock({ status: 'closed', next: null })} target={7} />);
    expect(screen.getByText(/finished without Speaking/)).toBeTruthy();
  });
  it('shows the overall band', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} })); // reduced motion: no count-up
    render(<MockResult mock={mock({ status: 'completed', next: null, overall: 6.5 })} target={7} />);
    expect(screen.getByText(/Overall band/).parentElement!.textContent).toContain('6.5');
    expect(screen.getByText(/0.5 below/)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe('SectionList', () => {
  const Wrap = ({ children }: { children: React.ReactNode }) => children;
  it('shows a band per marked section and state text only where there is no band', () => {
    const m = mock({ sections: [sec('listening', 'done', 7.5), sec('reading', 'todo'), sec('writing', 'marking'), sec('speaking', 'todo')] });
    render(<Wrap><SectionList mock={m} target={7} /></Wrap>);
    expect(screen.getByText('7.5')).toBeTruthy();
    expect(screen.queryByText('Marked')).toBeNull();
    expect(screen.getByText('Not started')).toBeTruthy();
    expect(screen.getByText('Being marked')).toBeTruthy();
    expect(screen.getByText('Not taken yet')).toBeTruthy();
  });
});
