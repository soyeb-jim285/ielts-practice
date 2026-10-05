import type { Costs, SpendBy, SpendForecast, SpendSeries, SpendSummary, SpendWaste } from '@server/admin/schemas';
import { createFileRoute } from '@tanstack/react-router';
import { Wallet } from 'lucide-react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { stageLabel, trackedSince, usdFine, WASTE_LABEL } from '@/components/admin/cost';
import { dhakaDay, dhakaTime, num, usd } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { BarList, ColumnChart, SERIES } from '@/components/admin/MiniChart';
import { StatStrip } from '@/components/admin/StatStrip';
import { DataTable } from '@/components/admin/Table';
import { Alert, Badge, EmptyState, PageContainer, ProgressBar, Segmented, Stat, type Tone } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

type Dim = SpendBy['dim'];
type PaidBy = 'house' | 'own_key' | 'all';
type Search = { days?: 7 | 90; paidBy?: 'own_key' | 'all'; dim?: Exclude<Dim, 'provider'> };
const DIMS = ['stage', 'model', 'skill_part', 'user', 'prompt'] as const;
const DIM_LABEL = { stage: 'Stage', model: 'Model', skill_part: 'Skill and part', user: 'User', prompt: 'Test' };

export const Route = createFileRoute('/_app/admin/costs')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    days: Number(s.days) === 7 ? 7 : Number(s.days) === 90 ? 90 : undefined,
    paidBy: s.paidBy === 'own_key' || s.paidBy === 'all' ? s.paidBy : undefined,
    dim: DIMS.find((d) => d === s.dim && d !== 'stage'),
  }),
  component: CostsPage,
});

const WARN: Record<Costs['openrouter']['warn'], { tone: Tone; label: string }> = { ok: { tone: 'good', label: 'OK' }, low: { tone: 'warn', label: 'Low' }, critical: { tone: 'bad', label: 'Critical' } };
const Warn = ({ w }: { w: Costs['openrouter']['warn'] }) => <Badge tone={WARN[w].tone}>{WARN[w].label}</Badge>;
/** One point per Dhaka day for the whole period, so days with no spend show as empty and the axis matches the filter. */
function fillDays(points: SpendSeries['points'], days: number) {
  const end = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()) + 'T00:00:00Z');
  const by = new Map(points.map((p) => [p.date, p]));
  return Array.from({ length: days }, (_, k) => {
    const date = new Date(end.getTime() - (days - 1 - k) * 86_400_000).toISOString().slice(0, 10);
    return by.get(date) ?? { date, house: 0, ownKey: 0, calls: 0 };
  });
}
const grid = 'grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-3';

/** The headline: how long the money lasts, not just how much is left. Never a green OK when the days are short. */
function Runway({ f, c }: { f: SpendForecast; c: Costs }) {
  const tone: Tone = f.status === 'critical' ? 'bad' : f.status === 'low' || c.openrouter.warn !== 'ok' ? 'warn' : f.status === 'ok' ? 'good' : 'neutral';
  const word = f.status === 'unknown' ? 'No estimate' : f.status === 'ok' ? 'Enough' : f.status === 'low' ? 'Low' : 'Critical';
  return (
    <Alert tone={tone} title={<span className="flex flex-wrap items-center gap-2">OpenRouter runway <Badge tone={tone}>{word}</Badge></span>}>
      {f.remaining == null ? (
        'OpenRouter did not answer, so there is no balance to estimate from.'
      ) : f.daysLeft == null ? (
        <>{usd(f.remaining)} left. No spend was recorded in the last 7 days, so there is no run-out date.</>
      ) : (
        <>
          <strong className="type-num">{usd(f.remaining)}</strong> left. About <strong className="type-num">{Math.floor(f.daysLeft)} days</strong> at {usdFine(f.burnPerDay7d)} a day (7 day average){f.runsOutOn ? `, runs out ${dhakaDay(f.runsOutOn)}` : ''}.
          {f.testsLeft != null && <> Community tests stop at {usd(c.minBalance)}: about {num(f.testsLeft)} more finished tests.</>}
        </>
      )}
    </Alert>
  );
}

