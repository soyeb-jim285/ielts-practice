import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBand } from '@/lib/format';
import { cn } from '@/lib/utils';
import { attemptQuery, recallSession, type AttemptListItem } from '@/lib/attempt';
import { useAccount } from '@/lib/query';
import { notAssessed, sessionOverall } from '@/lib/result';

/** Full-test part switcher + session overall (criteria weighted by speaking time). */
export function SessionSwitcher({ sessionId, currentId }: { sessionId: string; currentId: string }) {
  const account = !!useAccount();
  const list = useQuery({
    enabled: account, // a guest cannot list attempts: their parts come from this tab's memory of the test it just took
    queryKey: ['attempts', 'speaking', 1],
    queryFn: () => api.get<{ items: AttemptListItem[] }>('/attempts?skill=speaking&page=1'),
  });
  const listed = (list.data?.items ?? []).filter((a) => a.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ids = account ? listed.map((p) => p.id) : recallSession(sessionId);
  const details = useQueries({ queries: ids.map((id) => attemptQuery(id)) });
  const parts = ids.flatMap((id, i) => {
    const l = listed[i];
    const d = details[i]?.data;
    const part = l?.part ?? d?.part;
    return part ? [{ id, part, d, promptTitle: l?.promptTitle ?? d?.prompt.title ?? '', durationMs: l?.durationMs ?? d?.durationMs ?? null }] : [];
  });
  if (parts.length < 2) return null;

  const summary = sessionOverall(parts.map((p) => ({ result: p.d?.analysis, durationMs: p.d?.durationMs ?? p.durationMs })));
  const p1Total = parts.filter((p) => p.part === 1).length;
  let p1 = 0;

  return (
    <div className="space-y-1">
      {/* One lighter row: the test overall leads, then the parts. On a phone the row scrolls sideways instead of wrapping. */}
      <div className="flex items-center gap-x-4 overflow-x-auto [scrollbar-width:none]">
        {summary && (
          <p className="type-body type-num shrink-0 whitespace-nowrap">
            Test overall <span className="type-subheading">{formatBand(summary.band)}</span>
          </p>
        )}
        <nav aria-label="Test parts" className="inline-flex shrink-0 gap-1 rounded-md bg-surface-2 p-0.5 ring-1 ring-line ring-inset">
          {parts.map((p) => {
            const d = p.d;
            const label = p.part === 1 && p1Total > 1 ? `P1.${++p1}` : `P${p.part}`;
            const current = p.id === currentId;
            return (
              <Link
                key={p.id}
                to="/speaking/result/$attemptId"
                params={{ attemptId: p.id }}
                search={{ session: sessionId }}
                aria-current={current ? 'page' : undefined}
                aria-label={p.promptTitle ? `${label}: ${p.promptTitle}` : undefined}
                title={p.promptTitle}
                className={cn(
                  // Same look as Segmented: one raised segment marks the current part.
                  'hit type-body type-num inline-flex h-9 items-center gap-1.5 rounded-sm px-3 transition-[background-color,color,box-shadow] duration-200 ease-(--ease-out-expo) md:h-8',
                  current ? 'bg-card text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink',
                )}
              >
                {label}
                {d?.status === 'analyzing' ? (
                  <LoaderCircle role="img" className="size-4 animate-spin" aria-label="analysing" />
                ) : d?.analysis && !notAssessed(d.analysis) ? (
                  <span className={current ? 'text-ink' : 'text-muted'}>{formatBand(d.analysis.overall)}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
      {summary && summary.scored < parts.length && <p className="type-caption type-num">{summary.scored} of {parts.length} parts scored</p>}
    </div>
  );
}
