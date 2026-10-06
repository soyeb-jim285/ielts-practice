import { clusterMoments } from '@ielts/core';
import { Headphones, Pause, Play, RotateCcw, RotateCw, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Button, ProgressBar, Segmented } from '@/components/ui';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LISTENING_REVIEW_SECONDS } from '@/lib/lr';
import { resumePosition, type AudioResume } from '@/lib/audioPos';

const pinStyle = (p: AudioPin, on: boolean) =>
  cn(
    'type-num inline-flex cursor-pointer items-center justify-center border font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    p.correct ? 'rounded-full border-good bg-good-soft text-good-text' : 'rounded-[4px] border-bad bg-bad-soft text-bad-text',
    p.approx && 'border-dashed',
    on && 'ring-2 ring-ink',
  );

const range = 'h-2 w-full cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed';

function Volume({ el }: { el: RefObject<HTMLAudioElement | null> }) {
  const [v, setV] = useState(1);
  return (
    <label className="flex items-center gap-2 text-muted">
      <Volume2 className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">Volume</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={v}
        onChange={(e) => {
          setV(+e.target.value);
          if (el.current) el.current.volume = +e.target.value;
        }}
        className={`${range} w-20`}
      />
    </label>
  );
}

/** Practice / review player: play, scrub, ±5 s, speed 0.75-1.25x, restart the part. */
/** One answer moment on the results scrubber. Right / wrong is shown by shape and the number, not by colour alone. */
export interface AudioPin { n: number; at: number; correct: boolean; approx: boolean }
const pinLabel = (p: AudioPin) => `Question ${p.n}, ${p.correct ? 'right' : 'wrong'}, ${formatClock(p.at)}${p.approx ? ', approximate' : ''}`;

