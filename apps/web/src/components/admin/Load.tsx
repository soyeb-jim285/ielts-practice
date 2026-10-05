import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Alert, Skeleton } from '@/components/ui';

/** Loading skeleton, error alert, or the data: every admin page body goes through it. */
export function Load<T>({ q, children, lines = 3 }: { q: UseQueryResult<T>; children: (data: T) => ReactNode; lines?: number }) {
  if (q.isError && !q.data) return <Alert tone="bad">Couldn't load this. Reload the page to try again.</Alert>;
  if (!q.data)
    return (
      <div className="space-y-3" aria-busy>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  return <>{children(q.data)}</>;
}

/** Section heading used on every admin page: quiet sans heading over a hairline, so the numbers below stay the loudest thing. */
export const Section = ({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`mt-8 min-w-0 first:mt-0 ${className ?? ''}`}>
    <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-line pb-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {aside && <div className="type-caption">{aside}</div>}
    </div>
    {children}
  </section>
);
