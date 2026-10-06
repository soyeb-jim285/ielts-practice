import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BandMeter } from './BandMeter';
import { BandNumeral } from './BandNumeral';

/** Detail-block field: small caption label, value in body size beneath. One style for "Likely band", "Evidence from your answer", "Band descriptor". */
export function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="max-w-[68ch] space-y-1">
      <p className="type-caption">{label}</p>
      {children}
    </div>
  );
}

export type CriterionItem = { key: string; label: string; band: number; target?: number; gist?: ReactNode; weakest?: boolean; detail?: ReactNode };

const COLS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' } as const;

/**
 * Criteria bands. `strip`: 4-up cells (2x2 on phone): caption label, standard numeral, thin bar with target tick, optional gist (clamped to 2 lines). Labels are not headings (the strip sits above the first h2).
 * `rows`: one row per criterion, label as h3 (place inside a Section h2), numeral, bar, gist; `detail` opens under a flat "Details" toggle, the weakest also carries "Fix first".
 */
export function CriteriaStrip({ items, cols = 4, layout = 'strip' }: { items: CriterionItem[]; cols?: 2 | 3 | 4; layout?: 'strip' | 'rows' }) {
  if (layout === 'strip') {
    return (
      <ul className={cn('grid grid-cols-2 gap-x-6 gap-y-6', COLS[cols])}>
        {items.map((c) => (
          <li key={c.key} className="min-w-0 space-y-2">
            <p className="type-caption">{c.label}</p>
            <BandNumeral value={c.band} size="standard" />
            <BandMeter band={c.band} target={c.target} label={`${c.label} band`} />
            {c.weakest && <p className="type-caption text-warn-text">Fix first</p>}
            {c.gist && <p className="type-caption line-clamp-2">{c.gist}</p>}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => (
        <li key={c.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-3 py-4 sm:grid-cols-[12rem_3.5rem_minmax(0,1fr)]">
          <div className="min-w-0">
            <h3 className="type-subheading">{c.label}</h3>
            {c.weakest && <p className="type-caption mt-1"><span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn-text">Fix first</span></p>}
          </div>
          <BandNumeral value={c.band} size="standard" className="text-right" />
          <div className="col-span-2 min-w-0 space-y-2 sm:col-span-1">
            <BandMeter band={c.band} target={c.target} label={`${c.label} band`} />
            {c.gist && <p className="type-body max-w-[68ch]">{c.gist}</p>}
            {c.detail && (
              <details className="group">
                <summary className="type-body hit cursor-pointer list-none text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Show details</span>
                  <span className="hidden group-open:inline">Hide details</span>
                </summary>
                <div className="mt-3 space-y-3">{c.detail}</div>
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
