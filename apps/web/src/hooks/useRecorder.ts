import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'requesting' | 'denied' | 'unsupported' | 'recording' | 'stopped';
export type Recording = { blob: Blob; mime: string; durationMs: number; energy: number[] };

const FRAME_MS = 50;
const VOICE = 60; // byte threshold for "speaking"; matches core computeSpeechMetrics voiceThreshold
// ponytail: fixed gain maps typical speech RMS (0.05–0.2) to ~60–115; expose a calibration setting if quiet mics read as silence.
const GAIN = 255;

/** WebKit = Safari and every iOS browser (CriOS/FxiOS are WebKit too); Chromium and Gecko are not. */
export const isWebKit = (ua = globalThis.navigator?.userAgent ?? '') => /AppleWebKit/.test(ua) && !/Chrome\/|Chromium|Edg\/|Android/.test(ua);

/** First supported of opus/webm, mp4, plain webm; '' lets the browser choose. WebKit gets mp4 (AAC) first: its own WebM (2.5 ms Opus frames,
 *  no cues) plays back in WebKit with the sound dropping out mid-file while the clock runs on, until a seek. */
export function pickMime(ua?: string): string {
  const MR = globalThis.MediaRecorder;
  if (!MR?.isTypeSupported) return '';
  const order = isWebKit(ua) ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'] : ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
  return order.find((t) => MR.isTypeSupported(t)) ?? '';
}

// ponytail: calibrated in Chrome against Whisper speech rate on TTS answers (176/186 wpm → 3.4/3.2 peaks/s); peaks merge syllables, so ~1.1 per word.
const PEAKS_PER_WORD = 1.1;
/** Below this share of voiced frames the window is a tone or noise, not speech (Chrome's fake-mic beep: 0.10; halting speech: ≥ 0.28). */
const MIN_VOICED = 0.2;

/** Energy peaks in the last 10 s → words/min on the same scale as core speechRate; 0 = no confident speech yet. ponytail: a pacing hint, not a measurement. */
export function estimateWpm(energy: number[]): number {
  const win = energy.slice(-200);
  if (win.length < 40 || win.filter((e) => e >= VOICE).length < win.length * MIN_VOICED) return 0;
  let peaks = 0;
  let last = -10;
  for (let i = 1; i < win.length - 1; i++) {
    const e = win[i]!;
    if (e >= VOICE && e > win[i - 1]! && e >= win[i + 1]! && i - last >= 3) {
      peaks++;
      last = i;
    }
  }
  return Math.round((peaks / PEAKS_PER_WORD) * (60_000 / (win.length * FRAME_MS)));
}

const MESSAGES = {
  denied: "Microphone blocked — allow it in the browser's site settings and retry",
  noDevice: 'No microphone found — connect one (or check your system sound settings) and retry',
  unsupported: "This browser can't record audio. Try a recent Chrome, Edge, Firefox or Safari.",
};

/**
 * Microphone recorder with a 50 ms RMS energy timeline (bytes 0–255), live level, pace and silence.
 * Nothing leaves the browser: callers upload the blob returned by stop().
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string>();
  const [live, setLive] = useState({ level: 0, elapsedMs: 0, liveWpm: 0, silenceMs: 0 });
  const [paused, setPaused] = useState(false);
  const r = useRef<{ stream?: MediaStream; rec?: MediaRecorder; ctx?: AudioContext; timer?: ReturnType<typeof setInterval>; chunks: Blob[]; energy: number[]; t0: number; mime: string; pausedAt?: number; silent: number }>({
    chunks: [],
    energy: [],
    t0: 0,
    mime: '',
    silent: 0,
  });
  /** The recording clock in ms: time while paused does not count, so it matches the audio and the energy frames. */
  const clock = useCallback(() => (r.current.pausedAt ?? performance.now()) - r.current.t0, []);

  const teardown = useCallback(() => {
    const c = r.current;
    clearInterval(c.timer);
    c.stream?.getTracks().forEach((t) => t.stop());
    void c.ctx?.close().catch(() => {});
    c.stream = c.ctx = c.timer = undefined;
  }, []);
  useEffect(() => teardown, [teardown]);

  /** `paused`: open the mic and the recorder but hold the clock until resume() (the examiner is still asking). Resolves true when recording started. */
  const start = useCallback(async (opts?: { paused?: boolean }) => {
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      setState('unsupported');
      setError(MESSAGES.unsupported);
      return false;
    }
    setState('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = (e as DOMException)?.name;
      const noDevice = name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError';
      setState(noDevice ? 'unsupported' : 'denied');
      setError(noDevice ? MESSAGES.noDevice : MESSAGES.denied);
      return false;
    }
    const c = r.current;
    c.stream = stream;
    c.mime = pickMime();
    c.chunks = [];
    c.energy = [];
    const rec = new MediaRecorder(stream, c.mime ? { mimeType: c.mime } : undefined);
    rec.ondataavailable = (e) => e.data.size && c.chunks.push(e.data);
    c.rec = rec;

    const ctx = new AudioContext();
    c.ctx = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    c.silent = 0;
    c.pausedAt = undefined;

    rec.start(1000);
    c.t0 = performance.now();
    if (opts?.paused) {
      rec.pause();
      c.pausedAt = c.t0;
    }
    setPaused(!!opts?.paused);
    setLive({ level: 0, elapsedMs: 0, liveWpm: 0, silenceMs: 0 });
    c.timer = setInterval(() => {
      if (c.pausedAt != null) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const byte = Math.min(255, Math.round(Math.sqrt(Math.sqrt(sum / buf.length)) * GAIN));
      c.energy.push(byte);
      c.silent = byte < VOICE ? c.silent + 1 : 0;
      setLive({ level: byte / 255, elapsedMs: performance.now() - c.t0, liveWpm: estimateWpm(c.energy), silenceMs: c.silent * FRAME_MS });
    }, FRAME_MS);
    setState('recording');
    return true;
  }, []);

  const pause = useCallback(() => {
    const c = r.current;
    if (c.rec?.state !== 'recording') return;
    c.rec.pause();
    c.pausedAt = performance.now();
    setPaused(true);
    setLive((l) => ({ ...l, level: 0, silenceMs: 0 }));
  }, []);

  const resume = useCallback(() => {
    const c = r.current;
    if (c.rec?.state !== 'paused') return;
    c.rec.resume();
    c.t0 += performance.now() - (c.pausedAt ?? performance.now());
    c.pausedAt = undefined;
    c.silent = 0;
    setPaused(false);
  }, []);

  const stop = useCallback(
    () =>
      new Promise<Recording>((resolve, reject) => {
        const c = r.current;
        const rec = c.rec;
        if (!rec || rec.state === 'inactive') return reject(new Error('Not recording'));
        const durationMs = Math.round(clock());
        clearInterval(c.timer);
        rec.onstop = () => {
          const mime = rec.mimeType || c.mime || 'audio/webm';
          teardown();
          setPaused(false);
          setState('stopped');
          setLive((l) => ({ ...l, level: 0, silenceMs: 0 }));
          resolve({ blob: new Blob(c.chunks, { type: mime }), mime, durationMs, energy: c.energy.slice(0, 20000) });
        };
        rec.stop();
      }),
    [teardown, clock],
  );

  return { state, error, paused, start, stop, pause, resume, clock, ...live };
}
