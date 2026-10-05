import type { FeedbackItem, Growth, Health, Overview, SpendForecast, SpendSeries, SpendSummary } from '@server/admin/schemas';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { AttentionList } from '@/components/admin/AttentionList';
import { usdFine } from '@/components/admin/cost';
import { dhakaDay, dhakaTime, percent, userLabel } from '@/components/admin/format';
import { attentionItems, deltaChip, periodDelta } from '@/components/admin/logic';
import { Load, Section } from '@/components/admin/Load';
import { SERIES, TrendChart } from '@/components/admin/MiniChart';
import { StatStrip } from '@/components/admin/StatStrip';
import { FunnelView } from '@/components/admin/Views';
import { PageContainer, Skeleton } from '@/components/ui';
import { type Page, useAdmin } from '@/lib/admin';

export const Route = createFileRoute('/_app/admin/')({ component: Dashboard });

const SKILLS = ['speaking', 'writing', 'listening', 'reading'] as const;
const more = 'text-sm text-accent-text underline-offset-4 hover:underline';

function Dashboard() {
  const overview = useAdmin<Overview>('/overview');
  const growth = useAdmin<Growth>('/growth', { days: 30 });
  const health = useAdmin<Health>('/health');
  const forecast = useAdmin<SpendForecast>('/spend/forecast');
  const costs = useAdmin<{ warnings: string[]; minBalance: number; openrouter: { limit: number | null; remaining: number | null } }>('/costs');
  const summary = useAdmin<SpendSummary>('/spend/summary');
  const spend = useAdmin<SpendSeries>('/spend/series', { days: 14 });
  const feedback = useAdmin<Page<FeedbackItem>>('/feedback', { status: 'new' });
  const o = overview.data;
  const g = growth.data;

  const attention = attentionItems({
    failed24h: health.data?.counts.failed24h ?? 0,
    stuck: health.data?.counts.stuckAnalyzing ?? 0,
    emailFailed24h: health.data?.counts.emailFailed24h ?? 0,
    feedbackNew: o?.feedbackNew ?? 0,
    balanceErrors: health.data?.recentErrors.filter((e) => /402|balance|credit/i.test(e.error)).reduce((a, e) => a + e.count, 0),
    forecast: forecast.data,
    warnings: costs.data?.warnings,
  });
  const ready = !!(o && health.data && forecast.data);

  const kpis = (() => {
    if (!o || !g) return null;
    const act = g.series.map((d) => d.active);
    const su = periodDelta(g.series.map((d) => d.signups));
    const sp = spend.data && summary.data && summary.data.allTime.calls > 0 ? periodDelta(spend.data.points.map((p) => p.house)) : null;
    const finished = SKILLS.reduce((a, s) => a + (o.testsToday[s]?.finished ?? 0), 0);
    const started = SKILLS.reduce((a, s) => a + (o.testsToday[s]?.started ?? 0), 0);
    return [
      { label: 'Active today', value: o.activeUsers.today.accounts + o.activeUsers.today.guests, hint: `${o.activeUsers.today.guests} guests · ${o.activeUsers.d7.accounts + o.activeUsers.d7.guests} in 7 days`, spark: act.slice(-14) },
      { label: 'Sign-ups, 7 days', value: su.cur, delta: deltaChip(su.cur, su.prev, 'vs prev 7d'), spark: g.series.map((d) => d.signups).slice(-14) },
      { label: 'Tests finished today', value: finished, hint: `${started} started` },
      { label: 'Guest to account', value: percent(g.conversion.rate), hint: `30 days · ${g.conversion.converted} of ${g.conversion.guests} guests` },
      sp ? { label: 'Spend, 7 days', value: usdFine(summary.data!.last7d.house), delta: deltaChip(sp.cur, sp.prev, 'vs prev 7d', false, (n) => usdFine(n)), hint: summary.data!.perAttempt.length ? `${usdFine(summary.data!.perAttempt.reduce((a, p) => a + p.avgUsd * p.n, 0) / Math.max(1, summary.data!.perAttempt.reduce((a, p) => a + p.n, 0)))} per finished test` : undefined, spark: spend.data!.points.map((p) => p.house) } : { label: 'Spend, 7 days', value: '-', hint: 'Not recorded yet' },
    ];
  })();

  return (
    <PageContainer>
      <AdminHeader title="Dashboard" description={o && `As of ${dhakaTime(o.generatedAt)} Dhaka time. A day is a Dhaka calendar day.`} />
      <div className="space-y-8">
        <AttentionList items={attention} loading={!ready} />

        {kpis ? <StatStrip items={kpis} /> : <Skeleton className="h-28 w-full" />}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="space-y-8">
          <Section title="Active people" aside="Last 30 days" className="mt-0">
            <Load q={growth} lines={2}>{(d) => <TrendChart title="People who did a test or opened the site" labels={d.series.map((x) => dhakaDay(x.date))} values={d.series.map((x) => x.active)} color={SERIES[0]} height="h-40" />}</Load>
            <p className="mt-3"><Link to="/admin/users" search={{ view: 'growth' }} className={more}>Sign-ups and guests</Link></p>
          </Section>
          <Section title="Tests today" aside="Finished of started" className="mt-0">
            <Load q={overview} lines={2}>
              {(d) => (
                SKILLS.every((s) => !d.testsToday[s]?.started) ? (
                  <p className="text-sm text-muted">No tests started today.</p>
                ) : (
                <ul className="space-y-3">
                  {SKILLS.map((s) => {
                    const t = d.testsToday[s] ?? { started: 0, finished: 0 };
                    return (
                      <li key={s} className="flex items-center gap-3 text-sm">
                        <span className="w-20 capitalize">{s}</span>
                        <span className="h-2 min-w-0 flex-1" aria-hidden>
                          {t.started > 0 && <span className="block h-full rounded-r-[4px] bg-brand" style={{ width: `${Math.max(4, (t.finished / t.started) * 100)}%` }} />}
                        </span>
                        <span className="type-num w-14 text-right font-semibold">{t.started ? `${t.finished} / ${t.started}` : <span className="text-muted">-</span>}</span>
                      </li>
                    );
                  })}
                </ul>
                )
              )}
            </Load>
            <p className="mt-3"><Link to="/admin/activity" className={more}>See activity</Link></p>
          </Section>
          </div>
          <div className="space-y-8">
          <Section title="Funnel" aside="Last 30 days" className="mt-0">
            <FunnelView days={30} compact />
            <p className="mt-3"><Link to="/admin/users" search={{ view: 'funnel' }} className={more}>Funnel details</Link></p>
          </Section>
          <Section title="Spend runway" aside="OpenRouter" className="mt-0">
            <Load q={forecast} lines={2}>
              {(f) => (
                <>
                  <p className="type-num text-2xl font-semibold tracking-tight">{f.remaining == null ? '-' : usdFine(f.remaining)} <span className="text-sm font-normal text-muted">left</span></p>
                  <p className="mt-1 text-sm text-muted">
                    {f.daysLeft == null ? 'No spend recorded in the last 7 days, so there is no runway estimate.' : `About ${Math.floor(f.daysLeft)} days at ${usdFine(f.burnPerDay7d)} a day${f.runsOutOn ? `, runs out ${dhakaDay(f.runsOutOn)}` : ''}.`}
                  </p>
                </>
              )}
            </Load>
            <p className="mt-3"><Link to="/admin/costs" className={more}>Open costs</Link></p>
          </Section>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Section title="Latest feedback" aside={<Link to="/admin/feedback" className={more}>All</Link>} className="mt-0">
            <Load q={feedback} lines={2}>
              {(d) =>
                d.items.length ? (
                  <ul className="divide-y divide-line">
                    {d.items.slice(0, 5).map((f) => (
                      <li key={f.id} className="py-2.5 text-sm">
                        <p className="line-clamp-2">{f.message}</p>
                        <p className="type-caption mt-0.5 truncate">{f.email ?? 'Guest'} · {f.page} · {dhakaTime(f.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No new reports.</p>
                )
              }
            </Load>
          </Section>
          <Section title="Latest failures" aside={<Link to="/admin/health" className={more}>System</Link>} className="mt-0">
            <Load q={health} lines={2}>
              {(h) =>
                h.attempts.length ? (
                  <ul className="divide-y divide-line">
                    {h.attempts.slice(0, 5).map((a) => (
                      <li key={a.id} className="py-2.5 text-sm">
                        <p className="truncate"><span className="capitalize">{a.skill}</span> part {a.part} · {userLabel(a)}</p>
                        <p className="type-caption mt-0.5 truncate">{a.status === 'failed' ? 'Failed' : `Analyzing ${a.ageMin} min`} · {a.error ?? a.stage ?? 'no detail'} · {dhakaTime(a.updatedAt)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Nothing failed or stuck.</p>
                )
              }
            </Load>
          </Section>
        </div>
      </div>
    </PageContainer>
  );
}
