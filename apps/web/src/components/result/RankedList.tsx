import type { ReactNode } from 'react';
import { ProgressBar } from '@/components/ui';

export type RankedRow = { label: string; right: number; total: number; hint?: ReactNode; onClick?: () => void };

/** Sort worst-first (accuracy: lowest right/total; count: highest count) and, unless `showFull`, collapse perfect rows (accuracy only) into one summary. Pure for testing. */
export function rankRows(rows: RankedRow[], mode: 'accuracy' | 'count', showFull?: boolean) {
  const ratio = (r: RankedRow) => (r.total ? r.right / r.total : 1);
  const sorted = [...rows].sort((a, b) => (mode === 'accuracy' ? ratio(a) - ratio(b) : b.right - a.right));
  const perfect = mode === 'accuracy' && !showFull ? sorted.filter((r) => r.right >= r.total) : [];
  const shown = sorted.filter((r) => !perfect.includes(r));
  const max = Math.max(...shown.map((r) => r.right), 0);
  const bars = mode === 'accuracy' ? true : new Set(shown.map((r) => r.right)).size > 1;
  return { shown, perfect, max, bars };
}

/** Colour ranks: only the two worst rows below 85% are flagged (red under half, else amber); everything else stays neutral so the colour means "look here". */
export const barTone = (ratio: number, rank: number) => (rank < 2 && ratio < 0.85 ? (ratio < 0.5 ? 'bad' : 'warn') : 'neutral');

/** Ranked rows with a fixed figure column. Accuracy: "4 of 5" and marks lost, thin bar only for imperfect rows. Count: the count, bar only when counts differ. */
export function RankedList({ rows, mode, showFull }: { rows: RankedRow[]; mode: 'accuracy' | 'count'; showFull?: boolean }) {
  const { shown, perfect, max, bars } = rankRows(rows, mode, showFull);
  return (
    <div>
      <ul className="divide-y divide-line">
        {shown.map((r, i) => {
          const lost = r.total - r.right;
          const label = r.onClick ? (
            <button type="button" onClick={r.onClick} className="type-body hit text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {r.label}
            </button>
          ) : (
            <span className="type-body">{r.label}</span>
          );
          return (
            <li key={r.label} className="py-3">
              <div className="flex items-baseline gap-4">
                <div className="min-w-0 flex-1">{label}</div>
                {mode === 'accuracy' && lost > 0 && <span className="type-body type-num text-muted">−{lost}</span>}
                <span className="type-body type-num w-16 text-right font-semibold">{mode === 'accuracy' ? `${r.right} of ${r.total}` : r.right}</span>
              </div>
              {bars && (r.right < r.total || mode === 'count') && (
                <ProgressBar className="mt-2" value={mode === 'accuracy' ? r.right / r.total : max ? r.right / max : 0} tone={mode === 'accuracy' ? barTone(r.right / r.total, i) : 'neutral'} label={`${r.label}: ${r.right}${mode === 'accuracy' ? ` of ${r.total}` : ''}`} />
              )}
              {r.hint && <p className="type-caption mt-1">{r.hint}</p>}
            </li>
          );
        })}
      </ul>
      {perfect.length > 0 && <p className="type-body border-t border-line pt-3">{perfect.length === 1 ? `${perfect[0]!.label}: all right` : `${perfect[0]!.label} and ${perfect.length - 1} ${perfect.length === 2 ? 'other' : 'others'}: all right`}</p>}
    </div>
  );
}
