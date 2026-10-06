import { act, renderHook } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useTurnExaminer, type ExaminerLine } from './turn';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));
vi.mock('@/hooks/useVad', () => ({ useVad: () => {} }));
vi.mock('@/hooks/useRecorder', () => ({ useRecorder: () => {
  const [state, setState] = useState('idle');
  const start = useCallback(async () => { setState('recording'); return true; }, []);
  const stop = useCallback(async () => { setState('stopped'); return { blob: new Blob(), mime: 'audio/webm', durationMs: 120_000, energy: [] }; }, []);
  return { state, start, stop, level: 0 };
} }));

let audio: { onended?: () => void };
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('Audio', class {
    onended?: () => void;
    constructor() { audio = this; }
    play() { return Promise.resolve(); }
    pause() {}
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const line = (phase: ExaminerLine['phase'], audioUrl: string | null = null): ExaminerLine => ({ phase, examinerText: phase, audioUrl });

it('runs intro, Part 1, full prep, full talk, follow-up, Part 3 and closing in order', async () => {
  const lines = [line('p1'), { ...line('p2-prep', '/prep.mp3'), cueCard: { title: 'Topic' }, prepSeconds: 60 }, line('p2-talk'), line('p2-follow'), line('p3'), line('done')];
  vi.mocked(api.post).mockImplementation(async (path) => path === '/live/start' ? { ...line('intro'), sessionId: 's' } : lines.shift());
  const finished = vi.fn();
  const { result, unmount } = renderHook(() => useTurnExaminer(finished));
  await act(() => result.current.start());
  expect(result.current.phase).toBe('intro');
  await act(async () => result.current.endTurn?.());
  expect(result.current.phase).toBe('p1');
  await act(async () => result.current.endTurn?.());
  expect(result.current.phase).toBe('p2-prep');
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.prepLeft).toBe(60);
  await act(async () => audio.onended?.());
  expect(result.current.status).toBe('waiting');
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(result.current.phase).toBe('p2-talk');
  expect(result.current.talkLeft).toBe(120);
  expect(result.current.talkRunning).toBe(true);
  await act(async () => vi.advanceTimersByTime(119_000));
  expect(result.current.phase).toBe('p2-talk');
  await act(async () => vi.advanceTimersByTime(1000));
  expect(result.current.phase).toBe('p2-follow');
  await act(async () => result.current.endTurn?.());
  expect(result.current.phase).toBe('p3');
  await act(async () => result.current.endTurn?.());
  expect(finished).toHaveBeenCalledWith('s', []);
  unmount();
});

it('a stalled turn request leaves thinking and exposes a retry', async () => {
  vi.mocked(api.post).mockImplementation((path) => path === '/live/start' ? Promise.resolve({ ...line('intro'), sessionId: 's' }) : new Promise(() => {}));
  const { result, unmount } = renderHook(() => useTurnExaminer(vi.fn()));
  await act(() => result.current.start());
  await act(async () => result.current.endTurn?.());
  expect(result.current.status).toBe('thinking');
  await act(async () => vi.advanceTimersByTime(90_000));
  expect(result.current.status).toBe('error');
  expect(result.current.retry).toBeTypeOf('function');
  unmount();
});

it('examiner audio that never ends falls back to captions and opens the mic', async () => {
  vi.mocked(api.post).mockResolvedValue({ ...line('intro', '/stalled.mp3'), sessionId: 's' });
  const { result, unmount } = renderHook(() => useTurnExaminer(vi.fn()));
  let started!: Promise<void>;
  act(() => { started = result.current.start(); });
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(30_000); await started; });
  expect(result.current.status).toBe('candidate');
  unmount();
});
