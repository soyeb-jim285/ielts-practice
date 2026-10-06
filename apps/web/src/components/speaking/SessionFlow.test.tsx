import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Prompt } from '@server/routes/prompts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionFlow, toSegment } from './SessionFlow';

const mocks = vi.hoisted(() => ({ play: vi.fn(), start: vi.fn(), stop: vi.fn(), upload: vi.fn(), navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/components/layout/ExamShell', () => ({ ExamShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/lib/examiner', () => ({ playLine: mocks.play }));
vi.mock('@/lib/query', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('@/hooks/pendingRecordings', () => ({ savePending: async () => true, uploadPending: mocks.upload }));
vi.mock('@/hooks/useRecorder', async () => {
  const { useEffect, useState } = await import('react');
  return { useRecorder: () => {
    const [state, setState] = useState('idle');
    const [elapsedMs, setElapsedMs] = useState(0);
    useEffect(() => {
      if (state !== 'recording') return;
      const timer = setInterval(() => setElapsedMs((ms) => ms + 250), 250);
      return () => clearInterval(timer);
    }, [state]);
    return {
      state, elapsedMs, level: 0, liveWpm: 0, silenceMs: 0,
      clock: () => 1000, pause: vi.fn(), resume: vi.fn(),
      start: async () => { mocks.start(); setElapsedMs(0); setState('recording'); return true; },
      stop: async () => { mocks.stop(); setState('stopped'); return { blob: new Blob(['answer']), mime: 'audio/webm', durationMs: 1000, energy: [] }; },
    };
  } };
});

const prompt = (part: number, id: string, questions = ['First question?', 'Second question?']) => ({
  id, part, title: part === 2 ? 'Describe a teacher.' : id, body: '', topic: id, followUps: questions, bullets: ['who they are'],
  audio: { lead: { text: 'Introduction', url: `${id}-lead` }, questions: (part === 2 ? ['Describe a teacher.'] : questions).map((text, i) => ({ text, url: `${id}-${i}` })) },
}) as unknown as Prompt;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.play.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue('attempt');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };

it('moves through all topics, preparation, the long turn, Part 3 and results', async () => {
  render(<SessionFlow segments={[prompt(1, 'Home'), prompt(1, 'Work'), prompt(2, 'Teacher'), prompt(3, 'Education')].map(toSegment)} />);
  await click('Start recording');
  await click('Next question');
  await click('Continue to next topic');
  expect(mocks.start).toHaveBeenCalledTimes(1);
  await click('Start next topic');
  await act(async () => { vi.advanceTimersByTime(130_000); });
  await click('Next question');
  await click('Continue to Part 2');
  expect(mocks.play).not.toHaveBeenCalledWith('Teacher-lead', expect.anything());
  await click('Start 1-minute preparation');
  expect(screen.getByLabelText('Notes')).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(screen.getByText('Recording')).toBeTruthy();
  expect(mocks.start).toHaveBeenCalledTimes(3);
  await act(async () => { vi.advanceTimersByTime(119_000); });
  expect(mocks.stop).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Continue to Part 3' })).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(mocks.stop).toHaveBeenCalledTimes(3);
  expect(mocks.start).toHaveBeenCalledTimes(3);
  await click('Start Part 3');
  await click('Next question');
  await click('Finish test');
  expect(mocks.stop).toHaveBeenCalledTimes(4);
  expect(mocks.upload).toHaveBeenCalledTimes(4);
  expect(mocks.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/speaking/result/$attemptId' }));
});

it('does not use preparation time while the examiner introduces the single cue card', async () => {
  let resolve!: () => void;
  mocks.play.mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; }));
  render(<SessionFlow segments={[toSegment(prompt(2, 'Teacher'))]} />);
  expect(mocks.play).not.toHaveBeenCalled();
  await click('Start 1-minute preparation');
  await act(async () => { vi.advanceTimersByTime(90_000); });
  expect(mocks.start).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Notes')).toBeNull();
  await act(async () => { resolve(); });
  expect(mocks.play.mock.calls.map(([url]) => url)).toEqual(['Teacher-lead', 'Teacher-0']);
  expect(screen.getByLabelText('Notes')).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(59_000); });
  expect(mocks.start).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(mocks.start).toHaveBeenCalledTimes(1);
});

it('explains that finishing a Part 1 topic early does not skip the next topic', async () => {
  render(<SessionFlow segments={[prompt(1, 'Home'), prompt(1, 'Work'), prompt(2, 'Teacher')].map(toSegment)} />);
  await click('Start recording');
  await click('Finish topic early');
  expect(screen.getByText(/You will continue to the next topic in Part 1/)).toBeTruthy();
  await click('Continue to next topic');
  expect(screen.getByText('Work')).toBeTruthy();
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.stop).toHaveBeenCalledTimes(1);
});

it('lets the candidate start the long turn early without starting a second recording when preparation expires', async () => {
  const p = { ...prompt(2, 'Teacher'), audio: undefined };
  render(<SessionFlow segments={[toSegment(p)]} />);
  await click('Start 1-minute preparation');
  await act(async () => { vi.advanceTimersByTime(10_000); });
  await click('Start speaking now');
  expect(mocks.start).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(screen.getByText('Recording')).toBeTruthy();
});
