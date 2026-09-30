import type { Fix } from '@server/ai/types';
import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui';

/** One "thing to fix next": numbered title, why it limits the band, and a before → after example. Props: fix, n (1-based). */
export function FixCard({ fix, n }: { fix: Fix; n: number }) {
  return (
    <Card className="flex gap-4">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text tabular-nums">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h3 className="text-base font-semibold">{fix.title}</h3>
          <p className="mt-1 text-[0.9375rem] text-muted">{fix.why}</p>
        </div>
        <div className="grid items-center gap-2 rounded-control bg-surface-2 p-3 text-[0.9375rem] sm:grid-cols-[1fr_auto_1fr]">
          <p>
            <span className="sr-only">Before: </span>
            <span className="text-muted line-through decoration-bad/60">{fix.before}</span>
          </p>
          <ArrowRight className="hidden size-4 text-muted sm:block" aria-hidden />
          <p className="font-medium text-good-text">
            <span className="sr-only">After: </span>
            {fix.after}
          </p>
        </div>
      </div>
    </Card>
  );
}
