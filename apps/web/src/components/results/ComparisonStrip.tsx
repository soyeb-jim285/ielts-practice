import type { AnalysisResult } from '@server/ai/types';
import { ArrowDown, ArrowRight, ArrowUp, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatBand } from '@/lib/format';
import { criterionLabel } from '@/lib/result';

const Delta = ({ d }: { d: number }) =>
  d > 0 ? (
    <span className="inline-flex items-center gap-0.5 text-good-text">
      <ArrowUp className="size-3.5" aria-label="up" />+{d}
    </span>
  ) : d < 0 ? (
    <span className="inline-flex items-center gap-0.5 text-bad-text">
      <ArrowDown className="size-3.5" aria-label="down" />
      {d}
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-muted">
      <Minus className="size-3.5" aria-label="no change" />0
    </span>
  );

/** Retry comparison: previous overall → this overall, plus per-criterion deltas. Props: result (with .comparison), parentLink (e.g. a Link to the parent result). */
export function ComparisonStrip({ result, parentLink }: { result: AnalysisResult; parentLink?: ReactNode }) {
  const c = result.comparison;
  if (!c) return null;
  const overall = result.overall - c.parentOverall;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card bg-surface-2 px-5 py-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <span className="text-muted">Last try</span>
        <span className="tabular-nums">{formatBand(c.parentOverall)}</span>
        <ArrowRight className="size-4 text-muted" aria-label="to" />
        <span className="tabular-nums">{formatBand(result.overall)}</span>
        <Delta d={overall} />
      </p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {Object.entries(c.deltas).map(([k, d]) => (
          <li key={k} className="flex items-center gap-1.5 tabular-nums">
            <span className="text-muted">{criterionLabel(k)}</span>
            <Delta d={d!} />
          </li>
        ))}
      </ul>
      {parentLink && <div className="ml-auto">{parentLink}</div>}
    </div>
  );
}
