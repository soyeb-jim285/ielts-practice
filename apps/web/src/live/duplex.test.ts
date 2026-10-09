import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDuplexExaminer, type Handlers } from './duplex';

const rec = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), examiner: vi.fn(), output: vi.fn(), session: vi.fn(), finish: vi.fn(), level: 0 }));
vi.mock('./turn', async (original) => ({ ...await original<typeof import('./turn')>(), usePartRecorder: () => rec }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), api: { post: vi.fn().mockResolvedValue({ sessionId: 's', test: { part2: { title: 'Topic' } } }) } }));

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); rec.start.mockResolvedValue(undefined); rec.stop.mockResolvedValue(undefined); rec.finish.mockResolvedValue([]); });
afterEach(() => vi.useRealTimers());

async function setup() {
  let h!: Handlers;
  const transport = { connect: vi.fn(async (handlers: Handlers) => { h = handlers; }), cue: vi.fn(), listen: vi.fn(), close: vi.fn() };
  const hook = renderHook(() => useDuplexExaminer(() => transport, vi.fn()));
  await act(() => hook.result.current.start());
  return { ...hook, h, transport };
}

it('a connected but silent examiner leaves thinking within a bounded wait', async () => {
  const { result, unmount } = await setup();
  act(() => vi.advanceTimersByTime(46_000));
  expect(result.current.status).toBe('error');
  expect(result.current.retry).toBeTypeOf('function');
  unmount();
});

it('candidate activity resets the reply deadline, but a missing reply eventually offers scoring', async () => {
  const { result, h, unmount } = await setup();
  act(() => { h.speaking(true); h.speaking(false); h.pending?.(); });
  act(() => vi.advanceTimersByTime(40_000));
  act(() => h.pending?.());
  act(() => vi.advanceTimersByTime(40_000));
  expect(result.current.status).toBe('candidate');
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current.status).toBe('error');
  expect(result.current.retryLabel).toBe('Score what I recorded');
  unmount();
});

it('Part 2 gets a full prep minute and two-minute talk after the cue lines finish', async () => {
  const { result, h, unmount } = await setup();
  act(() => { h.speaking(true); h.speaking(false); h.answered(); });
  await act(async () => vi.advanceTimersByTime(270_000));
  expect(result.current.phase).toBe('p2-prep');
  act(() => { h.speaking(true); vi.advanceTimersByTime(10_000); h.speaking(false); });
  expect(result.current.prepLeft).toBe(60);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(result.current.phase).toBe('p2-talk');
  act(() => { h.speaking(true); vi.advanceTimersByTime(10_000); h.speaking(false); });
  expect(result.current.talkLeft).toBe(120);
  expect(result.current.talkRunning).toBe(true);
  await act(async () => vi.advanceTimersByTime(120_000));
  expect(result.current.phase).toBe('p2-follow');
  unmount();
});

it('a missing cue response recovers to waiting and then candidate instead of remaining thinking', async () => {
  const { result, h, unmount } = await setup();
  act(() => { h.speaking(true); h.speaking(false); h.answered(); });
  await act(async () => vi.advanceTimersByTime(270_000));
  act(() => vi.advanceTimersByTime(45_000));
  expect(result.current.status).toBe('waiting');
  await act(async () => vi.advanceTimersByTime(60_000));
  act(() => vi.advanceTimersByTime(45_000));
  expect(result.current.status).toBe('candidate');
  expect(result.current.talkRunning).toBe(true);
  unmount();
});
