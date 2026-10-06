import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateWpm, pickMime, useRecorder } from './useRecorder';

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

  it('resets the recording clock and live hints before starting another part', async () => {
    vi.useFakeTimers();
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    class Recorder {
      static isTypeSupported() { return true; }
      state = 'inactive';
      mimeType = 'audio/webm';
      onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.onstop?.(); }
      pause() { this.state = 'paused'; }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    vi.stubGlobal('AudioContext', class {
      createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData: (b: Float32Array) => b.fill(0.1) }; }
      createMediaStreamSource() { return { connect() {} }; }
      close() { return Promise.resolve(); }
    });
    setMedia({ getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop() {} }] }) });
    const { result, unmount } = renderHook(() => useRecorder());
    try {
      await act(() => result.current.start());
      now = 130_000;
      act(() => vi.advanceTimersByTime(50));
      expect(result.current.elapsedMs).toBeGreaterThanOrEqual(130_000);
      await act(() => result.current.stop());
      await act(() => result.current.start({ paused: true }));
      expect(result.current.elapsedMs).toBe(0);
      expect(result.current.level).toBe(0);
      expect(result.current.liveWpm).toBe(0);
      expect(result.current.silenceMs).toBe(0);
      expect(result.current.clock()).toBe(0);
    } finally {
      unmount();
      clock.mockRestore();
      vi.useRealTimers();
    }
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

describe('pickMime', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const crios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
  const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  it('records mp4 on WebKit (Safari, every iOS browser) and opus/webm elsewhere', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    expect([pickMime(iphone), pickMime(crios), pickMime(chrome)]).toEqual(['audio/mp4', 'audio/mp4', 'audio/webm;codecs=opus']);
    vi.unstubAllGlobals();
  });
});
