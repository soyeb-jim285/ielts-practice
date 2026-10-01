import type { AnalysisResult, CriterionKey } from '@server/ai/types';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import { Badge, buttonStyles, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui';
import { formatBand, formatRange } from '@/lib/format';
import { criterionLabel, pronunciationUnsupported } from '@/lib/result';
import { BandBar } from './BandBar';

/**
 * One panel, one row per criterion: name, band and range on the left; meter against the target (full column width), reason, and the evidence quotes plus band descriptor behind a disclosure.
 * The learner's own words (evidence) are set in the reading serif; the interface's words stay in the sans.
 * Props: criteria (AnalysisResult.criteria), order (keys to show, e.g. SPEAKING_CRITERIA), target band, deltas (retry comparison).
 */
export function CriteriaGrid({ criteria, order, target, deltas }: { criteria: AnalysisResult['criteria']; order: CriterionKey[]; target: number; deltas?: Partial<Record<CriterionKey, number>> }) {
  const keys = order.filter((k) => criteria[k]);
  return (
    <div className="space-y-4">
      <div className="stagger divide-y divide-line border-y border-line">
        {keys.map((k) => {
          const c = criteria[k]!;
          const d = deltas?.[k];
          const name = criterionLabel(k);
          const soft = pronunciationUnsupported(criteria, k);
          const [lo, hi] = soft ? ([Math.max(0, Math.min(c.range[0], c.band - 1.5)), Math.min(9, Math.max(c.range[1], c.band + 1.5))] as const) : c.range;
          return (
            <section key={k} aria-labelledby={`crit-${k}`} className="grid gap-x-10 gap-y-3 py-6 md:grid-cols-[15rem_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 id={`crit-${k}`} className="type-subheading">
                    {name}
                  </h3>
                  <p className="type-band text-4xl">{formatBand(c.band)}</p>
                </div>
                <p className="type-caption type-num">
                  likely {formatRange([lo, hi])}
                  {d ? (
                    <span className={`ml-2 inline-flex items-center gap-0.5 font-medium ${d > 0 ? 'text-good-text' : 'text-bad-text'}`}>
                      {d > 0 ? <ArrowUp className="size-4" aria-hidden /> : <ArrowDown className="size-4" aria-hidden />}
                      {Math.abs(d)} vs last try
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="min-w-0 space-y-3">
                <BandBar band={c.band} target={target} label={`${name} band`} />
                {soft && (
                  <Badge tone="warn" title="The pronunciation band comes from the audio alone. Halting or very short speech is hard to judge, so treat it as a rough guide.">
                    Audio check only, low confidence
                  </Badge>
                )}
                <p className="type-body max-w-[60ch]">{c.summary}</p>
                {(c.descriptor || c.evidence.length > 0) && (
                  <Collapsible className="group max-w-[60ch]">
                    <CollapsibleTrigger className={buttonStyles({ variant: 'link', className: 'hit -ml-0.5' })}>
                      <span className="group-data-[state=open]:hidden">Show evidence</span>
                      <span className="hidden group-data-[state=open]:inline">Hide evidence</span>
                      <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 pt-3">
                      {c.evidence.length > 0 && (
                        <ul className="space-y-1.5">
                          {c.evidence.map((q) => (
                            <li key={q} className="type-reading-sm rounded-md bg-surface-2 px-3 py-2">
                              {'“'}
                              {q}
                              {'”'}
                            </li>
                          ))}
                        </ul>
                      )}
                      {c.descriptor && (
                        <p className="type-caption">
                          <span className="font-medium text-ink">Band descriptor: </span>
                          {c.descriptor}
                        </p>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <p className="type-caption">Your target band is {formatBand(target)}.</p>
    </div>
  );
}
