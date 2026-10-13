import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ANSWER_MS, OWE_MS, stalled, useDuplexExaminer, type Handlers } from './duplex';

const rec = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), examiner: vi.fn(), question: vi.fn(), output: vi.fn(), session: vi.fn(), finish: vi.fn(), level: 0 }));
vi.mock('./turn', async (original) => ({ ...await original<typeof import('./turn')>(), usePartRecorder: () => rec }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), api: { post: vi.fn().mockResolvedValue({ sessionId: 's', test: { part2: { title: 'Topic' } } }) } }));

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); rec.start.mockResolvedValue(undefined); rec.stop.mockResolvedValue(undefined); rec.finish.mockResolvedValue([]); });
afterEach(() => vi.useRealTimers());

const NUDGES = ['continue', 'repeat'];
/** `silent`: the examiner never answers anything. Otherwise it answers the stall watchdog's nudges with a question. */
async function setup(silent = false) {
  let h!: Handlers;
  const cue = vi.fn((_t: string, _heard?: boolean, key?: string) => {
    if (!silent && NUDGES.includes(key!)) (h.speaking(true), h.caption('And why is that?'), h.speaking(false));
  });
  const transport = { connect: vi.fn(async (handlers: Handlers) => { h = handlers; }), cue, listen: vi.fn(), close: vi.fn() };
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

it('an examiner that never answers a finished answer is nudged to continue (keeping the answer), then counts as lost', async () => {
  const { result, h, transport, unmount } = await setup(true);
  act(() => { h.speaking(true); h.caption('Do you work or are you a student?'); h.speaking(false); h.pending?.(true); });
  act(() => vi.advanceTimersByTime(60_000)); // a long answer: no nudge while the candidate talks
  expect(transport.cue).not.toHaveBeenCalled();
  act(() => h.pending?.(false));
  act(() => vi.advanceTimersByTime(OWE_MS + 1000));
  expect(transport.cue.mock.calls.map((c) => [c[1], c[2]])).toEqual([[true, 'continue']]);
  expect(transport.cue.mock.calls[0]![0]).toMatch(/the introduction/);
  act(() => vi.advanceTimersByTime(3 * (OWE_MS + 1000)));
  expect(result.current.status).toBe('error');
  expect(result.current.retryLabel).toBe('Score what I recorded');
  unmount();
});

it('the examiner ending a turn on an announcement is nudged; a question with no answer is repeated once, never while the candidate talks', async () => {
  const { result, h, transport, unmount } = await setup(true);
  act(() => { h.speaking(true); h.speaking(false); h.answered(); }); // Part 1
  act(() => { h.speaking(true); h.caption("Thank you. Now let's move on to the next part."); h.speaking(false); });
  act(() => vi.advanceTimersByTime(OWE_MS + 1000));
  expect(transport.cue.mock.calls.at(-1)![2]).toBe('continue');
  expect(transport.cue.mock.calls.at(-1)![0]).toMatch(/Part 1.*do not move to another part/);
  act(() => { h.speaking(true); h.caption('What do you like about it?'); h.speaking(false); });
  act(() => vi.advanceTimersByTime(ANSWER_MS - 2000));
  expect(transport.cue).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(3000));
  expect(transport.cue.mock.calls.at(-1)![2]).toBe('repeat');
  expect(result.current.status).toBe('thinking');
  unmount();
});

