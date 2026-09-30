import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateWpm, useRecorder } from './useRecorder';

const setMedia = (mediaDevices: unknown) => Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true });

describe('useRecorder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setMedia(undefined);
  });

  it('reports a blocked microphone without any network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('MediaRecorder', class {});
    setMedia({ getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) });
    const { result } = renderHook(() => useRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('denied');
    expect(result.current.error).toMatch(/Microphone blocked/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports a missing input device', async () => {
    vi.stubGlobal('MediaRecorder', class {});
    setMedia({ getUserMedia: vi.fn().mockRejectedValue(new DOMException('none', 'NotFoundError')) });
    const { result } = renderHook(() => useRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('unsupported');
    expect(result.current.error).toMatch(/No microphone found/);
  });

  it('reports an unsupported browser', async () => {
    setMedia(undefined);
    const { result } = renderHook(() => useRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('unsupported');
  });
});

describe('estimateWpm', () => {
  it('turns energy peaks in the last 10 s into words/min', () => {
    // 10 s of speech-like bursts (3 voiced frames in 5, one peak each) → 40 peaks / 1.1 per word × 6 → 218 wpm
    const e = Array.from({ length: 200 }, (_, i) => [20, 90, 120, 90, 20][i % 5]!);
    expect(estimateWpm(e)).toBe(218);
    expect(estimateWpm(new Array(200).fill(10))).toBe(0);
  });

  it('ignores a periodic beep with too few voiced frames to be speech', () => {
    const beep = Array.from({ length: 200 }, (_, i) => (i % 10 === 1 ? 145 : 10));
    expect(estimateWpm(beep)).toBe(0);
  });
});
