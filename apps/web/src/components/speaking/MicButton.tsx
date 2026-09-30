import { clsx } from 'clsx';
import { LoaderCircle, Mic, Square } from 'lucide-react';
import type { RecorderState } from '@/hooks/useRecorder';

/** Big record/stop button. The halo follows the live input level so you can see the mic hears you; a slow pulse ring marks "live" (off with reduced motion). */
export function MicButton({ state, level, onStart, onStop, disabled }: { state: RecorderState; level: number; onStart: () => void; onStop: () => void; disabled?: boolean }) {
  const recording = state === 'recording';
  const busy = state === 'requesting';
  return (
    <div className="relative grid size-32 place-items-center">
      {recording && (
        <>
          <span aria-hidden className="absolute size-24 animate-ping rounded-full bg-bad/20 [animation-duration:2s] motion-reduce:hidden" />
          <span aria-hidden className="absolute inset-0 rounded-full bg-bad/12 transition-transform duration-100 motion-reduce:hidden" style={{ transform: `scale(${0.8 + Math.min(level * 1.6, 0.2)})` }} />
        </>
      )}
      <button
        type="button"
        onClick={recording ? onStop : onStart}
        disabled={disabled || busy}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
        className={clsx(
          'relative grid size-24 place-items-center rounded-full shadow-pop transition-[background-color,transform] duration-150 active:scale-95 disabled:opacity-60',
          recording ? 'bg-bad text-bad-ink' : 'bg-brand text-brand-ink hover:bg-brand-hover',
        )}
      >
        {busy ? <LoaderCircle className="size-9 animate-spin" /> : recording ? <Square className="size-8 fill-current" /> : <Mic className="size-9" />}
      </button>
    </div>
  );
}
