import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CountUp } from './CountUp';

type Delta = { value: string; tone?: 'good' | 'bad' | 'neutral' };

/**
 * One number with its label: scores, counts, streaks. Figures are tabular so they don't jiggle. Not a card: sits on a page or inside one.
 * Pass a number as `value` with `decimals` to count up on mount; pass a node for anything else.
 */
export function Stat({ label, value, decimals = 0, unit, delta, hint, size = 'md', className }: { label: ReactNode; value: number | ReactNode; decimals?: number; unit?: ReactNode; delta?: Delta; hint?: ReactNode; size?: 'md' | 'lg'; className?: string }) {
  const DELTA = { good: 'text-good-text', bad: 'text-bad-text', neutral: 'text-muted' };
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="type-caption">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span className={cn('type-num font-semibold tracking-tight text-ink', size === 'lg' ? 'text-4xl' : 'text-2xl')}>{typeof value === 'number' ? <CountUp value={value} decimals={decimals} /> : value}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
        {delta && <span className={cn('type-num ml-1 text-sm font-medium', DELTA[delta.tone ?? 'neutral'])}>{delta.value}</span>}
      </dd>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
