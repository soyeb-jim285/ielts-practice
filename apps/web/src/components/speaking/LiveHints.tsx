import { Gauge } from 'lucide-react';
import { Badge } from '@/components/ui';

/** Rough live pace from energy peaks. Shown after a few seconds so the first estimate isn't noise. */
export function WpmPill({ wpm, elapsedMs }: { wpm: number; elapsedMs: number }) {
  if (elapsedMs < 5000) return <Badge tone="neutral">Pace: listening…</Badge>;
  const [tone, note] = wpm < 90 ? (['warn', 'slow'] as const) : wpm > 180 ? (['warn', 'fast'] as const) : (['good', 'steady'] as const);
  return (
    <Badge tone={tone} title="Rough estimate from your voice, not a transcript">
      <Gauge aria-hidden />~{wpm} wpm · {note}
    </Badge>
  );
}

/** Gentle nudge after 3 s of silence while recording. */
export function SilenceNudge({ silenceMs }: { silenceMs: number }) {
  return (
    <p aria-live="polite" className="h-8">
      {silenceMs >= 3000 && <Badge tone="accent" className="h-8 px-3 text-sm">Keep going… add a reason or an example</Badge>}
    </p>
  );
}
