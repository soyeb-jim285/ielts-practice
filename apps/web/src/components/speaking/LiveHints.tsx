import { Gauge } from 'lucide-react';
import { Badge } from '@/components/ui';
import { paceTone } from '@/lib/result';

/** Rough live pace from energy peaks, judged like the Fluency tab's speech rate. Waits for a few seconds of confident speech (wpm 0 = none yet). */
export function WpmPill({ wpm, elapsedMs }: { wpm: number; elapsedMs: number }) {
  if (elapsedMs < 5000 || !wpm) return <Badge tone="neutral">Pace: listening…</Badge>;
  const [tone, note] = paceTone(wpm) === 'good' ? (['good', 'steady'] as const) : (['warn', wpm < 120 ? 'slow' : 'fast'] as const);
  return (
    <Badge tone={tone} title="Rough estimate from your voice, not a transcript">
      <Gauge aria-hidden />~{wpm} wpm · {note}
    </Badge>
  );
}

/** Gentle nudge after 3 s of silence while recording. */
export function SilenceNudge({ silenceMs }: { silenceMs: number }) {
  return (
    <p aria-live="polite" className="min-h-8">
      {silenceMs >= 3000 && <Badge tone="accent" className="h-auto px-3 py-1.5 text-sm">Keep going… add a reason or an example</Badge>}
    </p>
  );
}
