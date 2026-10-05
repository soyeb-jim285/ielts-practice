import type { Funnel } from '@server/admin/schemas';
import { createFileRoute } from '@tanstack/react-router';
import { percent } from '@/components/admin/format';
import { Load } from '@/components/admin/Load';
import { BarList } from '@/components/admin/MiniChart';
import { PageContainer, PageHeader, Segmented } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

export const Route = createFileRoute('/_app/admin/funnel')({
  validateSearch: (s: Record<string, unknown>): { days?: 7 | 90 } => ({ days: Number(s.days) === 7 ? 7 : Number(s.days) === 90 ? 90 : undefined }),
  component: FunnelPage,
});

function FunnelPage() {
  const days = Route.useSearch().days ?? 30;
  const navigate = Route.useNavigate();
  const q = useAdmin<Funnel>('/funnel', { days });
  return (
    <PageContainer>
      <PageHeader
        title="Funnel"
        description="Of the people who first appeared in this period, how many started a test, finished one, signed up and came back."
        actions={
          <Segmented
            label="Period"
            value={String(days) as '7' | '30' | '90'}
            onChange={(v) => void navigate({ search: { days: v === '30' ? undefined : (Number(v) as 7 | 90) } })}
            options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]}
          />
        }
      />
      <Load q={q} lines={5}>
        {(f) => (
          <>
            <BarList max={Math.max(1, f.steps[0]?.users ?? 1)} rows={f.steps.map((s) => ({ label: s.label, value: s.users, text: `${s.users} · ${percent(s.pctOfVisited)}` }))} />
            <p className="type-caption mt-8 max-w-[64ch]">
              The group is everyone with a session created in the last {f.days} Dhaka days; guests get one when they start their first test or sign up, so visitors who only browsed are not counted. Started means at least one test, finished means at
              least one completed test, signed up means a real account, returned means active on a later day than the first one.
            </p>
          </>
        )}
      </Load>
    </PageContainer>
  );
}
