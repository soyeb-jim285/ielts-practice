import { formatBand } from '@/lib/format';
import { bandColor } from '@/lib/result';
import { cn } from '@/lib/utils';

const STROKE = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };

/**
 * Semi-circle 0-9 band gauge, coloured against the user's target band.
 * Props: band (0-9), target (settings.targetBand), label (accessible name, e.g. "Grammar"), size (px width, default 112).
 */
export function BandGauge({ band, target, label, size = 112, className }: { band: number; target: number; label: string; size?: number; className?: string }) {
  const tone = bandColor(band, target);
  const arc = 'M 8 50 A 42 42 0 0 1 92 50';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={9} aria-valuenow={band} aria-valuetext={`Band ${formatBand(band)}`} className={cn('relative shrink-0', className)} style={{ width: size }}>
      <svg viewBox="0 0 100 56" className="w-full" aria-hidden>
        <path d={arc} fill="none" stroke="var(--line)" strokeWidth={8} strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth={8}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${(Math.max(0, Math.min(9, band)) / 9) * 100} 100`}
          style={{ transition: 'stroke-dasharray 600ms var(--ease-out-expo)' }}
        />
      </svg>
      <span className="type-num absolute inset-x-0 bottom-0 text-center text-2xl font-semibold tracking-tight">{formatBand(band)}</span>
    </div>
  );
}
