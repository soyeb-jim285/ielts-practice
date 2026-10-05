import type { UserRow } from '@server/admin/schemas';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { dhakaTime, userLabel } from '@/components/admin/format';
import { Load } from '@/components/admin/Load';
import { Pager } from '@/components/admin/Pager';
import { type Col, DataTable } from '@/components/admin/Table';
import { Badge, EmptyState, Input, PageContainer, PageHeader, Segmented } from '@/components/ui';
import { type Page, useAdmin } from '@/lib/admin';

type Kind = 'accounts' | 'guests' | 'all';
type Sort = 'created' | 'active';
type Search = { page?: number; q?: string; kind?: Kind; sort?: Sort };

export const Route = createFileRoute('/_app/admin/users/')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    kind: s.kind === 'guests' || s.kind === 'all' ? s.kind : undefined,
    sort: s.sort === 'active' ? 'active' : undefined,
  }),
  component: UsersPage,
});

const cambridgeLabel = (c: UserRow['cambridge']) => (c.allowed ? (c.source === 'granted' ? 'Granted' : 'Server config') : 'No');

const COLS: Col<UserRow>[] = [
  {
    head: 'User',
    cell: (u) => (
      <Link to="/admin/users/$userId" params={{ userId: u.id }} className="break-all underline-offset-4 hover:underline">
        {userLabel(u)}
        {u.isGuest && <Badge className="ml-2">Guest</Badge>}
      </Link>
    ),
  },
  { head: 'Joined (Dhaka)', cell: (u) => <span className="type-num whitespace-nowrap">{dhakaTime(u.createdAt)}</span> },
  { head: 'Last active', cell: (u) => <span className="type-num whitespace-nowrap">{u.lastActiveAt ? dhakaTime(u.lastActiveAt) : '-'}</span> },
  { head: 'Tests S / W / L / R', cell: (u) => <span className="type-num">{u.counts.speaking} / {u.counts.writing} / {u.counts.listening} / {u.counts.reading}</span> },
  { head: 'Recordings', cell: (u) => <span className="type-num">{u.replays}</span> },
  { head: 'Cambridge', cell: (u) => (u.isGuest ? '-' : cambridgeLabel(u.cambridge)) },
];

function UsersPage() {
  const { page = 1, q, kind = 'accounts', sort = 'created' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [text, setText] = useState(q ?? '');
  const query = useAdmin<Page<UserRow>>('/users', { page, q, kind, sort });
  const set = (s: Search) => void navigate({ search: (prev) => ({ ...prev, page: undefined, ...s }) });
  return (
    <PageContainer>
      <PageHeader title="Users" description="Open a user to see their tests, recordings and Cambridge access." />
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <Segmented label="Who" value={kind} onChange={(v) => set({ kind: v === 'accounts' ? undefined : v })} options={[{ value: 'accounts', label: 'Accounts' }, { value: 'guests', label: 'Guests' }, { value: 'all', label: 'All' }]} />
        <Segmented label="Order" value={sort} onChange={(v) => set({ sort: v === 'created' ? undefined : v })} options={[{ value: 'created', label: 'Newest' }, { value: 'active', label: 'Last active' }]} />
        <form
          className="min-w-52 flex-1 sm:max-w-xs"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: text.trim() || undefined });
          }}
        >
          <Input label="Email or name" hideLabel type="search" placeholder="Search email or name" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== (q ?? '') && set({ q: text.trim() || undefined })} />
        </form>
      </div>
      <Load q={query}>
        {(d) =>
          d.items.length ? (
            <>
              <DataTable rows={d.items} cols={COLS} rowKey={(u) => u.id} label="Users" />
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => void navigate({ search: (s) => ({ ...s, page: p > 1 ? p : undefined }) })} />
            </>
          ) : (
            <EmptyState icon={<Users />} title="No users">
              No one matches these filters.
            </EmptyState>
          )
        }
      </Load>
    </PageContainer>
  );
}
