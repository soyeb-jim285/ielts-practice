import { useEffect, useState } from 'react';
import { formatBand } from '@/lib/format';
import { bandColor } from '@/lib/result';
import { cn } from '@/lib/utils';

const FILL = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad' };

/**
 * Horizontal 0-9 band meter, filled in the band colour against the user's target, with a tick at the target.
 * The fill grows from zero on mount (transform only, 600 ms). Props: band (0-9), target (settings.targetBand), label (accessible name, e.g. "Grammar band").
 */
export function BandBar({ band, target, label, className }: { band: number; target: number; label: string; className?: string }) {
  const at = (b: number) => Math.max(0, Math.min(9, b)) / 9;
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={9}
      aria-valuenow={band}
      aria-valuetext={`Band ${formatBand(band)}, target ${formatBand(target)}`}
      className={cn('relative flex h-4 items-center', className)}
    >
      <div className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-2 ring-1 ring-line ring-inset">
        <div
          className={cn('h-full origin-left transition-transform duration-[600ms] ease-(--ease-out-expo)', FILL[bandColor(band, target)])}
          style={{ transform: `scaleX(${on ? at(band) : 0})` }}
        />
      </div>
      <span aria-hidden className="absolute top-0 h-4 w-0.5 -translate-x-1/2 rounded-[1px] bg-ink/70" style={{ left: `${at(target) * 100}%` }} />
    </div>
  );
}
