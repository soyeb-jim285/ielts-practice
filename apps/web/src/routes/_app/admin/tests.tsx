import type { Missed, TestHealth, Tests } from '@server/admin/schemas';
import { createFileRoute } from '@tanstack/react-router';
import { band, percent } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { BarList } from '@/components/admin/MiniChart';
import { type Col, DataTable } from '@/components/admin/Table';
import { Button, Dialog, PageContainer, PageHeader, Segmented } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

type Search = { days?: 7 | 365; test?: string };
const DAYS = { 30: undefined, 7: 7, 365: 365 } as const;

export const Route = createFileRoute('/_app/admin/tests')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    days: Number(s.days) === 7 ? 7 : Number(s.days) === 365 ? 365 : undefined,
    test: typeof s.test === 'string' && s.test ? s.test : undefined,
  }),
  component: TestsPage,
});

function Missing({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAdmin<Missed>(`/tests/${encodeURIComponent(id)}/missed`);
  return (
    <Dialog open onClose={onClose} title={q.data ? `Most missed: ${q.data.title}` : 'Most missed'} description={q.data && `${q.data.submitted} submitted attempts. Top 15 questions by miss rate.`} className="max-w-[min(36rem,calc(100%-2rem))]">
      <Load q={q} lines={3}>
        {(m) =>
          m.questions.length ? (
            <BarList max={1} rows={m.questions.map((x) => ({ label: `Question ${x.n}`, value: x.missRate, text: percent(x.missRate), hint: `${x.missed} of ${x.answered} wrong` }))} />
          ) : (
            <p className="text-sm text-muted">No marked attempts yet.</p>
          )
        }
      </Load>
    </Dialog>
  );
}

const cols = (onMissed?: (id: string) => void): Col<TestHealth>[] => [
  { head: 'Test', cell: (t) => <><span className="capitalize">{t.skill}</span>{t.part != null && ` · Part ${t.part}`}<span className="type-caption block">{t.title} · {t.source}</span></> },
  { head: 'Started', cell: (t) => <span className="type-num">{t.started}</span> },
  { head: 'Finished', cell: (t) => <span className="type-num">{t.finished}</span> },
  { head: 'Completion', cell: (t) => <span className="type-num">{percent(t.completionRate)}</span> },
  { head: 'Avg band', cell: (t) => <span className="type-num">{band(t.avgBand)}</span> },
  ...(onMissed
    ? [
        { head: 'Avg raw', cell: (t: TestHealth) => <span className="type-num">{t.avgRaw == null ? '-' : t.avgRaw.toFixed(1)}</span> },
        { head: 'Detail', cell: (t: TestHealth) => <Button variant="link" onClick={() => onMissed(t.id)} aria-label={`Most missed questions in ${t.title}`}>Most missed</Button> },
      ]
    : []),
];

function TestsPage() {
  const { days, test } = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useAdmin<Tests>('/tests', { days: days ?? 30 });
  return (
    <PageContainer>
      <PageHeader
        title="Tests"
        description="Which speaking and writing prompts and which Listening and Reading tests are started, finished and missed."
        actions={
          <Segmented
            label="Period"
            value={String(days ?? 30) as '7' | '30' | '365'}
            onChange={(v) => void navigate({ search: (s) => ({ ...s, days: DAYS[Number(v) as 7 | 30 | 365] }) })}
            options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '365', label: 'Year' }]}
          />
        }
      />
      <Load q={q} lines={4}>
        {(d) => (
          <>
            <Section title="Listening and Reading" aside="By tests started">
              {d.lr.length ? <DataTable rows={d.lr} cols={cols((id) => void navigate({ search: (s) => ({ ...s, test: id }) }))} rowKey={(t) => t.id} label="Listening and Reading tests" /> : <p className="text-sm text-muted">No attempts in this period.</p>}
            </Section>
            <Section title="Speaking and Writing prompts" aside="By attempts started">
              {d.prompts.length ? <DataTable rows={d.prompts} cols={cols()} rowKey={(t) => t.id} label="Speaking and Writing prompts" /> : <p className="text-sm text-muted">No attempts in this period.</p>}
            </Section>
          </>
        )}
      </Load>
      {test && <Missing id={test} onClose={() => void navigate({ search: (s) => ({ ...s, test: undefined }) })} />}
    </PageContainer>
  );
}
