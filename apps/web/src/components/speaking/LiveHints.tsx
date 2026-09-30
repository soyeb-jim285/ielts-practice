import { Gauge, Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui';
import { paceTone } from '@/lib/result';

/** Rough live pace from energy peaks, judged like the Fluency tab's speech rate. Waits for a few seconds of confident speech (wpm 0 = none yet). */
export function WpmPill({ wpm, elapsedMs }: { wpm: number; elapsedMs: number }) {
  if (elapsedMs < 5000 || !wpm) return <Badge tone="neutral" className="text-ink">Pace: listening</Badge>;
  const [tone, note] = paceTone(wpm) === 'good' ? (['good', 'steady'] as const) : (['warn', wpm < 120 ? 'slow' : 'fast'] as const);
  return (
    <Badge tone={tone} className="type-num" title="Rough estimate from your voice, not a transcript">
      <Gauge aria-hidden />~{wpm} wpm, {note}
    </Badge>
  );
}

/** Gentle nudge after 3 s of silence while recording. The slot keeps its height so the layout does not jump. */
export function SilenceNudge({ silenceMs }: { silenceMs: number }) {
  return (
    <p aria-live="polite" className="min-h-6 text-sm">
      {silenceMs >= 3000 && (
        <span className="inline-flex items-center gap-1.5 font-medium text-brand-text motion-safe:animate-[fade-in_200ms_var(--ease-out-quart)]">
          <Lightbulb className="size-4" aria-hidden /> Keep going. Add a reason or an example.
        </span>
      )}
    </p>
  );
}
