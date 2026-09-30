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
  it('counts energy peaks over the last 10 s', () => {
    // 10 s of frames with a peak every 5 frames (4 syllables/s) → 40 peaks → ~160 wpm
    const e = Array.from({ length: 200 }, (_, i) => (i % 5 === 2 ? 120 : 20));
    expect(estimateWpm(e)).toBe(160);
    expect(estimateWpm(new Array(200).fill(10))).toBe(0);
  });
});
