import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useElapsed } from './LiveStage';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('elapsed time stops while paused and resumes from where it left off', () => {
  const { result, rerender } = renderHook(({ running }) => useElapsed(running), { initialProps: { running: true } });
  act(() => void vi.advanceTimersByTime(3000));
  expect(result.current).toBe(3);
  rerender({ running: false });
  act(() => void vi.advanceTimersByTime(5000));
  expect(result.current).toBe(3);
  rerender({ running: true });
  act(() => void vi.advanceTimersByTime(2000));
  expect(result.current).toBe(5);
});
