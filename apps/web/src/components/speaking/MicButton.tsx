import { clsx } from 'clsx';
import { LoaderCircle, Mic, Square } from 'lucide-react';
import type { RecorderState } from '@/hooks/useRecorder';

/** Big record/stop button. The halo breathes with the live input level so you can see the mic hears you. */
export function MicButton({ state, level, onStart, onStop, disabled }: { state: RecorderState; level: number; onStart: () => void; onStop: () => void; disabled?: boolean }) {
  const recording = state === 'recording';
  const busy = state === 'requesting';
  return (
    <div className="relative grid size-28 place-items-center">
      {recording && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-bad/15 transition-transform duration-100 motion-reduce:hidden"
          style={{ transform: `scale(${0.85 + Math.min(level * 1.6, 0.35)})` }}
        />
      )}
      <button
        type="button"
        onClick={recording ? onStop : onStart}
        disabled={disabled || busy}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
        className={clsx(
          'relative grid size-20 place-items-center rounded-full shadow-pop transition-[background-color,transform] duration-150 active:scale-95 disabled:opacity-60',
          recording ? 'bg-bad text-bad-ink' : 'bg-accent text-accent-ink hover:bg-accent-hover',
        )}
      >
        {busy ? <LoaderCircle className="size-8 animate-spin" /> : recording ? <Square className="size-7 fill-current" /> : <Mic className="size-8" />}
      </button>
    </div>
  );
}
