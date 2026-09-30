import type { AnalysisResult, CriterionKey } from '@server/ai/types';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Card } from '@/components/ui';
import { formatRange } from '@/lib/format';
import { criterionLabel } from '@/lib/result';
import { BandGauge } from './BandGauge';

/**
 * One card with a 2×2 grid of criteria: gauge, likely range, descriptor quote, summary and evidence quotes.
 * Props: criteria (AnalysisResult.criteria), order (keys to show, e.g. SPEAKING_CRITERIA), target band, deltas (retry comparison).
 */
export function CriteriaGrid({ criteria, order, target, deltas }: { criteria: AnalysisResult['criteria']; order: CriterionKey[]; target: number; deltas?: Partial<Record<CriterionKey, number>> }) {
  const keys = order.filter((k) => criteria[k]);
  return (
    <Card padded={false} className="grid overflow-hidden sm:grid-cols-2">
      {keys.map((k, i) => {
        const c = criteria[k]!;
        const d = deltas?.[k];
        return (
          <section key={k} aria-labelledby={`crit-${k}`} className={`space-y-3 border-line p-5 ${i > 0 ? 'border-t' : ''} ${i === 1 ? 'sm:border-t-0' : ''} ${i % 2 ? 'sm:border-l' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id={`crit-${k}`} className="text-base font-semibold">
                  {criterionLabel(k)}
                </h3>
                <p className="mt-0.5 text-sm text-muted">
                  likely {formatRange(c.range)}
                  {d ? (
                    <span className={`ml-2 inline-flex items-center gap-0.5 font-medium ${d > 0 ? 'text-good-text' : 'text-bad-text'}`}>
                      {d > 0 ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
                      {Math.abs(d)} vs last try
                    </span>
                  ) : null}
                </p>
              </div>
              <BandGauge band={c.band} target={target} label={`${criterionLabel(k)} band`} size={88} />
            </div>
            {c.descriptor && <blockquote className="font-serif text-[0.9375rem] leading-relaxed text-ink/80 italic">“{c.descriptor}”</blockquote>}
            <p className="text-[0.9375rem]">{c.summary}</p>
            {c.evidence.length > 0 && (
              <ul className="space-y-1 text-sm text-muted">
                {c.evidence.map((q) => (
                  <li key={q} className="rounded-control bg-surface-2 px-2.5 py-1.5">
                    “{q}”
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </Card>
  );
}
