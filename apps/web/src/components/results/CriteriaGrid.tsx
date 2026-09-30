import type { AnalysisResult, CriterionKey } from '@server/ai/types';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui';
import { formatRange } from '@/lib/format';
import { criterionLabel, splitFirstSentence } from '@/lib/result';
import { BandGauge } from './BandGauge';

/**
 * One card with a 2×2 grid of criteria: gauge, likely range, descriptor quote, summary and evidence quotes.
 * Phones get the band, range and first sentence; the rest sits behind "Show evidence" (open, summary hidden, from sm up).
 * Props: criteria (AnalysisResult.criteria), order (keys to show, e.g. SPEAKING_CRITERIA), target band, deltas (retry comparison).
 */
export function CriteriaGrid({ criteria, order, target, deltas }: { criteria: AnalysisResult['criteria']; order: CriterionKey[]; target: number; deltas?: Partial<Record<CriterionKey, number>> }) {
  const keys = order.filter((k) => criteria[k]);
  // ponytail: read once per render; resizing across 640px keeps the initial open state.
  const wide = globalThis.matchMedia?.('(min-width: 640px)').matches ?? true;
  return (
    <Card padded={false} className="grid overflow-hidden sm:grid-cols-2">
      {keys.map((k, i) => {
        const c = criteria[k]!;
        const d = deltas?.[k];
        const [first, rest] = splitFirstSentence(c.summary);
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
            <p className="text-[0.9375rem]">
              {first}
              {rest && <span className="max-sm:hidden"> {rest}</span>}
            </p>
            {(c.descriptor || c.evidence.length > 0 || rest) && (
              <details open={wide} className="group">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent-text select-none sm:hidden [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Show evidence</span>
                  <span className="hidden group-open:inline">Hide evidence</span>
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="mt-3 space-y-3 sm:mt-0">
                  {rest && <p className="text-[0.9375rem] sm:hidden">{rest}</p>}
                  {c.descriptor && <blockquote className="font-serif text-[0.9375rem] leading-relaxed text-ink/80 italic">“{c.descriptor}”</blockquote>}
                  {c.evidence.length > 0 && (
                    <ul className="space-y-1 text-sm text-muted">
                      {c.evidence.map((q) => (
                        <li key={q} className="rounded-control bg-surface-2 px-2.5 py-1.5">
                          “{q}”
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            )}
          </section>
        );
      })}
    </Card>
  );
}
