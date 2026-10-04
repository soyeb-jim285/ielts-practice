import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Segmented } from '@/components/ui';
import { formatClock } from '@/lib/format';
import type { Marker, Timeline } from '@/lib/timeline';
import { markerLabel, MarkerShape } from './timeline';

export type AudioControls = {
  time: number;
  /** Exact playback position (the 0.1 s `time` is for display); read it from a frame loop, not from render. */
  now: () => number;
  /** Playing right now: a frame loop only runs then. */
  playing: boolean;
  seek: (t: number, until?: number) => void;
  ready: boolean;
  /** The picked mistake (shared by the chart, audio bar and transcript), and the ways to pick or clear it. */
  focus: string | null;
  pick: (m: Marker) => void;
  clear: () => void;
};

/** Shared audio element state: current time (0.1 s steps, rAF while playing) and seek-and-play with an optional stop point. */
export function useAudio() {
  const [el, setEl] = useState<HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  /** The clip seek() is playing to its stop point. Dropped on any pause or a seek outside it, so a stale stop never halts later playback. */
  const clip = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (!el) return;
    clip.current = null;
    let raf = 0;
    const read = () => setTime(Math.round(el.currentTime * 10) / 10);
    const loop = () => {
      read();
      if (clip.current && el.currentTime >= clip.current.to) {
        clip.current = null;
        el.pause();
      }
      if (!el.paused) raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      setPlaying(true);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      clip.current = null;
      setPlaying(false);
      cancelAnimationFrame(raf);
      read();
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    el.addEventListener('seeked', read);
    // The scrubber or a play button moved the playhead out of the clip: play on from there.
    const onSeeking = () => {
      const c = clip.current;
      if (c && (el.currentTime < c.from - 0.05 || el.currentTime >= c.to)) clip.current = null;
    };
    el.addEventListener('seeking', onSeeking);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
      el.removeEventListener('seeked', read);
      el.removeEventListener('seeking', onSeeking);
    };
  }, [el]);

  const seek = useCallback(
    (t: number, until?: number) => {
      if (!el) return;
      const from = Math.max(0, t - 0.3);
      el.currentTime = from;
      clip.current = until != null && until > from ? { from, to: until } : null;
      void el.play().catch(() => {});
    },
    [el],
  );

  // A mistake is heard from half a second before it (seek already backs off 0.3 s).
  const pick = useCallback((m: Marker) => {
    seek(m.t - 0.2);
    setFocus(m.id);
  }, [seek]);
  const clear = useCallback(() => setFocus(null), []);

  const now = useCallback(() => el?.currentTime ?? 0, [el]);

  return { ref: setEl, controls: { time, now, playing, seek, ready: !!el, focus, pick, clear } satisfies AudioControls };
}

const SPEEDS = [
  { value: '0.75', label: '0.75×', 'aria-label': 'Slower, 0.75 times' },
  { value: '1', label: '1×', 'aria-label': 'Normal speed' },
];

/** Player for the recording: play/pause, scrub, time, speed. The <audio> element is shared through `audioRef`; the page decides whether the bar sticks. */
export function AudioBar({ src, audioRef, durationS, timeline, onPick }: { src: string; audioRef: (el: HTMLAudioElement | null) => void; durationS?: number; timeline?: Timeline; onPick?: (m: Marker) => void }) {
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
    <div className="flex items-center gap-1 rounded-lg border border-line bg-card pr-2 pl-1 shadow-card sm:gap-2 sm:pr-3">
      <audio ref={ref} src={src} preload="metadata" className="hidden" />
      <Button size="icon" variant="ghost" aria-label={paused ? 'Play recording' : 'Pause recording'} onClick={() => (paused ? void el?.play().catch(() => {}) : el?.pause())}>
        {paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
      </Button>
      <div className="relative min-w-0 flex-1">
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
          className="h-11 w-full cursor-pointer appearance-none bg-clip-content py-[1.1875rem] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand [&::-moz-range-thumb]:bg-surface [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand [&::-webkit-slider-thumb]:bg-surface [&::-webkit-slider-thumb]:shadow-card"
        />
        {/* Question dividers cut the track; mistake marks sit just above it (same shapes and colours as the chart). */}
        {timeline?.questions.slice(1).map((q) => (
          <span key={q.idx} aria-hidden className="pointer-events-none absolute top-1/2 h-1.5 w-0.5 -translate-y-1/2 bg-card" style={{ left: `${(q.start / max) * 100}%` }} />
        ))}
        {timeline?.markers.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-label={markerLabel(m)}
            title={markerLabel(m)}
            onClick={() => onPick?.(m)}
            className="absolute top-0 flex h-5 w-4 -translate-x-1/2 cursor-pointer items-center justify-center"
            style={{ left: `${Math.min(100, (m.t / max) * 100)}%` }}
          >
            <MarkerShape type={m.type} size={9} />
          </button>
        ))}
      </div>
      <span className="type-num shrink-0 text-xs text-muted">
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
