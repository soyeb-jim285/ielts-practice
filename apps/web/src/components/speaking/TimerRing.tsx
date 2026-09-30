import { SPEAKING_ZONES } from '@ielts/core';
import { ProgressRing, type Tone } from '@/components/ui';
import { formatClock } from '@/lib/format';

/** Tone for an answer length in the part's target zone (P2 is only green from 1:30). */
export function zoneTone(part: 1 | 2 | 3, s: number): Tone {
  const z = SPEAKING_ZONES[part];
  if (s < z.min) return 'accent';
  if ('good' in z && s < z.good) return 'warn';
  return s <= z.max ? 'good' : 'warn';
}

function zoneHint(part: 1 | 2 | 3, s: number) {
  const z = SPEAKING_ZONES[part];
  if (s < z.min) return `Aim for ${z.min}–${z.max} s`;
  if ('good' in z && s < z.good) return 'Good — keep going to 1:30+';
  return s <= z.max ? 'In the target zone' : 'Time to wrap up';
}

/** Answer timer ring coloured by the part's target zone, with a text hint (colour never carries meaning alone). */
export function TimerRing({ part, seconds }: { part: 1 | 2 | 3; seconds: number }) {
  const z = SPEAKING_ZONES[part];
  return (
    <div className="flex flex-col items-center gap-2">
      <ProgressRing value={seconds / z.max} size={112} stroke={8} tone={zoneTone(part, seconds)} label="Answer time">
        <span className="text-2xl font-semibold tracking-tight">{formatClock(Math.floor(seconds))}</span>
      </ProgressRing>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {zoneHint(part, Math.floor(seconds))}
      </p>
    </div>
  );
}