export function PracticeAudio({ src, label, className, cue, resume, pins, pinned, onPin }: { src: string; label: string; className?: string; cue?: { from: number; to: number; id: number } | null; resume?: AudioResume; pins?: AudioPin[]; pinned?: number | null; onPin?: (n: number) => void }) {
  const el = useRef<HTMLAudioElement>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [group, setGroup] = useState<number | null>(null); // the open cluster of crowded markers, by its first question
  const [rate, setRate] = useState(String(resume?.rate ?? 1));
  const [resumedAt, setResumedAt] = useState(0); // set while the player sits at a restored position and has not been played yet
  const r = useRef(resume);
  r.current = resume;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const ready = useRef(false); // until the saved position is applied, currentTime is 0 and must not overwrite it (StrictMode remounts, early unload)
  const persist = (a: HTMLAudioElement | null) => {
    if (a && ready.current) r.current?.set(a.currentTime, +rateRef.current);
    r.current?.save();
  };
  // save every ~5 s while playing, and on unmount (leaving the runner or switching part remounts this player)
  useEffect(() => {
    const a = el.current;
    const id = setInterval(() => a && !a.paused && persist(a), 5000);
    return () => {
      clearInterval(id);
      persist(a);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (el.current) el.current.playbackRate = +rate;
  }, [rate, src]);
  // "Play from here": jump to cue.from, play, stop at cue.to
  const stopAt = useRef<number | null>(null);
  useEffect(() => {
    const a = el.current;
    if (!cue || !a) return;
    const go = () => {
      a.currentTime = cue.from;
      stopAt.current = cue.to;
      void a.play().catch(() => {});
    };
    if (a.readyState >= 1) go();
    else {
      a.addEventListener('loadedmetadata', go, { once: true });
      return () => a.removeEventListener('loadedmetadata', go);
    }
  }, [cue?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const seek = (v: number) => {
    stopAt.current = null;
    if (el.current) el.current.currentTime = Math.min(Math.max(0, v), dur || v);
  };
  return (
    <div role="group" aria-label={`${label} audio`} className={className ?? 'flex flex-wrap items-center gap-x-4 gap-y-2'}>
      <audio
        key={src}
        ref={el}
        src={src}
        preload="metadata"
        onTimeUpdate={(e) => {
          setT(e.currentTarget.currentTime);
          if (ready.current) r.current?.set(e.currentTarget.currentTime, +rateRef.current);
          if (stopAt.current != null && e.currentTarget.currentTime >= stopAt.current) {
            stopAt.current = null;
            e.currentTarget.pause();
          }
        }}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          setDur(a.duration);
          a.playbackRate = +rate;
          const at = resumePosition(resume?.start ?? 0, a.duration);
          if (at > 0 && !cue) {
            a.currentTime = at;
            setT(at);
            setResumedAt(at);
          }
          ready.current = true;
        }}
        onPlay={() => {
          setPlaying(true);
          setResumedAt(0);
        }}
        onPause={(e) => {
          setPlaying(false);
          persist(e.currentTarget);
        }}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Back 5 seconds" onClick={() => seek(t - 5)}>
          <RotateCcw />
        </Button>
        <Button size="icon" aria-label={playing ? `Pause ${label}` : `Play ${label}`} onClick={() => (playing ? el.current?.pause() : void el.current?.play())}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Forward 5 seconds" onClick={() => seek(t + 5)}>
          <RotateCw />
        </Button>
      </div>
      <div className="flex min-w-48 flex-1 items-center gap-3">
        <span className="type-num type-caption w-10 text-right">{formatClock(t)}</span>
        <div className={cn('relative min-w-0 flex-1', !!pins?.length && 'pt-6 max-md:pt-0')}>
          <input type="range" aria-label="Seek" min={0} max={dur || 1} step={0.1} value={Math.min(t, dur || 1)} onChange={(e) => seek(+e.target.value)} className={range} />
          {dur > 0 && clusterMoments(pins ?? [], dur).map((g) => {
            const left = `${Math.min(100, (g[0]!.at / dur) * 100)}%`;
            if (g.length === 1) {
              const p = g[0]!;
              return (
                <button key={p.n} type="button" aria-label={pinLabel(p)} title={pinLabel(p)} aria-current={pinned === p.n || undefined} onClick={() => onPin?.(p.n)} style={{ left }} className={cn(pinStyle(p, pinned === p.n), 'absolute top-0 h-5 min-w-5 -translate-x-1/2 px-1 text-[11px] max-md:hidden')}>
                  {p.n}
                </button>
              );
            }
            const ns = g.map((p) => p.n).sort((a, b) => a - b);
            const wrong = g.filter((p) => !p.correct).length;
            const label = `Questions ${ns.join(', ')} are heard close together${wrong ? `, ${wrong} wrong` : ''}. Open the list`;
            const key = ns[0]!;
            return (
              <div key={key} style={{ left }} onKeyDown={(e) => e.key === "Escape" && setGroup(null)} className="absolute top-0 -translate-x-1/2 max-md:hidden">
                <button type="button" aria-label={label} title={label} aria-expanded={group === key} onClick={() => setGroup(group === key ? null : key)} className="type-num inline-flex h-5 cursor-pointer whitespace-nowrap items-center justify-center rounded-md border border-line-strong bg-card px-1.5 text-[11px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {ns[0]}–{ns[ns.length - 1]}
                </button>
                {group === key && (
                  <div role="group" aria-label={`Questions ${ns[0]} to ${ns[ns.length - 1]}`} className="absolute top-full left-1/2 z-20 mt-2 flex -translate-x-1/2 gap-1 rounded-lg border border-line bg-card p-1.5 shadow-card">
                    {g.map((p) => (
                      <button key={p.n} type="button" aria-label={pinLabel(p)} title={pinLabel(p)} aria-current={pinned === p.n || undefined} onClick={() => { setGroup(null); onPin?.(p.n); }} className={cn(pinStyle(p, pinned === p.n), 'h-8 min-w-8 px-1.5 text-xs')}>
                        {p.n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <span className="type-num type-caption w-10">{formatClock(dur)}</span>
      </div>
      {!!pins?.length && (
        <ul aria-label="Questions in this part, by time" className="-mx-1 flex w-full gap-1.5 overflow-x-auto px-1 pb-1 md:hidden">
          {pins.map((p) => (
            <li key={p.n} className="shrink-0">
              <button type="button" aria-label={pinLabel(p)} aria-current={pinned === p.n || undefined} onClick={() => onPin?.(p.n)} className={cn(pinStyle(p, pinned === p.n), 'h-11 min-w-14 flex-col gap-0 px-2 leading-tight')}>
                <span className="text-sm">{p.n}</span>
                <span className="text-[11px] font-normal">{formatClock(p.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Segmented
        label="Playback speed"
        size="sm"
        value={rate}
        onChange={(v) => {
          setRate(v);
          rateRef.current = v;
          persist(el.current);
        }}
        options={['0.75', '1', '1.25'].map((v) => ({ value: v, label: `${v}×`, 'aria-label': `${v} times speed` }))}
      />
      <Button variant="outline" size="sm" onClick={() => { seek(0); void el.current?.play(); }}>
        Replay {label.toLowerCase()}
      </Button>
      {resumedAt > 0 && <span className="type-caption type-num text-muted">Resume from {formatClock(resumedAt)}</span>}
      <span className="max-md:hidden">
        <Volume el={el} />
      </span>
    </div>
  );
}

export type ExamPhase = 'idle' | 'audio' | 'review';

/**
 * Exam listening: the recordings of all parts play once, in order, with no pause or seek for the learner. The clock IS the audio position
 * (so a resumed attempt picks the recording up where it was), then a 2-minute review countdown runs on the wall clock.
 */
/** checkEndsAt: when the checking time the recording announces runs out, in seconds into the last part's audio (server, from word timings); without it the computer-delivered 2 minutes. */
export function useExamPlaylist(urls: string[], startElapsed: number, checkEndsAt?: number) {
  const el = useRef<HTMLAudioElement>(null);
  const [durations, setDurations] = useState<number[] | null>(null);
  const [error, setError] = useState(false);
  const [phase, setPhase] = useState<ExamPhase>('idle');
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(startElapsed);
  const [stalled, setStalled] = useState(false);
  const reviewStart = useRef(0);
  const cur = useRef({ idx: 0, phase: 'idle' as ExamPhase });
  cur.current = { idx, phase };

  useEffect(() => {
    let dead = false;
    Promise.all(
      urls.map(
        (u) =>
          new Promise<number>((res, rej) => {
            const a = new Audio();
            a.preload = 'metadata';
            a.onloadedmetadata = () => res(a.duration);
            a.onerror = () => rej(new Error('audio'));
            a.src = u;
          }),
      ),
    ).then((d) => !dead && setDurations(d), () => !dead && setError(true));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.join('|')]);

  const starts = durations?.reduce<number[]>((acc, d, i) => [...acc, (acc[i] ?? 0) + d], [0]) ?? [0];
  const total = durations ? starts[durations.length]! : 0;
  // follow the recording: "ten minutes to transfer your answers" (Cambridge books), "one minute to check" (often already silence in the file)
  const reviewSeconds = durations && checkEndsAt !== undefined ? Math.max(0, Math.round(starts[durations.length - 1]! + checkEndsAt - total)) : LISTENING_REVIEW_SECONDS;

  const load = useCallback(
    (i: number, offset: number) => {
      const a = el.current;
      if (!a) return;
      a.src = urls[i]!;
      a.onloadedmetadata = () => {
        a.currentTime = offset;
        a.onloadedmetadata = null;
        void a.play().catch(() => setStalled(true));
      };
      setIdx(i);
    },
    [urls],
  );

  const start = () => {
    if (!durations) return;
    setStalled(false);
    if (startElapsed >= total) {
      reviewStart.current = Date.now() - (startElapsed - total) * 1000;
      setPhase('review');
      return;
    }
    let i = 0;
    while (i < durations.length - 1 && startElapsed >= starts[i + 1]!) i++;
    setPhase('audio');
    load(i, startElapsed - starts[i]!);
  };

  const resume = () => {
    setStalled(false);
    void el.current?.play().catch(() => setStalled(true));
  };

  useEffect(() => {
    const a = el.current;
    if (!a) return;
    const ended = () => {
      if (cur.current.idx < urls.length - 1) load(cur.current.idx + 1, 0);
      else {
        reviewStart.current = Date.now();
        setPhase('review');
      }
    };
    const paused = () => cur.current.phase === 'audio' && !a.ended && setStalled(true); // the device paused it (headphones, call)
    a.addEventListener('ended', ended);
    a.addEventListener('pause', paused);
    return () => {
      a.removeEventListener('ended', ended);
      a.removeEventListener('pause', paused);
    };
  }, [load, urls.length]);

  useEffect(() => {
    if (phase === 'idle') return;
    const t = setInterval(() => {
      if (cur.current.phase === 'audio') setElapsed(starts[cur.current.idx]! + (el.current?.currentTime ?? 0));
      else setElapsed(total + (Date.now() - reviewStart.current) / 1000);
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, total]);

  const reviewLeft = Math.max(0, Math.ceil(reviewSeconds - (elapsed - total)));
  return { el, durations, error, phase, idx, elapsed, total, start, resume, stalled, reviewLeft, reviewSeconds };
}

/** Exam recording bar: whole-test progress, which part is playing, volume. No transport controls on purpose. */
export function ExamAudioBar({ playlist, parts }: { playlist: ReturnType<typeof useExamPlaylist>; parts?: number[] }) {
  const { phase, idx, elapsed, total, durations, stalled, resume, reviewLeft, el } = playlist;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2" role="group" aria-label="Recording">
      <Headphones className="size-5 shrink-0 text-accent-text" aria-hidden />
      <div className="min-w-0 flex-1 basis-56">
        <p className="type-num text-sm font-medium">
          {phase === 'review' ? 'Recording finished. Check your answers.' : parts ? `Part ${parts[idx]} is playing` : `Part ${idx + 1} of ${durations?.length ?? 4} is playing`}
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <ProgressBar label="Recording progress" value={total ? Math.min(1, elapsed / total) : 0} className="h-1.5 flex-1" />
          {total > 0 && phase !== 'review' && <span className="type-num shrink-0 text-xs text-muted">{formatClock(Math.min(elapsed, total))} / {formatClock(total)}</span>}
        </div>
      </div>
      {phase === 'review' && <span className="type-num rounded-md bg-warn-soft px-2.5 py-1 text-sm font-semibold text-warn-text">{formatClock(reviewLeft)} left to review</span>}
      {stalled && phase === 'audio' && (
        <Button size="sm" onClick={resume}>
          Resume audio
        </Button>
      )}
      <Volume el={el} />
    </div>
  );
}
