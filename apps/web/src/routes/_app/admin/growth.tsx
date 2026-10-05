import type { Growth } from '@server/admin/schemas';
import { createFileRoute } from '@tanstack/react-router';
import { dhakaDay, percent } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { LineChart } from '@/components/admin/MiniChart';
import { PageContainer, PageHeader, Segmented, Stat } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

export const Route = createFileRoute('/_app/admin/growth')({
  validateSearch: (s: Record<string, unknown>): { days?: 90 } => ({ days: Number(s.days) === 90 ? 90 : undefined }),
  component: GrowthPage,
});

function GrowthPage() {
  const days = Route.useSearch().days ?? 30;
  const navigate = Route.useNavigate();
  const q = useAdmin<Growth>('/growth', { days });
  return (
    <PageContainer>
      <PageHeader
        title="Growth"
        description="Sign-ups, new guests and active people per day."
        actions={
          <Segmented
            label="Period"
            value={String(days) as '30' | '90'}
            onChange={(v) => void navigate({ search: { days: v === '90' ? 90 : undefined } })}
            options={[
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
            ]}
          />
        }
      />
      <Load q={q} lines={3}>
        {(g) => (
          <>
            <LineChart
              labels={g.series.map((d) => dhakaDay(d.date))}
              series={[
                { label: 'Sign-ups', color: 'var(--accent)', values: g.series.map((d) => d.signups) },
                { label: 'New guests', color: 'var(--sky)', values: g.series.map((d) => d.newGuests), dash: '5 3' },
                { label: 'Active', color: 'var(--ink)', values: g.series.map((d) => d.active), dash: '2 3' },
              ]}
            />
            <Section title="Guest to account">
              <dl className="grid grid-cols-3 gap-x-6">
                <Stat label="Guests" value={g.conversion.guests} />
                <Stat label="Signed up" value={g.conversion.converted} />
                <Stat label="Rate" value={percent(g.conversion.rate)} />
              </dl>
              <p className="type-caption mt-4 max-w-[60ch]">Guests who signed up or signed in to an existing account count as converted. Guest data is purged after 30 days, so the 90-day rate is an approximation.</p>
            </Section>
          </>
        )}
      </Load>
    </PageContainer>
  );
}
