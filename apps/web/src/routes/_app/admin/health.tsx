import type { Health, LiveLatency } from '@server/admin/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { dhakaTime, userLabel } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { type Col, DataTable } from '@/components/admin/Table';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { AttentionList } from '@/components/admin/AttentionList';
import { attentionItems } from '@/components/admin/logic';
import { Badge, Button, EmptyState, PageContainer, Stat, toast } from '@/components/ui';
import { appPath, useAdmin } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';

export const Route = createFileRoute('/_app/admin/health')({ component: HealthPage });

type Row = Health['attempts'][number];

function Retry({ id }: { id: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post(`/admin/attempts/${id}/retry`),
    onSuccess: () => {
      toast('Analysis restarted.');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not retry.', { tone: 'bad' }),
  });
  return (
    <Button size="sm" variant="outline" loading={m.isPending} onClick={() => m.mutate()}>
      Retry
    </Button>
  );
}

const COLS: Col<Row>[] = [
  { head: 'When (Dhaka)', cell: (a) => <span className="type-num whitespace-nowrap">{dhakaTime(a.updatedAt)}</span> },
  {
    head: 'User',
    cell: (a) => (
      <Link to="/admin/users/$userId" params={{ userId: a.userId }} className="break-all underline-offset-4 hover:underline">
        {userLabel(a)}
      </Link>
    ),
  },
  { head: 'Test', cell: (a) => <><span className="capitalize">{a.skill}</span> · Part {a.part}</> },
  { head: 'Status', cell: (a) => <Badge tone={a.status === 'failed' ? 'bad' : 'warn'}>{a.status === 'failed' ? 'Failed' : `Analyzing ${a.ageMin} min`}</Badge> },
  { head: 'Stage / error', cell: (a) => <span className="break-words">{[a.stage, a.error].filter(Boolean).join(': ') || '-'}{!a.errorRetryable && <span className="type-caption block">Not retryable by the user</span>}</span> },
  {
    head: 'Actions',
    cell: (a) => (
      <span className="flex flex-wrap items-center gap-3">
        {a.canRetry && <Retry id={a.id} />}
        <Link to={appPath(a.resultPath)} className="text-accent-text underline-offset-4 hover:underline">
          Result
        </Link>
      </span>
    ),
  },
];

const sec = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const STAGE_LABEL: [keyof NonNullable<LiveLatency['stages']>, string, string][] = [
  ['total', 'Total', 'last sound to the examiner speaking'],
  ['wait', 'Turn wait', 'silence before the turn counted as finished'],
  ['stt', 'Transcript', 'turn end to final transcript'],
  ['llm', 'LLM', 'time to first token'],
  ['tts', 'Voice', 'time to first audio'],
  ['net', 'Network and rest', 'everything else in the round trip'],
];

/** Reply times measured in real live sessions (POST /api/live/latency). */
function LatencySection() {
  const q = useAdmin<LiveLatency>('/live-latency', { days: 30 });
  return (
    <Section title="Live examiner speed" aside="Last 30 days, measured in the learner's browser">
      <Load q={q} lines={3}>
        {(l) =>
          l.stages ? (
            <>
              <p className="mb-3 text-sm text-muted">{l.turns} answered turns from {l.sessions} sessions. Median is the typical turn; p95 is the slow end (1 turn in 20 is slower).</p>
              <DataTable
                rows={STAGE_LABEL}
                rowKey={(r) => r[0]}
                label="Reply time per stage"
                cols={[
                  { head: 'Stage', cell: (r) => <span><span className={r[0] === 'total' ? 'font-semibold' : ''}>{r[1]}</span><span className="type-caption block">{r[2]}</span></span> },
                  { head: 'Median', cell: (r) => <span className="type-num">{sec(l.stages![r[0]].p50)}</span> },
                  { head: 'p95', cell: (r) => <span className="type-num">{sec(l.stages![r[0]].p95)}</span> },
                  { head: 'Mean', cell: (r) => <span className="type-num">{sec(l.stages![r[0]].mean)}</span> },
                ]}
              />
              {l.byLabel.length > 1 && (
                <ul className="mt-4 divide-y divide-line border-y border-line">
                  {l.byLabel.map((b) => (
                    <li key={b.label} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                      <span className="min-w-0 break-words">{b.label}</span>
                      <span className="type-caption type-num shrink-0">{b.turns} turns · median {sec(b.p50)} · p95 {sec(b.p95)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">No timed live turns yet. Run a live test: each answered turn is timed and saved when the test closes.</p>
          )
        }
      </Load>
    </Section>
  );
}

function HealthPage() {
  const q = useAdmin<Health>('/health');
  return (
    <PageContainer>
      <AdminHeader title="System" description="Failed or stuck analyses and emails that did not send. Retrying costs the user nothing." />
      <Load q={q} lines={4}>
        {(h) => (
          <>
            <AttentionList
              items={attentionItems({ failed24h: h.counts.failed24h, stuck: h.counts.stuckAnalyzing, emailFailed24h: h.counts.emailFailed24h, feedbackNew: 0, balanceErrors: h.recentErrors.filter((e) => /402|balance|credit/i.test(e.error)).reduce((n, e) => n + e.count, 0) })}
            />
            <dl className="mt-6 grid grid-cols-3 gap-x-6">
              <Stat label="Failed, 24 h" value={h.counts.failed24h} />
              <Stat label="Stuck analyzing" value={h.counts.stuckAnalyzing} />
              <Stat label="Emails failed, 24 h" value={h.counts.emailFailed24h} />
            </dl>
            <LatencySection />
            <Section title="Errors, grouped" aside="Last 7 days, most common first">
              {h.recentErrors.length ? (
                <ul className="divide-y divide-line border-y border-line">
                  {h.recentErrors.map((e) => (
                    <li key={e.error} className="flex items-baseline justify-between gap-4 py-3 text-sm">
                      <span className="min-w-0 break-words">
                        {e.error}
                        {/402|balance|credit/i.test(e.error) && (
                          <Link to="/admin/costs" className="ml-2 text-accent-text underline-offset-4 hover:underline">
                            Check balance
                          </Link>
                        )}
                      </span>
                      <span className="type-caption type-num shrink-0">
                        {e.count}x · last {dhakaTime(e.lastAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No errors.</p>
              )}
            </Section>
            <Section title="Analyses" aside="Failed in the last 7 days, or analyzing over 10 minutes">
              {h.attempts.length ? (
                <DataTable rows={h.attempts} cols={COLS} rowKey={(a) => a.id} label="Failed or stuck analyses" />
              ) : (
                <EmptyState icon={<CircleCheck />} title="All clear" bare>
                  Nothing failed or stuck.
                </EmptyState>
              )}
            </Section>
            <Section title="Emails that failed" aside="Last 7 days">
              {h.emailFailures.length ? (
                <DataTable
                  rows={h.emailFailures}
                  rowKey={(e) => e.id}
                  label="Failed emails"
                  cols={[
                    { head: 'Email', cell: (e) => <span className="break-all">{e.email}</span> },
                    { head: 'When (Dhaka)', cell: (e) => <span className="type-num whitespace-nowrap">{dhakaTime(e.createdAt)}</span> },
                    { head: 'Purpose', cell: (e) => e.purpose },
                    { head: 'Tries', cell: (e) => <span className="type-num">{e.attempts}</span> },
                    { head: 'Error', cell: (e) => <span className="break-words">{e.error ?? '-'}</span> },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted">No failed emails.</p>
              )}
            </Section>
          </>
        )}
      </Load>
    </PageContainer>
  );
}
