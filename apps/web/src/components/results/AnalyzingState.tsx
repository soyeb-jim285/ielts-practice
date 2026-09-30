import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Shown while an attempt is `analyzing` (the page polls). Steps advance on an estimated schedule since the server reports no
 * per-step progress. Below the steps, a shimmer skeleton in the shape of the result, so the page does not jump when it lands.
 * Props: steps (labels in order), stepSeconds (estimate per step, default 8), title.
 */
export function AnalyzingState({ steps, stepSeconds = 8, title = 'Analysing your answer' }: { steps: string[]; stepSeconds?: number; title?: string }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const active = Math.min(steps.length - 1, Math.floor(t / stepSeconds));
  return (
    <div className="space-y-8" aria-busy>
      <Card className="max-w-xl">
        <h2 className="type-heading">{title}</h2>
        <p className="type-caption mt-1" aria-live="polite">
          {t >= 45 ? "Taking longer than usual. You can leave this page; we'll keep working and the result will be in your history." : 'Usually under a minute. You can leave this page; the result will be in your history.'}
        </p>
        <ol className="mt-5 space-y-3" aria-live="polite">
          {steps.map((s, i) => (
            <li key={s} className={cn('flex items-center gap-3 text-body', i > active && 'text-muted')} aria-current={i === active ? 'step' : undefined}>
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-md ring-1 ring-inset', i < active ? 'bg-good-soft text-good-text ring-good/15' : i === active ? 'bg-brand-soft text-brand-text ring-brand/15' : 'bg-surface-2 ring-line')}>
                {i < active ? <Check role="img" className="size-4" aria-label="done" /> : i === active ? <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-label="in progress" /> : null}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </Card>
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
    </div>
  );
}
