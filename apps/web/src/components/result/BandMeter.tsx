import { useEffect, useState } from 'react';
import { formatBand } from '@/lib/format';
import { bandColor } from '@/lib/result';
import { cn } from '@/lib/utils';

const FILL = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', accent: 'bg-brand' };

/** Thin 0-9 band meter. With `target` the fill takes the band colour and a graphic tick marks the target (no text: the target is stated once in ScoreHero). `label` is the accessible name. */
export function BandMeter({ band, target, label, className }: { band: number; target?: number; label: string; className?: string }) {
  const at = (b: number) => Math.max(0, Math.min(9, b)) / 9;
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={9} aria-valuenow={band} aria-valuetext={`Band ${formatBand(band)}${target != null ? `, target ${formatBand(target)}` : ''}`} className={cn('relative flex h-3 items-center', className)}>
      <div className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-2 ring-1 ring-line ring-inset">
        <div className={cn('h-full origin-left transition-transform duration-[600ms] ease-(--ease-out-expo) motion-reduce:transition-none', FILL[target != null ? bandColor(band, target) : 'accent'])} style={{ transform: `scaleX(${on ? at(band) : 0})` }} />
      </div>
      {target != null && <span aria-hidden className="absolute top-0 h-3 w-0.5 -translate-x-1/2 rounded-[1px] bg-ink/70" style={{ left: `${at(target) * 100}%` }} />}
    </div>
  );
}
