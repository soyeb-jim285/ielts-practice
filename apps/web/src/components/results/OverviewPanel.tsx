import { roundBand } from '@ielts/core';
import type { AnalysisResult, CriterionKey } from '@server/ai/types';
import type { ReactNode } from 'react';
import { formatBand } from '@/lib/format';
import { criterionLabel } from '@/lib/result';
import { ComparisonStrip } from './ComparisonStrip';
import { CriteriaGrid } from './CriteriaGrid';
import { FixCard } from './FixCard';

/** Overview tab body shared by speaking and writing: retry comparison, criteria panel, 3 fixes. Props: result, order (criteria keys), target, parentLink, alert (a flag such as off-topic; shown first, only on this tab), capNote (why a cap was applied, e.g. "the essay is off topic"; turns the summary into the cap explanation). */
export function OverviewPanel({ result, order, target, parentLink, alert, capNote }: { result: AnalysisResult; order: CriterionKey[]; target: number; parentLink?: ReactNode; alert?: ReactNode; capNote?: string }) {
  // One line on how the headline number relates to the rows below, so a 6.0 next to a 3.0 does not read as a mistake.
  const bands = order.flatMap((k) => (result.criteria[k] ? [{ k, band: result.criteria[k]!.band }] : []));
  const low = bands.reduce((m, x) => (x.band < m.band ? x : m), bands[0] ?? { k: order[0]!, band: 0 });
  const spread = Math.max(...bands.map((x) => x.band)) - low.band;
  const avg = bands.length ? roundBand(bands.reduce((t, x) => t + x.band, 0) / bands.length) : 0;
  const capped = !!capNote && avg > result.overall;
  return (
    <div className="space-y-10">
      {alert}
      <section>
        <h2 className="type-heading">Band by criterion</h2>
        <p className="type-caption mt-1 mb-4 max-w-[68ch] text-sm">
          {capped ? (
            <>Average of these {bands.length} bands would be {formatBand(avg)}, capped at {formatBand(result.overall)} because {capNote}.</>
          ) : (
            <>
              Overall {formatBand(result.overall)} is the average of these {bands.length} bands, rounded to the nearest half band
              {spread >= 2 ? `, so ${criterionLabel(low.k)} (${formatBand(low.band)}) pulls it down without capping it` : ''}.
            </>
          )}
        </p>
        <CriteriaGrid criteria={result.criteria} order={order} target={target} deltas={result.comparison?.deltas} />
      </section>
      <ComparisonStrip result={result} parentLink={parentLink} />
      {result.topFixes.length > 0 && (
        <section>
          <h2 className="type-heading mb-4">{result.topFixes.length === 1 ? 'One thing to fix next' : `${result.topFixes.length} things to fix next`}</h2>
          <ol className="stagger divide-y divide-line border-y border-line">
            {result.topFixes.map((f, i) => (
              <li key={f.title}>
                <FixCard fix={f} n={i + 1} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
