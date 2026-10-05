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

/** Section heading used on every admin page. */
export const Section = ({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) => (
  <section className="mt-10 first:mt-0">
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="type-heading">{title}</h2>
      {aside && <div className="type-caption">{aside}</div>}
    </div>
    {children}
  </section>
);