it('stalled() decides who owes the next turn', () => {
  const base = { phase: 'p3' as const, examinerOn: false, talking: false, line: 'Why do you think that is?', examinerEnd: 0, candidateAt: 0, now: 0 };
  expect(stalled({ ...base, now: ANSWER_MS - 1 })).toBeNull();
  expect(stalled({ ...base, now: ANSWER_MS })).toBe('repeat');
  expect(stalled({ ...base, line: 'Thank you for explaining that.', now: OWE_MS })).toBe('continue');
  expect(stalled({ ...base, line: 'He asked, "Why not?"', now: OWE_MS })).toBeNull();
  expect(stalled({ ...base, candidateAt: 1000, now: 1000 + OWE_MS })).toBe('continue');
  expect(stalled({ ...base, candidateAt: 1000, talking: true, now: 60_000 })).toBeNull();
  expect(stalled({ ...base, candidateAt: 1000, talking: true, now: 100_000 })).toBe('continue'); // a stuck voice detector
  expect(stalled({ ...base, examinerOn: true, now: 99_999 })).toBeNull();
  expect(stalled({ ...base, phase: 'p2-talk', now: 99_999 })).toBeNull();
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

it('the examiner closing the test on its own during Part 3 ends it, without waiting for the Part 3 timer', async () => {
  const { result, h, unmount } = await setup();
  act(() => { h.speaking(true); h.speaking(false); h.answered(); }); // intro answered: Part 1
  await act(async () => vi.advanceTimersByTime(270_000)); // Part 1 time: Part 2 prep
  act(() => { h.speaking(true); h.speaking(false); });
  await act(async () => vi.advanceTimersByTime(60_000)); // prep over: the talk
  act(() => { h.speaking(true); h.speaking(false); });
  await act(async () => vi.advanceTimersByTime(120_000)); // talk over: rounding-off question
  act(() => { h.speaking(true); h.speaking(false); h.answered(); }); // answered: Part 3
  expect(result.current.phase).toBe('p3');
  expect(rec.finish).not.toHaveBeenCalled();
  await act(async () => { h.speaking(true); h.caption('Thank you. That is the end of the speaking'); h.caption(' test.', true); });
  expect(rec.finish).not.toHaveBeenCalled(); // still talking
  await act(async () => h.speaking(false));
  expect(rec.finish).toHaveBeenCalledTimes(1);
  unmount();
});

it('the examiner moving to Part 2 on its own shows the cue card and starts the prep minute when it stops talking, without a cue', async () => {
  const { result, h, transport, unmount } = await setup();
  act(() => { h.speaking(true); h.speaking(false); h.answered(); }); // intro answered: Part 1
  await act(async () => vi.advanceTimersByTime(60_000)); // well before the 4.5-minute Part 1 timer
  await act(async () => { h.speaking(true); h.caption("Thank you. Now, I'm going to give you a topic, and I'd like you to talk about it"); });
  expect(result.current.phase).toBe('p2-prep');
  expect(result.current.cueCard).toEqual({ title: 'Topic' });
  expect(transport.listen).toHaveBeenCalledWith(false);
  expect(transport.cue.mock.calls.filter((c) => !NUDGES.includes(c[2]!))).toEqual([]);
  expect(result.current.prepLeft).toBe(60);
  act(() => { vi.advanceTimersByTime(10_000); h.speaking(false); }); // prep starts once the instructions end
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(result.current.phase).toBe('p2-talk');
  await act(async () => vi.advanceTimersByTime(270_000)); // the old Part 1 timer must not fire a second Part 2
  expect(transport.cue.mock.calls.map((c) => c[2]).filter((k) => !NUDGES.includes(k!))).toEqual(['talk']);
  unmount();
});

it('record: false (playground) runs the script without recording parts, and debug taps see transport events before the examiner does', async () => {
  let h!: Handlers;
  const seen: string[] = [];
  const cue = vi.fn((_t: string, _heard?: boolean, key?: string) => void (NUDGES.includes(key!) && (h.speaking(true), h.speaking(false))));
  const transport = { connect: vi.fn(async (handlers: Handlers) => { h = handlers; }), cue, listen: vi.fn(), close: vi.fn() };
  const { result, unmount } = renderHook(() => useDuplexExaminer(() => transport, vi.fn(), undefined, undefined, undefined, { record: false, debug: { heard: (t) => seen.push(`heard ${t}`), speaking: (on) => seen.push(`speaking ${on}`) } }));
  await act(() => result.current.start());
  act(() => { h.speaking(true); h.speaking(false); h.heard?.('My name is Jim'); h.answered(); });
  expect(result.current.phase).toBe('p1');
  expect(seen).toEqual(['speaking true', 'speaking false', 'heard My name is Jim']);
  await act(async () => vi.advanceTimersByTime(270_000));
  expect(result.current.phase).toBe('p2-prep');
  expect(rec.start).not.toHaveBeenCalled();
  expect(rec.stop).not.toHaveBeenCalled();
  unmount();
});
