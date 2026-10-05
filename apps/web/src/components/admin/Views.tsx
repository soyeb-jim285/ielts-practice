import type { Funnel, Growth } from '@server/admin/schemas';
import { Info } from 'lucide-react';
import { useAdmin } from '@/lib/admin';
import { dhakaDay, percent } from './format';
import { funnelRows } from './logic';
import { Load, Section } from './Load';
import { BarList, SERIES, TrendChart } from './MiniChart';

/** Sign-ups, new guests and active people, each on its own scale so one spike cannot flatten the others. */
export function GrowthView({ days }: { days: number }) {
  const q = useAdmin<Growth>('/growth', { days });
  return (
    <Load q={q} lines={3}>
      {(g) => {
        const labels = g.series.map((d) => dhakaDay(d.date));
        return (
          <>
            <div className="space-y-14">
              <TrendChart title="Active people per day" labels={labels} values={g.series.map((d) => d.active)} color={SERIES[0]} summary={`peak ${Math.max(0, ...g.series.map((d) => d.active))}`} />
              <TrendChart title="Sign-ups per day" labels={labels} values={g.series.map((d) => d.signups)} color={SERIES[0]} summary={`${g.series.reduce((a, d) => a + d.signups, 0)} in ${labels.length} days`} />
              <TrendChart title="New guests per day" labels={labels} values={g.series.map((d) => d.newGuests)} color={SERIES[1]} summary={`${g.series.reduce((a, d) => a + d.newGuests, 0)} in ${labels.length} days`} />
            </div>
            <Section title="Guest to account" className="mt-10">
              <p className="max-w-[60ch] text-sm">
                <span className="type-num font-semibold">{g.conversion.guests}</span> guests, <span className="type-num font-semibold">{g.conversion.converted}</span> signed up (<span className="type-num font-semibold">{percent(g.conversion.rate)}</span>). Guest data is purged after 30 days, so the 90-day rate is an approximation.
              </p>
            </Section>
          </>
        );
      }}
    </Load>
  );
}

/** Funnel as stepped bars with no track, the conversion from the step above written under each, and a note when a step is larger than the one before (the groups are not nested). */
export function FunnelView({ days, compact }: { days: number; compact?: boolean }) {
  const q = useAdmin<Funnel>('/funnel', { days });
  return (
    <Load q={q} lines={5}>
      {(f) => {
        const rows = funnelRows(f.steps);
        const first = Math.max(1, rows[0]?.users ?? 1);
        const odd = rows.some((r) => r.notNested);
        return (
          <>
            <BarList
              max={first}
              rows={rows.map((s) => ({
                key: s.label,
                label: s.label,
                value: s.users,
                text: `${s.users} · ${percent(s.users / first)}`,
                hint: s.fromPrev == null ? undefined : s.notNested ? 'More than the step above: these groups are not nested.' : `${percent(s.fromPrev)} of the step above`,
              }))}
            />
            {odd && (
              <p className="mt-4 flex max-w-[64ch] items-start gap-2 text-xs text-muted">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" /> Signed up counts accounts created in the period, including people who never started a test, so it can be larger than Started.
              </p>
            )}
            {!compact && (
              <p className="type-caption mt-6 max-w-[64ch]">
                The group is everyone with a session created in the last {f.days} Dhaka days; guests get one when they start their first test or sign up, so visitors who only browsed are not counted. Started means at least one test, finished means at least one completed test, signed up means a
                real account, returned means active on a later day than the first one.
              </p>
            )}
          </>
        );
      }}
    </Load>
  );
}

