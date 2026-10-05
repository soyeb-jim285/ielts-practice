import type { UserRow } from '@server/admin/schemas';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { dhakaTime, userLabel } from '@/components/admin/format';
import { Load } from '@/components/admin/Load';
import { Pager } from '@/components/admin/Pager';
import { type Col, DataTable } from '@/components/admin/Table';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { FunnelView, GrowthView } from '@/components/admin/Views';
import { relative } from '@/components/admin/logic';
import { Badge, EmptyState, Input, PageContainer, Segmented, Tabs } from '@/components/ui';
import { type Page, useAdmin } from '@/lib/admin';

type Kind = 'accounts' | 'guests' | 'all';
type Sort = 'created' | 'active';
type View = 'people' | 'growth' | 'funnel';
type Search = { page?: number; q?: string; kind?: Kind; sort?: Sort; view?: View; days?: 7 | 90 };

export const Route = createFileRoute('/_app/admin/users/')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    kind: s.kind === 'guests' || s.kind === 'all' ? s.kind : undefined,
    sort: s.sort === 'active' ? 'active' : undefined,
    view: s.view === 'growth' || s.view === 'funnel' ? s.view : undefined,
    days: Number(s.days) === 7 ? 7 : Number(s.days) === 90 ? 90 : undefined,
  }),
  component: UsersPage,
});

const cambridgeLabel = (c: UserRow['cambridge']) => (c.allowed ? (c.source === 'granted' ? 'Granted' : 'Server config') : 'No');

const when = (iso: string | null) => (iso ? <span className="type-num whitespace-nowrap" title={`${dhakaTime(iso)} Dhaka`}>{relative(iso) ?? dhakaTime(iso)}</span> : <span className="text-muted">never</span>);
const INITIAL = { speaking: 'S', writing: 'W', listening: 'L', reading: 'R' } as const;

const COLS: Col<UserRow>[] = [
  {
    head: 'User',
    className: 'max-w-64',
    cell: (u) => (
      <Link to="/admin/users/$userId" params={{ userId: u.id }} className="flex min-w-0 items-center gap-2 underline-offset-4 hover:underline" title={userLabel(u)}>
        <span className="truncate">{userLabel(u)}</span>
        {u.isGuest && <Badge>Guest</Badge>}
      </Link>
    ),
  },
  { head: 'Joined', cell: (u) => when(u.createdAt) },
  { head: 'Last active', cell: (u) => when(u.lastActiveAt) },
  {
    head: 'Tests',
    cell: (u) => {
      const total = u.counts.speaking + u.counts.writing + u.counts.listening + u.counts.reading;
      if (!total) return <span className="text-muted" aria-label="none">&ndash;</span>;
      return (
        <span className="type-num">
          <span className="font-semibold">{total}</span>
          <span className="type-caption ml-2">{(Object.keys(INITIAL) as (keyof typeof INITIAL)[]).filter((k) => u.counts[k]).map((k) => `${INITIAL[k]} ${u.counts[k]}`).join(' · ')}</span>
        </span>
      );
    },
  },
  { head: 'Recordings', cell: (u) => (u.replays ? <span className="type-num">{u.replays}</span> : <span className="text-muted" aria-label="none">&ndash;</span>) },
  { head: 'Cambridge', cell: (u) => (u.isGuest ? '-' : u.cambridge.allowed ? <Badge tone="accent">{cambridgeLabel(u.cambridge)}</Badge> : <span className="text-muted">No</span>) },
];

function UsersPage() {
  const { page = 1, q, kind = 'accounts', sort = 'created', view = 'people', days } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [text, setText] = useState(q ?? '');
  const query = useAdmin<Page<UserRow>>('/users', { page, q, kind, sort }, { enabled: view === 'people' });
  const set = (s: Search) => void navigate({ search: (prev) => ({ ...prev, page: undefined, ...s }) });
  return (
    <PageContainer>
      <AdminHeader title="Users" description="People, how fast they grow, and where they drop off." />
      <Tabs
        id="users"
        className="mb-6"
        value={view}
        onChange={(v: View) => void navigate({ search: { view: v === 'people' ? undefined : v, days: undefined } })}
        items={[{ value: 'people', label: 'People' }, { value: 'growth', label: 'Growth' }, { value: 'funnel', label: 'Funnel' }]}
      />
      <div role="tabpanel" id="users-panel" aria-labelledby={`users-${view}`}>
      {view !== 'people' && (
        <div className="mb-6">
          <Segmented
            label="Period"
            value={String(days ?? 30) as '7' | '30' | '90'}
            onChange={(v) => void navigate({ search: (s) => ({ ...s, days: v === '30' ? undefined : (Number(v) as 7 | 90) }) })}
            options={view === 'funnel' ? [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }] : [{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }]}
          />
        </div>
      )}
      {view === 'growth' && <GrowthView days={days === 90 ? 90 : 30} />}
      {view === 'funnel' && <FunnelView days={days ?? 30} />}
      {view === 'people' && (<>
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
      </>)}
      </div>
    </PageContainer>
  );
}
