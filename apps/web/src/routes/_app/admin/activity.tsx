import type { ActivityItem } from '@server/admin/schemas';
import { createFileRoute } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { ActivityTable } from '@/components/admin/ActivityTable';
import { Load } from '@/components/admin/Load';
import { Pager } from '@/components/admin/Pager';
import { EmptyState, Input, PageContainer, PageHeader, Segmented } from '@/components/ui';
import { type Page, useAdmin } from '@/lib/admin';

const SKILLS = ['speaking', 'writing', 'listening', 'reading'] as const;
type Skill = (typeof SKILLS)[number];
type Search = { page?: number; skill?: Skill; q?: string };

export const Route = createFileRoute('/_app/admin/activity')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined,
    skill: SKILLS.find((k) => k === s.skill),
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
  }),
  component: ActivityPage,
});

function ActivityPage() {
  const { page = 1, skill, q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [text, setText] = useState(q ?? '');
  const query = useAdmin<Page<ActivityItem>>('/activity', { page, skill, q });
  const set = (s: Search) => void navigate({ search: (prev) => ({ ...prev, page: undefined, ...s }) });
  return (
    <PageContainer>
      <PageHeader title="Activity" description="Every test, newest first. Open a result or the recording from that time." />
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <Segmented
          label="Skill"
          value={skill ?? 'all'}
          onChange={(v) => set({ skill: v === 'all' ? undefined : v })}
          options={[{ value: 'all' as const, label: 'All' }, ...SKILLS.map((k) => ({ value: k, label: <span className="capitalize">{k}</span> }))]}
        />
        <form
          className="min-w-52 flex-1 sm:max-w-xs"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: text.trim() || undefined });
          }}
        >
          <Input label="Email" hideLabel type="search" placeholder="Search by email" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== (q ?? '') && set({ q: text.trim() || undefined })} />
        </form>
      </div>
      <Load q={query}>
        {(d) =>
          d.items.length ? (
            <>
              <ActivityTable items={d.items} />
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => void navigate({ search: (s) => ({ ...s, page: p > 1 ? p : undefined }) })} />
            </>
          ) : (
            <EmptyState icon={<Users />} title="Nothing here">
              No tests match these filters.
            </EmptyState>
          )
        }
      </Load>
    </PageContainer>
  );
}
