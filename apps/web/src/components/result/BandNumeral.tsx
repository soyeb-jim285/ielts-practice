import { CountUp } from '@/components/ui';
import { formatBand } from '@/lib/format';
import { cn } from '@/lib/utils';

const SIZE = { hero: 'type-band text-6xl sm:text-7xl', standard: 'type-band text-3xl' } as const;
const TONE = { ink: 'text-ink', good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' } as const;

/** The only place band-numeral sizes are set. `hero` (60/72px, counts up) once per view; `standard` (30px) for every other band. null renders a muted dash. */
export function BandNumeral({ value, size, tone = 'ink', decimals = 1, className }: { value: number | null; size: 'hero' | 'standard'; tone?: 'ink' | 'good' | 'warn' | 'bad'; decimals?: number; className?: string }) {
  if (value == null) return <span className={cn(SIZE[size], 'text-muted', className)}>{formatBand(null)}</span>;
  return size === 'hero' ? (
    <CountUp value={value} decimals={decimals} className={cn(SIZE.hero, TONE[tone], className)} />
  ) : (
    <span className={cn(SIZE.standard, TONE[tone], className)}>{value.toFixed(decimals)}</span>
  );
}
