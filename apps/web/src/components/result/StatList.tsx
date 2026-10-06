import { Check, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BandNumeral } from './BandNumeral';

export type StatItem = { label: ReactNode; value: ReactNode; hint?: ReactNode; status?: { text: string; tone: 'good' | 'warn' | 'bad' }; info?: ReactNode };

const TONE = { good: ['text-good-text', Check], warn: ['text-warn-text', TriangleAlert], bad: ['text-bad-text', X] } as const;
const COLS = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' } as const;

/**
 * Borderless label/value list (a `<dl>`). `cols=1`: rows, label left, value in a fixed column right beside it (max 68ch, never stranded at the page edge).
 * `cols>=2`: stacked cells, value above its label. Status is words plus an icon, never colour alone. `numeral` makes values standard band numerals (value must then be a number).
 */
export function StatList({ items, cols = 1, numeral }: { items: StatItem[]; cols?: 1 | 2 | 3; numeral?: boolean }) {
  const rows = cols === 1;
  return (
    <dl className={cn(rows ? 'max-w-[68ch] divide-y divide-line' : cn('grid grid-cols-2 gap-x-6 gap-y-6', COLS[cols]))}>
      {items.map((it, i) => {
        const [tone, Icon] = it.status ? TONE[it.status.tone] : [];
        const value = numeral && typeof it.value === 'number' ? <BandNumeral value={it.value} size="standard" /> : <span className="type-body type-num">{it.value}</span>;
        return (
          <div key={i} className={cn(rows ? 'flex items-baseline gap-4 py-3' : 'flex flex-col-reverse gap-1')}>
            <dt className={cn('type-caption flex min-w-0 flex-wrap items-center gap-x-1', rows && 'flex-1')}>
              <span>{it.label}</span>
              {it.info}
            </dt>
            <dd className={cn('min-w-0', rows && 'w-24 text-right')}>
              {value}
              {it.status && Icon && (
                <span className={cn('type-caption mt-0.5 flex items-center gap-1', tone, rows && 'justify-end')}>
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {it.status.text}
                </span>
              )}
              {it.hint && <span className="type-caption mt-0.5 block">{it.hint}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
