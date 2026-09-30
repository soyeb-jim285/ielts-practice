import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Segmented } from '@/components/ui';
import { formatClock } from '@/lib/format';

export type AudioControls = { time: number; seek: (t: number, until?: number) => void; ready: boolean };

/** Shared audio element state: current time (0.1 s steps, rAF while playing) and seek-and-play with an optional stop point. */
export function useAudio() {
  const [el, setEl] = useState<HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const read = () => setTime(Math.round(el.currentTime * 10) / 10);
    const loop = () => {
      read();
      if (stopAt.current != null && el.currentTime >= stopAt.current) {
        stopAt.current = null;
        el.pause();
      }
      if (!el.paused) raf = requestAnimationFrame(loop);
    };
    const onPlay = () => (raf = requestAnimationFrame(loop));
    const onPause = () => {
      cancelAnimationFrame(raf);
      read();
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('seeked', read);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('seeked', read);
    };
  }, [el]);

  const seek = useCallback(
    (t: number, until?: number) => {
      if (!el) return;
      el.currentTime = Math.max(0, t - 0.3);
      stopAt.current = until ?? null;
      void el.play().catch(() => {});
    },
    [el],
  );

  return { ref: setEl, controls: { time, seek, ready: !!el } satisfies AudioControls };
}

const SPEEDS = [
  { value: '0.75', label: '0.75×', 'aria-label': 'Slower, 0.75 times' },
  { value: '1', label: '1×', 'aria-label': 'Normal speed' },
];

/** Player for the recording: play/pause, scrub, time, speed. The <audio> element is shared through `audioRef`; the page decides whether the bar sticks. */
export function AudioBar({ src, audioRef, durationS }: { src: string; audioRef: (el: HTMLAudioElement | null) => void; durationS?: number }) {
  const [el, setEl] = useState<HTMLAudioElement | null>(null);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(true);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState('1');
  const ref = useCallback(
    (e: HTMLAudioElement | null) => {
      audioRef(e);
      setEl(e);
    },
    [audioRef],
  );

  useEffect(() => {
    if (!el) return;
    // MediaRecorder webm reports duration Infinity until fully read: fall back to the recorded length.
    const sync = () => {
      setT(el.currentTime);
      setPaused(el.paused);
      setDur(Number.isFinite(el.duration) ? el.duration : (durationS ?? 0));
    };
    const events = ['timeupdate', 'play', 'pause', 'seeked', 'durationchange', 'loadedmetadata', 'ended'];
    events.forEach((ev) => el.addEventListener(ev, sync));
    sync();
    return () => events.forEach((ev) => el.removeEventListener(ev, sync));
  }, [el, durationS]);

  const max = Math.max(dur, t, 0.1);
  const pct = (t / max) * 100;
  return (
    <div className="flex items-center gap-1 rounded-card border border-border bg-card pr-2 pl-1 shadow-card sm:gap-2 sm:pr-3">
      <audio ref={ref} src={src} preload="metadata" className="hidden" />
      <Button size="icon" variant="ghost" aria-label={paused ? 'Play recording' : 'Pause recording'} onClick={() => (paused ? void el?.play().catch(() => {}) : el?.pause())}>
        {paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
      </Button>
      <input
        type="range"
        aria-label="Position in recording"
        aria-valuetext={`${formatClock(Math.floor(t))} of ${formatClock(Math.round(max))}`}
        min={0}
        max={max}
        step={0.1}
        value={t}
        onChange={(e) => el && (el.currentTime = Number(e.target.value))}
        style={{ backgroundImage: `linear-gradient(to right, var(--accent) ${pct}%, var(--line) ${pct}%)` }}
        className="h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-clip-content py-[1.1875rem] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand [&::-moz-range-thumb]:bg-surface [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand [&::-webkit-slider-thumb]:bg-surface [&::-webkit-slider-thumb]:shadow-card"
      />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatClock(Math.floor(t))} / {formatClock(Math.round(max))}
      </span>
      <Segmented
        label="Playback speed"
        size="sm"
        options={SPEEDS}
        value={rate}
        onChange={(v) => {
          setRate(v);
          if (el) el.playbackRate = Number(v);
        }}
      />
    </div>
  );
}
