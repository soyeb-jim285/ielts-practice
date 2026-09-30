import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVad, useVad } from './useVad';

/** Feeds 50 ms frames: [level, durationMs] segments. Returns the times a turn ended. */
function run(segments: [number, number][]) {
  const vad = createVad();
  const ends: number[] = [];
  let t = 0;
  for (const [level, ms] of segments)
    for (let i = 0; i < ms; i += 50, t += 50) if (vad.push(level, t)) ends.push(t);
  return ends;
}

describe('createVad', () => {
  it('ends one turn after 0.3 s of speech and 1.3 s of silence', () => {
    expect(run([[0, 500], [0.6, 300], [0.02, 1300]])).toHaveLength(1);
  });

  it('ignores blips shorter than 150 ms and short pauses', () => {
    expect(run([[0.6, 100], [0, 2000]])).toHaveLength(0);
    expect(run([[0.6, 400], [0, 800], [0.6, 400], [0, 1000]])).toHaveLength(0);
  });

  it('ends a second turn only after new speech', () => {
    expect(run([[0.6, 300], [0, 3000], [0.6, 300], [0, 1300]])).toHaveLength(2);
  });
});

describe('useVad', () => {
  afterEach(() => vi.useRealTimers());

  it('calls onTurnEnd once while active', () => {
    vi.useFakeTimers();
    const onTurnEnd = vi.fn();
    const { rerender } = renderHook(({ level }) => useVad(level, { active: true, onTurnEnd }), { initialProps: { level: 0.6 } });
    vi.advanceTimersByTime(300);
    rerender({ level: 0 });
    vi.advanceTimersByTime(1300);
    expect(onTurnEnd).toHaveBeenCalledTimes(1);
  });
});
