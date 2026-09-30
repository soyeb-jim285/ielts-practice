import { clsx } from 'clsx';
import { formatBand } from '@/lib/format';
import { bandColor } from '@/lib/result';

const FILL = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad' };

/**
 * Horizontal 0–9 band meter, filled in the band colour against the user's target, with a tick at the target.
 * Props: band (0–9), target (settings.targetBand), label (accessible name, e.g. "Grammar band").
 */
export function BandBar({ band, target, label, className }: { band: number; target: number; label: string; className?: string }) {
  const at = (b: number) => `${(Math.max(0, Math.min(9, b)) / 9) * 100}%`;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={9}
      aria-valuenow={band}
      aria-valuetext={`Band ${formatBand(band)}, target ${formatBand(target)}`}
      className={clsx('relative h-2 rounded-full bg-border', className)}
    >
      <div className={clsx('h-full rounded-full transition-[width] duration-500 ease-(--ease-out-quart) motion-reduce:transition-none', FILL[bandColor(band, target)])} style={{ width: at(band) }} />
      <span aria-hidden className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/55" style={{ left: at(target) }} />
    </div>
  );
}
