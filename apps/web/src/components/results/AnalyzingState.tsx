import type { AnalysisStage } from '@server/ai/types';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, Skeleton } from '@/components/ui';
import { attemptQuery } from '@/lib/attempt';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FixCard } from './FixCard';

const STAGE_LABEL: Record<AnalysisStage, string> = {
  transcribing: 'Transcribing your recording',
  analyzing: 'Analysing fluency, grammar and vocabulary',
  feedback: 'Marking mistakes and writing your fixes',
  scoring: 'Scoring against the band descriptors',
  finalizing: 'Finishing up',
};
const STAGES = { writing: ['feedback', 'scoring', 'finalizing'], speaking: ['transcribing', 'analyzing', 'finalizing'] } as const;

/**
 * Shown while an attempt is `analyzing` (the page polls). The steps are the server's real pipeline stages (from the attempt query
 * of the current route); `steps` is the fallback, advancing on an estimated schedule, until the first stage arrives. Writing
 * feedback that is ready before the scores (`partial`: top fixes, marked mistakes) shows below the steps; otherwise a shimmer
 * skeleton in the shape of the result, so the page does not jump when it lands.
 * Props: steps (fallback labels in order), stepSeconds (estimate per fallback step, default 8), title.
 */
export function AnalyzingState({ steps, stepSeconds = 8, title = 'Analysing your answer' }: { steps: string[]; stepSeconds?: number; title?: string }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const { attemptId } = useParams({ strict: false });
  const { data } = useQuery({ ...attemptQuery(attemptId ?? ''), enabled: !!attemptId });
  const stage = data?.stage;
  const stages: readonly AnalysisStage[] = data && stage ? STAGES[data.skill] : [];
  const real = stage ? stages.indexOf(stage) : -1;
  const labels = real >= 0 ? stages.map((k) => STAGE_LABEL[k]) : steps;
  const active = real >= 0 ? real : Math.min(steps.length - 1, Math.floor(t / stepSeconds));
  const partial = data?.partial;
  return (
    <div className="space-y-8" aria-busy>
      <Card className="max-w-xl">
        <h2 className="type-heading">{title}</h2>
        <p className="type-caption mt-1" aria-live="polite">
          {t >= 45 ? "Taking longer than usual. You can leave this page; we'll keep working and the result will be in your history." : 'Usually under a minute. You can leave this page; the result will be in your history.'}
        </p>
        <ol className="mt-5 space-y-3" aria-live="polite">
          {labels.map((s, i) => (
            <li key={s} className={cn('flex items-center gap-3 text-body', i > active && 'text-muted')} aria-current={i === active ? 'step' : undefined}>
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-md ring-1 ring-inset', i < active ? 'bg-good-soft text-good-text ring-good/15' : i === active ? 'bg-brand-soft text-brand-text ring-brand/15' : 'bg-surface-2 ring-line')}>
                {i < active ? <Check role="img" className="size-4" aria-label="done" /> : i === active ? <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-label="in progress" /> : null}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </Card>
      {partial ? (
        <section className="space-y-4">
          <div>
            <h2 className="type-heading">Your feedback is ready</h2>
            <p className="type-caption mt-1">
              {plural(partial.errors.length, 'mistake')} marked. The band scores are still being checked and will appear here.
            </p>
          </div>
          {partial.topFixes.length > 0 && (
            <ol className="divide-y divide-line border-y border-line">
              {partial.topFixes.map((f, i) => (
                <li key={f.title}>
                  <FixCard fix={f} n={i + 1} />
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        <div className="space-y-4" aria-hidden>
          <Skeleton className="h-5 w-40" />
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid gap-x-12 gap-y-3 px-5 py-5 md:grid-cols-[14rem_minmax(0,1fr)] md:px-6 md:py-6">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-9 w-16" />
                  <Skeleton className="h-1.5 w-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full max-w-[60ch]" />
                  <Skeleton className="h-4 w-4/5 max-w-[48ch]" />
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
