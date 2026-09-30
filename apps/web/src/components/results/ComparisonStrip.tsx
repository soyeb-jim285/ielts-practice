import type { AnalysisResult } from '@server/ai/types';
import { ArrowDown, ArrowRight, ArrowUp, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatBand } from '@/lib/format';
import { criterionLabel } from '@/lib/result';

const Delta = ({ d }: { d: number }) =>
  d > 0 ? (
    <span className="inline-flex items-center gap-0.5 font-medium text-good-text">
      <ArrowUp role="img" className="size-4" aria-label="up" />+{d}
    </span>
  ) : d < 0 ? (
    <span className="inline-flex items-center gap-0.5 font-medium text-bad-text">
      <ArrowDown role="img" className="size-4" aria-label="down" />
      {`−${Math.abs(d)}`}
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-muted">
      <Minus role="img" className="size-4" aria-label="no change" />0
    </span>
  );

/** Retry comparison: previous overall to this overall, plus per-criterion deltas. Props: result (with .comparison), parentLink (e.g. a Link to the parent result). */
export function ComparisonStrip({ result, parentLink }: { result: AnalysisResult; parentLink?: ReactNode }) {
  const c = result.comparison;
  if (!c) return null;
  const overall = Math.round((result.overall - c.parentOverall) * 10) / 10;
  return (
    <div className="type-num flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg bg-surface-2 px-5 py-3.5 text-sm">
      <p className="flex items-center gap-2.5">
        <span className="text-muted">Last try</span>
        <span className="font-semibold">{formatBand(c.parentOverall)}</span>
        <ArrowRight role="img" className="size-4 text-muted" aria-label="to" />
        <span className="font-semibold">{formatBand(result.overall)}</span>
        <Delta d={overall} />
      </p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {Object.entries(c.deltas).map(([k, d]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="text-muted">{criterionLabel(k)}</span>
            <Delta d={d!} />
          </li>
        ))}
      </ul>
      {parentLink && <div className="ml-auto">{parentLink}</div>}
    </div>
  );
}
