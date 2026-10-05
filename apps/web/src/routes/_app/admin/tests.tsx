import type { Missed, TestHealth, Tests } from '@server/admin/schemas';
import { createFileRoute } from '@tanstack/react-router';
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { band, percent } from '@/components/admin/format';
import { Inventory } from '@/components/admin/Inventory';
import { rankTests, type TestSort } from '@/components/admin/logic';
import { Load } from '@/components/admin/Load';
import { BarList } from '@/components/admin/MiniChart';
import { type Col, DataTable } from '@/components/admin/Table';
import { Button, Dialog, EmptyState, Input, PageContainer, Segmented, Tabs } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

type Skill = 'speaking' | 'writing' | 'listening' | 'reading';
const SKILLS = ['speaking', 'writing', 'listening', 'reading'] as const;
const SORTS = ['started', 'completion', 'band'] as const;
type Search = { days?: 7 | 365; test?: string; view?: 'inventory'; skill?: Skill; sort?: TestSort; source?: 'cambridge' | 'generated' };
const DAYS = { 30: undefined, 7: 7, 365: 365 } as const;

export const Route = createFileRoute('/_app/admin/tests')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    days: Number(s.days) === 7 ? 7 : Number(s.days) === 365 ? 365 : undefined,
    view: s.view === 'inventory' ? 'inventory' : undefined,
    skill: SKILLS.find((k) => k === s.skill),
    sort: SORTS.find((k) => k === s.sort && k !== 'started'),
    source: s.source === 'cambridge' || s.source === 'generated' ? s.source : undefined,
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

const LIMIT = 20;

/** Completion as a bar with no track; under half is red text and a bar in the bad colour. */
const Completion = ({ rate }: { rate: number }) => (
  <span className="flex items-center gap-2">
    <span className="h-1.5 w-16 shrink-0" aria-hidden>
      <span className={`block h-full rounded-r-[3px] ${rate < 0.5 ? 'bg-bad' : 'bg-brand'}`} style={{ width: `${Math.max(2, rate * 100)}%` }} />
    </span>
    <span className={`type-num ${rate < 0.5 ? 'font-semibold text-bad-text' : ''}`}>{percent(rate)}</span>
  </span>
);

const cols = (onMissed: (id: string) => void): Col<TestHealth>[] => [
  { head: 'Test', className: 'max-w-80', cell: (t) => <><span className="block truncate" title={t.title}>{t.title}</span><span className="type-caption block capitalize">{t.skill}{t.part != null && ` · Part ${t.part}`} · {t.source}</span></> },
  { head: 'Started', className: 'text-right', cell: (t) => <span className="type-num">{t.started}</span> },
  { head: 'Completion', cell: (t) => <Completion rate={t.completionRate} /> },
  { head: 'Avg band', className: 'text-right', cell: (t) => <span className="type-num">{band(t.avgBand)}</span> },
  { head: 'Avg raw', className: 'text-right', cell: (t) => <span className="type-num">{t.avgRaw == null ? '-' : t.avgRaw.toFixed(1)}</span> },
  { head: 'Detail', cell: (t) => (t.skill === 'listening' || t.skill === 'reading' ? <Button variant="link" onClick={() => onMissed(t.id)} aria-label={`Most missed questions in ${t.title}`}>Most missed</Button> : <span className="text-muted" aria-label="none">&ndash;</span>) },
];

function TestsPage() {
  const { days, test, view, skill = 'speaking', sort = 'started', source } = Route.useSearch();
  const navigate = Route.useNavigate();
  const set = (s: Partial<Search>) => void navigate({ search: (p) => ({ ...p, ...s }) });
  const q = useAdmin<Tests>('/tests', { days: days ?? 30 }, { enabled: view !== 'inventory' });
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(LIMIT);
  const tab = view ?? 'health';
  return (
    <PageContainer>
      <AdminHeader
        title="Tests"
        description="Which tests are started, finished and missed, and what content exists."
        actions={
          tab === 'health' && (
            <Segmented
              label="Period"
              value={String(days ?? 30) as '7' | '30' | '365'}
              onChange={(v) => set({ days: DAYS[Number(v) as 7 | 30 | 365] })}
              options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '365', label: 'Year' }]}
            />
          )
        }
      />
      <Tabs id="tests" className="mb-6" value={tab} onChange={(v: 'health' | 'inventory') => set({ view: v === 'inventory' ? 'inventory' : undefined })} items={[{ value: 'health', label: 'Health' }, { value: 'inventory', label: 'Inventory' }]} />
      <div role="tabpanel" id="tests-panel" aria-labelledby={`tests-${tab}`}>
        {tab === 'inventory' ? (
          <Inventory />
        ) : (
          <Load q={q} lines={4}>
            {(d) => {
              const rows = skill === 'listening' || skill === 'reading' ? d.lr.filter((t) => t.skill === skill) : d.prompts.filter((t) => t.skill === skill);
              const r = rankTests(rows, { q: text, source, sort, limit });
              return (
                <>
                  <div className="mb-4 flex flex-wrap items-end gap-4">
                    <Segmented label="Skill" value={skill} onChange={(v) => (setLimit(LIMIT), set({ skill: v }))} options={SKILLS.map((k) => ({ value: k, label: <span className="capitalize">{k}</span> }))} />
                    <Segmented label="Order" value={sort} onChange={(v) => (setLimit(LIMIT), set({ sort: v === 'started' ? undefined : v }))} options={[{ value: 'started', label: 'Most started' }, { value: 'completion', label: 'Lowest completion' }, { value: 'band', label: 'Lowest band' }]} />
                    <Segmented label="Source" value={source ?? 'all'} onChange={(v) => (setLimit(LIMIT), set({ source: v === 'all' ? undefined : v }))} options={[{ value: 'all', label: 'All' }, { value: 'cambridge', label: 'Cambridge' }, { value: 'generated', label: 'Generated' }]} />
                    <div className="min-w-48 flex-1 sm:max-w-xs" role="search">
                      <Input label="Search tests" hideLabel type="search" placeholder="Search by title" value={text} onChange={(e) => (setText(e.target.value), setLimit(LIMIT))} />
                    </div>
                  </div>
                  {r.items.length ? (
                    <>
                      <DataTable dense rows={r.items} cols={cols((id) => set({ test: id }))} rowKey={(t) => t.id} label={`${skill} tests`} />
                      <p className="type-caption mt-3 flex items-center justify-between">
                        <span>Showing {r.items.length} of {r.total}</span>
                        {r.total > r.items.length && <Button variant="outline" size="sm" onClick={() => setLimit(limit + LIMIT)}>Show {Math.min(LIMIT, r.total - r.items.length)} more</Button>}
                      </p>
                    </>
                  ) : (
                    <EmptyState icon={<FlaskConical />} title="No tests here">{text ? 'Nothing matches this search.' : 'No attempts in this period.'}</EmptyState>
                  )}
                </>
              );
            }}
          </Load>
        )}
      </div>
      {test && <Missing id={test} onClose={() => set({ test: undefined })} />}
    </PageContainer>
  );
}
