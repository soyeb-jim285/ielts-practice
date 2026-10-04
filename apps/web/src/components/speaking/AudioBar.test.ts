import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAudio } from './AudioBar';

/** Just enough of an <audio> element: a settable clock, play/pause with their events. */
function fakeAudio() {
  const el = Object.assign(new EventTarget(), {
    currentTime: 0,
    paused: true,
    play: vi.fn(async () => {
      if (el.paused) (el.paused = false), el.dispatchEvent(new Event('play'));
    }),
    pause: vi.fn(() => {
      if (!el.paused) (el.paused = true), el.dispatchEvent(new Event('pause'));
    }),
  });
  return el;
}

function setup() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const el = fakeAudio();
  const h = renderHook(() => useAudio());
  act(() => h.result.current.ref(el as unknown as HTMLAudioElement));
  const tick = (t: number) => {
    el.currentTime = t;
    act(() => frames.splice(0).forEach((f) => f(0)));
  };
  return { el, h, tick };
}

describe('useAudio clip stop', () => {
  it('stops a clip at its end', () => {
    const { el, h, tick } = setup();
    act(() => h.result.current.controls.seek(5.3, 8));
    tick(7);
    expect(el.paused).toBe(false);
    tick(8.01);
    expect(el.paused).toBe(true);
  });

  it('forgets the stop point once the clip is paused, so later playback is not cut', () => {
    const { el, h, tick } = setup();
    act(() => h.result.current.controls.seek(5.3, 8));
    tick(6);
    act(() => el.pause()); // the bar's pause button
    act(() => void el.play()); // ...then play again
    tick(9);
    expect(el.paused).toBe(false);
  });

  it('forgets the stop point when the playhead is moved past it', () => {
    const { el, h, tick } = setup();
    act(() => h.result.current.controls.seek(5.3, 8));
    el.currentTime = 30; // the scrubber
    act(() => void el.dispatchEvent(new Event('seeking')));
    tick(30.5);
    expect(el.paused).toBe(false);
  });
});
