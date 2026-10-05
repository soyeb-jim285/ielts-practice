import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Video } from 'lucide-react';
import { dhakaTime, type ReplayItem } from '@/components/admin/ReplayPlayer';
import { listStyles, rowStyles } from '@/components/bank/ListRow';
import { Alert, Button, EmptyState, PageContainer, PageHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatClock } from '@/lib/format';

const SIZE = 25;
export const Route = createFileRoute('/_app/admin/replays/')({
  validateSearch: (s: Record<string, unknown>): { userId?: string; page?: number } => ({
    userId: typeof s.userId === 'string' ? s.userId : undefined,
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  component: Replays,
});

function Replays() {
  const { userId, page = 1 } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, isError, isPending } = useQuery({
    queryKey: ['admin', 'replays', { userId, page }],
    queryFn: () => api.get<{ items: ReplayItem[]; total: number }>(`/admin/replays?page=${page}&pageSize=${SIZE}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / SIZE));
  return (
    <PageContainer>
      <PageHeader title="Recordings" description={userId ? 'One user only.' : 'Session recordings, kept for 14 days.'} />
      {isError ? (
        <Alert tone="bad">Couldn't load recordings.</Alert>
      ) : isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !data.items.length ? (
        <EmptyState icon={<Video />} title="No recordings yet">
          Recordings appear here after people use the site.
        </EmptyState>
      ) : (
        <>
          <ul className={listStyles}>
            {data.items.map((r) => (
              <li key={r.id}>
                <Link to="/admin/replays/$sessionId" params={{ sessionId: r.id }} className={rowStyles}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.email ?? (r.userId ? `Guest ${r.userId.slice(0, 6)}` : 'Deleted user')}</span>
                    <span className="type-caption type-num block">
                      {dhakaTime(r.startedAt)} · {formatClock(Math.round(r.durationS))} · {r.pages.length} pages · {(r.bytes / 1024).toFixed(0)} KB
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav className="mt-6 flex items-center justify-between" aria-label="Pages">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => void navigate({ search: (s) => ({ ...s, page: page - 1 }) })}>
                Newer
              </Button>
              <span className="type-caption type-num">
                {page} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => void navigate({ search: (s) => ({ ...s, page: page + 1 }) })}>
                Older
              </Button>
            </nav>
          )}
        </>
      )}
    </PageContainer>
  );
}
