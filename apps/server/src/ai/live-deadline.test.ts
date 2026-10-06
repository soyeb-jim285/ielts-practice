import { afterEach, expect, it, vi } from 'vitest';
import { liveDeadline } from './live-deadline';

afterEach(() => vi.useRealTimers());

it('bounds an upstream promise that never settles', async () => {
  vi.useFakeTimers();
  const result = liveDeadline(new Promise(() => {}), 12_000);
  const rejected = expect(result).rejects.toMatchObject({ code: 'timeout' });
  await vi.advanceTimersByTimeAsync(12_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it('clears the watchdog for successful operations', async () => {
  vi.useFakeTimers();
  expect(await liveDeadline(Promise.resolve('ok'), 15_000)).toBe('ok');
  expect(vi.getTimerCount()).toBe(0);
});
