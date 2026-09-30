import { LoaderCircle, Mic, Square } from 'lucide-react';
import type { RecorderState } from '@/hooks/useRecorder';
import { cn } from '@/lib/utils';

/** Big record/stop button. A thin ring follows the live input level so you can see the mic hears you; a slow outline ping marks "live" (off with reduced motion). */
export function MicButton({ state, level, onStart, onStop, disabled }: { state: RecorderState; level: number; onStart: () => void; onStop: () => void; disabled?: boolean }) {
  const recording = state === 'recording';
  const busy = state === 'requesting';
  return (
    <div className="relative grid size-28 shrink-0 place-items-center">
      {recording && (
        <>
          <span aria-hidden className="absolute size-24 animate-ping rounded-full border border-bad/40 [animation-duration:2s] motion-reduce:hidden" />
          <span aria-hidden className="absolute inset-0 rounded-full border-2 border-bad/30 transition-transform duration-100 motion-reduce:hidden" style={{ transform: `scale(${0.86 + Math.min(level * 1.6, 0.14)})` }} />
        </>
      )}
      <button
        type="button"
        onClick={recording ? onStop : onStart}
        disabled={disabled || busy}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
        className={cn(
          'relative grid size-24 place-items-center rounded-full shadow-card transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50',
          recording ? 'bg-bad text-bad-ink' : 'bg-brand text-brand-ink shadow-[var(--highlight)] hover:bg-brand-hover',
        )}
      >
        {busy ? <LoaderCircle className="size-9 animate-spin" /> : recording ? <Square className="size-7 fill-current" /> : <Mic className="size-9" />}
      </button>
    </div>
  );
}
