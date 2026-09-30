import { useCallback, useEffect, useRef, useState } from 'react';

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

/** Sticky native player (standard, keyboard-accessible controls) for the recording. */
export function AudioBar({ src, audioRef }: { src: string; audioRef: (el: HTMLAudioElement | null) => void }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur-sm sm:mx-0 sm:rounded-card sm:border sm:px-3">
      <audio ref={audioRef} src={src} controls preload="metadata" className="h-10 w-full" aria-label="Your recording" />
    </div>
  );
}
