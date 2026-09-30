import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBand } from '@/lib/format';
import { cn } from '@/lib/utils';
import { attemptQuery, type AttemptListItem } from '@/lib/attempt';
import { notAssessed, sessionOverall } from '@/lib/result';

/** Full-test part switcher + session overall (criteria weighted by speaking time). */
export function SessionSwitcher({ sessionId, currentId }: { sessionId: string; currentId: string }) {
  const list = useQuery({
    queryKey: ['attempts', 'speaking', 1],
    queryFn: () => api.get<{ items: AttemptListItem[] }>('/attempts?skill=speaking&page=1'),
  });
  const parts = (list.data?.items ?? []).filter((a) => a.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const details = useQueries({ queries: parts.map((p) => attemptQuery(p.id)) });
  if (parts.length < 2) return null;

  const summary = sessionOverall(details.map((d, i) => ({ result: d.data?.analysis, durationMs: d.data?.durationMs ?? parts[i]!.durationMs })));
  const p1Total = parts.filter((p) => p.part === 1).length;
  let p1 = 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <nav aria-label="Test parts" className="inline-flex flex-wrap gap-1 rounded-md bg-surface-2 p-0.5 ring-1 ring-line ring-inset">
        {parts.map((p, i) => {
          const d = details[i]?.data;
          const label = p.part === 1 && p1Total > 1 ? `P1.${++p1}` : `P${p.part}`;
          const current = p.id === currentId;
          return (
            <Link
              key={p.id}
              to="/speaking/result/$attemptId"
              params={{ attemptId: p.id }}
              search={{ session: sessionId }}
              aria-current={current ? 'page' : undefined}
              title={p.promptTitle}
              className={cn(
                // Same look as Segmented: one raised segment marks the current part.
                'hit type-num inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ease-(--ease-out-expo) md:h-8',
                current ? 'bg-card text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink',
              )}
            >
              {label}
              {d?.status === 'analyzing' ? (
                <LoaderCircle role="img" className="size-4 animate-spin" aria-label="analysing" />
              ) : d?.analysis && !notAssessed(d.analysis) ? (
                <span className="text-muted">{formatBand(d.analysis.overall)}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      {summary && (
        <p className="type-caption type-num">
          Test overall <span className="font-semibold text-ink">{formatBand(summary.band)}</span>
          {summary.scored < parts.length && `, ${summary.scored} of ${parts.length} parts scored`}
        </p>
      )}
    </div>
  );
}
