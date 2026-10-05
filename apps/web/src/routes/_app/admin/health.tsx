import type { Health } from '@server/admin/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { dhakaTime, userLabel } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { type Col, DataTable } from '@/components/admin/Table';
import { Badge, Button, EmptyState, PageContainer, PageHeader, Stat, toast } from '@/components/ui';
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

function HealthPage() {
  const q = useAdmin<Health>('/health');
  return (
    <PageContainer>
      <PageHeader title="Health" description="Failed or stuck analyses and emails that did not send. Retrying costs the user nothing." />
      <Load q={q} lines={4}>
        {(h) => (
          <>
            <dl className="grid grid-cols-3 gap-x-6">
              <Stat label="Failed, 24 h" value={h.counts.failed24h} />
              <Stat label="Stuck analyzing" value={h.counts.stuckAnalyzing} />
              <Stat label="Emails failed, 24 h" value={h.counts.emailFailed24h} />
            </dl>
            <Section title="Analyses" aside="Failed in the last 7 days, or analyzing over 10 minutes">
              {h.attempts.length ? (
                <DataTable rows={h.attempts} cols={COLS} rowKey={(a) => a.id} label="Failed or stuck analyses" />
              ) : (
                <EmptyState icon={<CircleCheck />} title="All clear" bare>
                  Nothing failed or stuck.
                </EmptyState>
              )}
            </Section>
            <Section title="Common errors" aside="Last 7 days">
              {h.recentErrors.length ? (
                <ul className="divide-y divide-line border-y border-line">
                  {h.recentErrors.map((e) => (
                    <li key={e.error} className="flex items-baseline justify-between gap-4 py-3 text-sm">
                      <span className="min-w-0 break-words">{e.error}</span>
                      <span className="type-caption type-num shrink-0">
                        {e.count}x · {dhakaTime(e.lastAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No errors.</p>
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