function CostsPage() {
  const { days = 30, paidBy, dim = 'stage' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const set = (s: Partial<Search>) => void navigate({ search: (p) => ({ ...p, ...s }) });
  const costs = useAdmin<Costs>('/costs');
  const forecast = useAdmin<SpendForecast>('/spend/forecast');
  const summary = useAdmin<SpendSummary>('/spend/summary', { days });
  const series = useAdmin<SpendSeries>('/spend/series', { days, paidBy: 'all' });
  const by = useAdmin<SpendBy>('/spend/by', { dim, days, paidBy: paidBy ?? 'house', limit: 8 });
  const waste = useAdmin<SpendWaste>('/spend/waste', { days, paidBy: paidBy ?? 'house' });
  const empty = summary.data && summary.data.allTime.calls === 0;
  return (
    <PageContainer>
      <AdminHeader
        title="Costs"
        description={costs.data && `Balances are read from the providers and cached for 5 minutes. Last read ${dhakaTime(costs.data.cachedAt)} Dhaka time.`}
        actions={
          <>
            <Segmented label="Paid by" value={paidBy ?? 'house'} onChange={(v: PaidBy) => set({ paidBy: v === 'house' ? undefined : v })} options={[{ value: 'house', label: 'House' }, { value: 'own_key', label: 'Own key' }, { value: 'all', label: 'All' }]} />
            <Segmented label="Period" value={String(days) as '7' | '30' | '90'} onChange={(v) => set({ days: v === '30' ? undefined : (Number(v) as 7 | 90) })} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
          </>
        }
      />
      <div className="space-y-8">
        {forecast.data && costs.data && <Runway f={forecast.data} c={costs.data} />}

        <Load q={summary} lines={2}>
          {(s) => (
            <StatStrip
              items={[
                { label: 'Today', value: usdFine(s.today.house), hint: `${num(s.today.calls)} calls` },
                { label: '7 days', value: usdFine(s.last7d.house), hint: `${num(s.last7d.calls)} calls` },
                { label: '30 days', value: usdFine(s.last30d.house), hint: `${num(s.last30d.calls)} calls` },
                { label: 'All time', value: usdFine(s.allTime.house), hint: s.since ? `since ${dhakaDay(s.since.slice(0, 10))}` : undefined },
                { label: 'Own key, 30 days', value: usdFine(s.last30d.ownKey), hint: 'Not paid by you' },
              ]}
            />
          )}
        </Load>

        {empty ? (
          <EmptyState icon={<Wallet />} title="Nothing recorded yet">{trackedSince(summary.data?.since ?? null)}</EmptyState>
        ) : (
          <>
            <Section title="Spend per day" aside="House and own key, Dhaka days" className="mt-0">
              <Load q={series} lines={2}>
                {(s) => {
                  const pts = fillDays(s.points, days);
                  return (
                    <ColumnChart
                      labels={pts.map((p) => dhakaDay(p.date))}
                      series={[{ label: 'House', color: SERIES[0], values: pts.map((p) => p.house) }, { label: 'Own key', color: SERIES[1], values: pts.map((p) => p.ownKey) }]}
                      fmt={usdFine}
                      partialLast
                    />
                  );
                }}
              </Load>
            </Section>

            <Section title="Where it goes" aside={by.data && `${usdFine(by.data.total)} in ${days} days`} className="mt-0">
              <div className="mb-4">
                <Segmented label="Group by" value={dim} onChange={(v) => set({ dim: v === 'stage' ? undefined : v })} options={DIMS.map((d) => ({ value: d, label: DIM_LABEL[d] }))} />
              </div>
              <Load q={by} lines={3}>
                {(d) => {
                  const shown = d.items.reduce((a, i) => a + i.costUsd, 0);
                  const other = Math.max(0, d.total - shown);
                  return d.items.length ? (
                    <BarList
                      track
                      max={d.items[0]!.costUsd}
                      onSelect={dim === 'user' ? (k) => void navigate({ to: '/admin/users/$userId', params: { userId: k } }) : undefined}
                      rows={[
                        ...d.items.map((i) => ({
                          key: i.key,
                          label: dim === 'stage' ? stageLabel(i.key) : i.label.replace(/^(.)/, (m) => m.toUpperCase()),
                          value: i.costUsd,
                          text: `${usdFine(i.costUsd)} · ${Math.round(i.share * 100)}%`,
                          hint: `${num(i.calls)} calls · ${usdFine(i.avgPerCall)} each`,
                        })),
                        ...(other > 0.0001 ? [{ key: '__other', label: 'Other', value: other, text: `${usdFine(other)} · ${Math.round((other / d.total) * 100)}%` }] : []),
                      ]}
                    />
                  ) : (
                    <p className="text-sm text-muted">No spend in this period.</p>
                  );
                }}
              </Load>
            </Section>

            <Section title="Cost of a finished test" aside="Speaking and Writing, with cost rows" className="mt-0">
              <Load q={summary} lines={2}>
                {(s) =>
                  s.perAttempt.length ? (
                    <>
                      <DataTable
                        dense
                        rows={s.perAttempt}
                        rowKey={(p) => `${p.skill}${p.part}`}
                        label="Cost per finished test"
                        cols={[
                          { head: 'Test', cell: (p) => <span className="capitalize">{p.skill} part {p.part}</span> },
                          { head: 'Average', className: 'text-right', cell: (p) => <span className="type-num font-semibold">{usdFine(p.avgUsd)}</span> },
                          { head: 'Median', className: 'text-right', cell: (p) => <span className="type-num">{usdFine(p.medianUsd)}</span> },
                          { head: 'Worst 10%', className: 'text-right', cell: (p) => <span className="type-num">{usdFine(p.p90Usd)}</span> },
                          { head: 'Waste each', className: 'text-right', cell: (p) => <span className="type-num">{p.wasteUsd > 0 ? usdFine(p.wasteUsd) : <span className="text-muted">&ndash;</span>}</span> },
                          { head: 'Tests', className: 'text-right', cell: (p) => <span className="type-num">{p.n}</span> },
                        ]}
                      />
                      {s.unrecordedAttempts > 0 && <p className="type-caption mt-2">{s.unrecordedAttempts} finished tests in this period ran before cost tracking and are not counted. Waste is money spent on failed or repeated calls.</p>}
                    </>
                  ) : (
                    <p className="text-sm text-muted">No finished tests with cost rows in this period.</p>
                  )
                }
              </Load>
            </Section>

            <Section title="Waste" aside="Calls that produced nothing. Bars: share of the largest row." className="mt-0">
              <Load q={waste} lines={1}>
                {(w) =>
                  w.share < 0.01 ? (
                    <p className="text-sm text-muted">Waste is under 1 percent ({usdFine(w.totalUsd)} of {usdFine(w.spendUsd)}).</p>
                  ) : (
                    <>
                      <p className="mb-3 text-sm"><span className="type-num font-semibold">{usdFine(w.totalUsd)}</span> of {usdFine(w.spendUsd)} ({(w.share * 100).toFixed(1)}%) was spent on calls that produced nothing.</p>
                      <BarList track max={Math.max(...w.parts.map((p) => p.usd))} rows={w.parts.filter((p) => p.usd > 0).map((p) => ({ tone: 'warn' as const, key: p.kind, label: WASTE_LABEL[p.kind] ?? p.kind, value: p.usd, text: usdFine(p.usd), hint: `${num(p.calls)} calls` }))} />
                    </>
                  )
                }
              </Load>
            </Section>
          </>
        )}

        <Section title="Provider balances" aside="Read from the providers" className="mt-0">
          <Load q={costs} lines={3}>
            {(c) => (
              <div className="grid gap-8 md:grid-cols-2">
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">OpenRouter <Warn w={c.openrouter.warn} /></h3>
                  {c.openrouter.available ? (
                    <>
                      <dl className="grid grid-cols-2 gap-6">
                        <Stat label="Left" value={usd(c.openrouter.remaining)} hint={c.openrouter.limit == null ? 'No spending limit' : `of ${usd(c.openrouter.limit)}`} />
                        <Stat label="Spent" value={usd(c.openrouter.usage)} hint={`${usd(c.openrouter.usageDaily)} today · ${usd(c.openrouter.usageMonthly)} this month`} />
                      </dl>
                      {c.openrouter.limit != null && c.openrouter.remaining != null && c.openrouter.limit > 0 && <ProgressBar className="mt-4" label="OpenRouter balance left" value={c.openrouter.remaining / c.openrouter.limit} tone={WARN[c.openrouter.warn].tone} />}
                    </>
                  ) : (
                    <Alert tone="warn">OpenRouter did not answer. Try again in a few minutes.</Alert>
                  )}
                </div>
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">ElevenLabs (examiner voice) <Warn w={c.elevenlabs.warn} /></h3>
                  {c.elevenlabs.available ? (
                    <>
                      <dl className="grid grid-cols-2 gap-6">
                        <Stat label="Characters left" value={num(c.elevenlabs.remaining)} hint={`of ${num(c.elevenlabs.characterLimit)}`} />
                        <Stat label="Plan" value={<span className="capitalize">{c.elevenlabs.tier ?? '-'}</span>} hint={c.elevenlabs.resetsAt ? `Resets ${dhakaTime(c.elevenlabs.resetsAt)}` : undefined} />
                      </dl>
                      {c.elevenlabs.characterLimit != null && c.elevenlabs.remaining != null && c.elevenlabs.characterLimit > 0 && <ProgressBar className="mt-4" label="ElevenLabs characters left" value={c.elevenlabs.remaining / c.elevenlabs.characterLimit} tone={WARN[c.elevenlabs.warn].tone} />}
                    </>
                  ) : (
                    <p className="text-sm text-muted">Not configured, or ElevenLabs did not answer.</p>
                  )}
                </div>
                <p className="type-caption md:col-span-2">
                  Community pool (shared key): {usd(c.community.remaining)} left, {usd(c.community.used)} spent{c.community.limit == null ? ', no limit' : ` of ${usd(c.community.limit)}`}. Community tests stop when less than {usd(c.minBalance)} is left on OpenRouter.
                </p>
              </div>
            )}
          </Load>
        </Section>
      </div>
    </PageContainer>
  );
}
