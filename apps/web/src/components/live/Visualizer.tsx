import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** What the examiner is doing; each has its own motion (after LiveKit's agent bar visualizer). */
export type VoiceState = 'connecting' | 'thinking' | 'speaking' | 'listening' | 'idle';

const BARS = 5;
const MID = (BARS - 1) / 2;
/** 0 at the edges, 1 in the middle. */
const centre = (i: number) => 1 - Math.abs(i - MID) / MID;

/** Examiner voice bands from its audio: log-spaced across the speech range, so each bar moves with its own part of the voice. */
function bands(stream: MediaStream) {
  const ctx = new AudioContext();
  void ctx.resume().catch(() => {}); // created outside a tap, iOS starts it suspended
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.75;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const hz = ctx.sampleRate / analyser.fftSize;
  const edges = Array.from({ length: BARS + 1 }, (_, i) => Math.round((120 * (4000 / 120) ** (i / BARS)) / hz)); // 120 Hz to 4 kHz
  // The loudest band in the middle, as LiveKit does: the shape reads as a voice, not a spectrum.
  const order = [2, 1, 3, 0, 4]; // lowest (loudest) band in the middle, then outwards
  const raw = Array.from({ length: BARS }, () => 0);
  let peak = 0.15; // automatic gain: bars scale to the recent loudest band, so a quiet or loud voice both fill the range
  return {
    /** False when the audio reads as silence (a suspended context): the caller animates without it. */
    read(out: number[]) {
      analyser.getByteFrequencyData(data);
      if (!data.some((v) => v > 0)) return false;
      for (let b = 0; b < BARS; b++) {
        let sum = 0;
        for (let k = edges[b]!; k < Math.max(edges[b + 1]!, edges[b]! + 1); k++) sum += data[k]!;
        raw[b] = sum / Math.max(1, edges[b + 1]! - edges[b]!) / 255;
      }
      peak = Math.max(peak * 0.995, ...raw, 0.15);
      for (let b = 0; b < BARS; b++) out[order[b]!] = Math.min(1, (raw[b]! / peak) ** 1.4 * 0.95);
      return true;
    },
    close: () => void ctx.close().catch(() => {}),
  };
}

/**
 * The examiner as five voice bars. Speaking: they follow the examiner's audio (`stream`); listening: they follow your microphone (`level`, 0..1);
 * connecting: a light sweeps across them; thinking: a slow wave; idle: they rest. Heights are written straight to the DOM in one animation frame
 * loop, so the 60 fps motion never re-renders React. Reduced motion: still bars per state.
 */
export function Visualizer({ state, stream, level, compact, className }: { state: VoiceState; stream?: MediaStream; level: number; compact?: boolean; className?: string }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const halo = useRef<HTMLSpanElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;
  const voiceRef = useRef<ReturnType<typeof bands> | null>(null);

  // One analyser per examiner stream for the whole test (iOS caps audio contexts), read only while it speaks.
  useEffect(() => {
    if (!stream) return;
    const v = bands(stream);
    voiceRef.current = v;
    return () => {
      voiceRef.current = null;
      v.close();
    };
  }, [stream]);

  useEffect(() => {
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const h = Array.from({ length: BARS }, () => 0.12);
    const shown = Array.from({ length: BARS }, () => 0.12);
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      let lit = -1;
      if (reduce) for (let i = 0; i < BARS; i++) h[i] = state === 'speaking' || state === 'listening' ? 0.3 + 0.4 * centre(i) : 0.14;
      else if (state === 'speaking') {
        if (!voiceRef.current?.read(h)) for (let i = 0; i < BARS; i++) h[i] = 0.2 + 0.7 * centre(i) * Math.abs(Math.sin(t * 5.3 + i * 1.7)); // no audio to read (text-only voice)
      } else if (state === 'listening') {
        const v = Math.min(1, levelRef.current * 1.8);
        for (let i = 0; i < BARS; i++) h[i] = 0.14 + v * (0.35 + 0.65 * centre(i)) * (0.85 + 0.15 * Math.sin(t * 9 + i));
      } else if (state === 'thinking') {
        for (let i = 0; i < BARS; i++) h[i] = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(t * 4 - i * 0.9));
      } else if (state === 'connecting') {
        lit = Math.floor(t * 6) % (BARS * 2 - 2); // there and back
        if (lit >= BARS) lit = BARS * 2 - 2 - lit;
        for (let i = 0; i < BARS; i++) h[i] = 0.14;
      } else for (let i = 0; i < BARS; i++) h[i] = 0.12;
      const loud = shown.reduce((a, b) => a + b, 0) / BARS;
      if (halo.current) {
        const v = state === 'speaking' || state === 'listening' ? Math.min(1, loud * 1.4) : state === 'idle' ? 0 : 0.25;
        halo.current.style.transform = `scale(${(0.7 + 0.45 * v).toFixed(3)})`;
        halo.current.style.opacity = (0.35 + 0.65 * v).toFixed(3);
      }
      for (let i = 0; i < BARS; i++) {
        // fast attack, slower release: speech peaks land at once and fall back smoothly
        shown[i]! += (h[i]! - shown[i]!) * (h[i]! > shown[i]! ? 0.55 : 0.18);
        const el = bars.current[i];
        if (!el) continue;
        el.style.transform = `scaleY(${Math.max(0.08, shown[i]!).toFixed(3)})`;
        el.style.opacity = state === 'connecting' ? (i === lit ? '1' : '0.35') : state === 'idle' ? '0.45' : '1';
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  return (
    <div className={cn('relative isolate flex items-center justify-center', compact ? 'h-8 gap-1' : 'h-28 gap-2.5', className)} aria-hidden>
      {/* A glow that swells with the voice: the examiner's in the brand tint, yours neutral. */}
      <span
        ref={halo}
        className={cn(
          'absolute top-1/2 left-1/2 -z-10 -translate-1/2 rounded-full transition-[background] duration-300',
          compact ? 'size-16' : 'size-48',
          state === 'listening' ? 'bg-[radial-gradient(closest-side,var(--surface-2),transparent)]' : 'bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]',
        )}
        style={{ transform: 'scale(0.7)', opacity: 0.35 }}
      />
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => void (bars.current[i] = el)}
          className={cn('h-full rounded-full transition-[background-color,opacity] duration-300', compact ? 'w-1.5' : 'w-4', state === 'listening' ? 'bg-ink/75' : 'bg-brand')}
          style={{ transform: 'scaleY(0.12)' }}
        />
      ))}
    </div>
  );
}
