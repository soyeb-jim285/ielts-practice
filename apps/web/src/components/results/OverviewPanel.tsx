import type { AnalysisResult, CriterionKey } from '@server/ai/types';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui';
import { ComparisonStrip } from './ComparisonStrip';
import { CriteriaGrid } from './CriteriaGrid';
import { FixCard } from './FixCard';

/** Overview tab body shared by speaking and writing: retry comparison, criteria panel, 3 fixes. Props: result, order (criteria keys), target, parentLink. */
export function OverviewPanel({ result, order, target, parentLink }: { result: AnalysisResult; order: CriterionKey[]; target: number; parentLink?: ReactNode }) {
  return (
    <div className="space-y-10">
      <ComparisonStrip result={result} parentLink={parentLink} />
      <section>
        <h2 className="mb-4 text-lg font-semibold">Band by criterion</h2>
        <CriteriaGrid criteria={result.criteria} order={order} target={target} deltas={result.comparison?.deltas} />
      </section>
      {result.topFixes.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">{result.topFixes.length} things to fix next</h2>
          <Card padded={false} className="overflow-hidden">
            <ol className="divide-y divide-line">
              {result.topFixes.map((f, i) => (
                <li key={f.title}>
                  <FixCard fix={f} n={i + 1} />
                </li>
              ))}
            </ol>
          </Card>
        </section>
      )}
    </div>
  );
}
