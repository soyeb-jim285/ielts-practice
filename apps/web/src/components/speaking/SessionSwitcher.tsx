import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBand } from '@/lib/format';
import { attemptQuery, notAssessed, sessionOverall, type AttemptListItem } from '@/lib/result';

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
      <nav aria-label="Test parts" className="flex flex-wrap gap-1.5">
        {parts.map((p, i) => {
          const d = details[i]?.data;
          const label = p.part === 1 && p1Total > 1 ? `P1·${++p1}` : `P${p.part}`;
          const current = p.id === currentId;
          return (
            <Link
              key={p.id}
              to="/speaking/result/$attemptId"
              params={{ attemptId: p.id }}
              search={{ session: sessionId }}
              aria-current={current ? 'page' : undefined}
              title={p.promptTitle}
              className={clsx(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium tabular-nums transition-colors duration-150',
                current ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
              )}
            >
              {label}
              {d?.status === 'analyzing' ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-label="analysing" />
              ) : d?.analysis && !notAssessed(d.analysis) ? (
                <span className="opacity-70">{formatBand(d.analysis.overall)}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      {summary && (
        <p className="text-sm text-muted">
          Test overall <span className="font-semibold text-ink tabular-nums">{formatBand(summary.band)}</span>
          {summary.scored < parts.length && ` · ${summary.scored} of ${parts.length} parts scored`}
        </p>
      )}
    </div>
  );
}
