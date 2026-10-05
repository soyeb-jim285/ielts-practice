import type { ReactNode } from 'react';
import { Stat } from '@/components/ui';
import { Sparkline } from './MiniChart';

export type Kpi = { label: ReactNode; value: number | ReactNode; decimals?: number; delta?: { value: string; tone?: 'good' | 'bad' | 'neutral' }; hint?: ReactNode; spark?: number[] };

/** One row of KPIs divided by hairlines (not cards): number, delta chip, optional sparkline. Two columns on a phone, where sparklines hide under 400px. */
export function StatStrip({ items }: { items: Kpi[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
    <dl className="-mr-px -mb-px grid grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]">
      {items.map((k, i) => (
        <div key={i} className="flex min-w-0 flex-col justify-between gap-2 border-r border-b border-line p-4 max-md:last:odd:col-span-2">
          <Stat label={k.label} value={k.value} decimals={k.decimals} hint={k.hint} className="[&_dd]:flex-wrap" />
          <div className="space-y-2">
            {k.delta && <span className={`type-num block text-xs font-medium whitespace-nowrap ${k.delta.tone === 'good' ? 'text-good-text' : k.delta.tone === 'bad' ? 'text-bad-text' : 'text-muted'}`}>{k.delta.value}</span>}
            {k.spark && <Sparkline values={k.spark} />}
          </div>
        </div>
      ))}
    </dl>
    </div>
  );
}
