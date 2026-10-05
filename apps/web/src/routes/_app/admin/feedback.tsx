import type { FeedbackItem } from '@server/admin/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { dhakaTime } from '@/components/admin/format';
import { Load } from '@/components/admin/Load';
import { Pager } from '@/components/admin/Pager';
import { Badge, EmptyState, PageContainer, Segmented, toast, type Tone } from '@/components/ui';
import { type Page, useAdmin } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';

type Status = FeedbackItem['status'];
type Filter = Status | 'all';
const FILTERS = ['all', 'new', 'seen', 'done'] as const;
const TONE: Record<Status, Tone> = { new: 'accent', seen: 'neutral', done: 'good' };

export const Route = createFileRoute('/_app/admin/feedback')({
  validateSearch: (s: Record<string, unknown>): { status?: Status; page?: number } => ({
    status: s.status === 'new' || s.status === 'seen' || s.status === 'done' ? s.status : undefined,
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
  }),
  component: FeedbackPage,
});

function Item({ f }: { f: FeedbackItem }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (status: Status) => api.patch<FeedbackItem>(`/admin/feedback/${f.id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not update.', { tone: 'bad' }),
  });
  return (
    <li className="py-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Badge tone={TONE[f.status]}>{f.status}</Badge>
        <span className="type-num text-muted">{dhakaTime(f.createdAt)}</span>
        {f.userId ? (
          <Link to="/admin/users/$userId" params={{ userId: f.userId }} className="break-all underline-offset-4 hover:underline">
            {f.email ?? `Guest ${f.userId.slice(0, 6)}`}
          </Link>
        ) : (
          <span className="text-muted">Visitor</span>
        )}
      </div>
      <p className="mt-2 break-words whitespace-pre-wrap">{f.message}</p>
      <p className="type-caption mt-2 break-all">
        On {f.page}
        {f.userAgent && <span className="block truncate">{f.userAgent}</span>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Segmented size="sm" label="Status" value={f.status} onChange={(v) => m.mutate(v)} options={[{ value: 'new', label: 'New' }, { value: 'seen', label: 'Seen' }, { value: 'done', label: 'Done' }]} />
        {f.replaySessionId && (
          <Link to="/admin/replays/$sessionId" params={{ sessionId: f.replaySessionId }} className="text-sm text-accent-text underline-offset-4 hover:underline">
            Watch the recording
          </Link>
        )}
      </div>
    </li>
  );
}

function FeedbackPage() {
  const { status = 'all', page = 1 } = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useAdmin<Page<FeedbackItem>>('/feedback', { status, page });
  return (
    <PageContainer>
      <AdminHeader
        title="Feedback"
        description="Problems people reported, new ones first."
        actions={<Segmented label="Show" value={status as Filter} onChange={(v) => void navigate({ search: { status: v === 'all' ? undefined : v } })} options={FILTERS.map((v) => ({ value: v, label: <span className="capitalize">{v}</span> }))} />}
      />
      <Load q={q}>
        {(d) =>
          d.items.length ? (
            <>
              <ul className="divide-y divide-line border-y border-line">
                {d.items.map((f) => (
                  <Item key={f.id} f={f} />
                ))}
              </ul>
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => void navigate({ search: (s) => ({ ...s, page: p > 1 ? p : undefined }) })} />
            </>
          ) : (
            <EmptyState icon={<Inbox />} title="Nothing here">
              No reports{status === 'all' ? ' yet' : ` marked ${status}`}.
            </EmptyState>
          )
        }
      </Load>
    </PageContainer>
  );
}
