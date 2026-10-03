import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen, Headphones } from 'lucide-react';
import { useState } from 'react';
import { GroupHeading, listStyles, RowChevron, RowIcon, rowStyles } from '@/components/bank/ListRow';
import { Alert, Badge, Button, Dialog, EmptyState, PageContainer, PageHeader, ProgressBar, Segmented } from '@/components/ui';
import { call, client, type Schemas } from '@/lib/api';
import { formatBand } from '@/lib/format';
import { lrTestsQuery, parseRef, READING_SECONDS, type LrSkill } from '@/lib/lr';
import { useMe } from '@/lib/query';
import { bandColor } from '@/lib/result';
import { cn } from '@/lib/utils';

type Item = Schemas['LrTestListItem'];
const BAND_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };

const COPY = {
  listening: { title: 'Listening', lede: 'Four recordings, 40 questions. Take it like the real computer-delivered test, or practise with replay and slow-down.', icon: Headphones },
  reading: { title: 'Reading', lede: 'Three passages, 40 questions, 60 minutes. Highlight the passage as you read, flag what to revisit.', icon: BookOpen },
};

/** Cambridge tests are grouped by book, newest first; our own tests sit under one heading. */
function groups(items: Item[]) {
  const books = new Map<number, Item[]>();
  const own: Item[] = [];
  const other: Item[] = [];
  for (const t of items) {
    const r = t.source === 'cambridge' ? parseRef(t.ref) : null;
    if (r) books.set(r.book, [...(books.get(r.book) ?? []), t]);
    else (t.source === 'cambridge' ? other : own).push(t);
  }
  const out = [...books].sort((a, b) => b[0] - a[0]).map(([book, ts]) => ({ key: `c${book}`, heading: `Cambridge IELTS ${book}`, tests: ts.sort((a, b) => parseRef(a.ref)!.test - parseRef(b.ref)!.test) }));
  if (other.length) out.push({ key: 'c', heading: 'Cambridge IELTS', tests: other });
  if (own.length) out.push({ key: 'own', heading: 'Original practice tests', tests: own });
  return out;
}

function Status({ t, target }: { t: Item; target: number }) {
  if (t.status === 'in_progress')
    return (
      <span className="flex w-36 flex-col items-end gap-1.5 max-sm:w-28">
        <span className="type-caption type-num font-medium text-accent-text">In progress, {t.answered}/{t.total}</span>
        <ProgressBar label={`${t.answered} of ${t.total} answered`} value={t.answered / t.total} className="h-1.5" />
      </span>
    );
  if (t.status === 'submitted' && t.bestBand != null)
    return (
      <span className="text-right">
        <span className={cn('type-band block text-lg leading-tight', BAND_TEXT[bandColor(t.bestBand, target)])}>
          <span className="sr-only">Best band </span>
          {formatBand(t.bestBand)}
        </span>
        <span className="type-caption">{t.attempts === 1 ? '1 attempt' : `${t.attempts} attempts`}</span>
      </span>
    );
  return <span className="type-caption">Not started</span>;
}

const MODES = {
  exam: { label: 'Exam', hint: (s: LrSkill) => (s === 'reading' ? `${READING_SECONDS / 60}-minute countdown. Submits itself when time is up.` : 'The recording plays once, with no pause or rewind. Then 2 minutes to check, and it submits itself.') },
  practice: { label: 'Practice', hint: (s: LrSkill) => (s === 'reading' ? 'No time limit. A clock counts up so you can see your pace.' : 'Pause, rewind, slow down to 0.75× and replay any part. No time limit.') },
} as const;

function ModeDialog({ test, onClose, onStart, busy, error }: { test: Item | null; onClose: () => void; onStart: (mode: 'exam' | 'practice') => void; busy: boolean; error: boolean }) {
  const [mode, setMode] = useState<'exam' | 'practice'>('exam');
  return (
    <Dialog
      open={!!test}
      onClose={onClose}
      title={test ? test.title : ''}
      description="Choose how to take this test."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => onStart(mode)}>
            Start {MODES[mode].label.toLowerCase()} test
          </Button>
        </>
      }
    >
      {test && (
        <div role="radiogroup" aria-label="Mode" className="grid gap-2">
          {(Object.keys(MODES) as (keyof typeof MODES)[]).map((m) => (
            <label key={m} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-card p-3.5 transition-colors duration-[120ms] hover:border-input has-[:checked]:border-brand has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1 size-4 accent-[var(--accent)]" />
              <span>
                <span className="type-subheading block">{MODES[m].label}</span>
                <span className="type-caption mt-0.5 block">{MODES[m].hint(test.skill)}</span>
              </span>
            </label>
          ))}
          {error && <Alert tone="bad">Could not start the test. Try again.</Alert>}
        </div>
      )}
    </Dialog>
  );
}

export function LrHub({ skill }: { skill: LrSkill }) {
  const { data } = useSuspenseQuery(lrTestsQuery(skill));
  const target = useMe().data?.settings.targetBand ?? 7;
  const navigate = useNavigate();
  const [variant, setVariant] = useState<'all' | 'academic' | 'general'>('all');
  const [pick, setPick] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const c = COPY[skill];
  const items = data.items.filter((t) => variant === 'all' || t.variant === variant);
  const variants = new Set(data.items.map((t) => t.variant));

  const open = (a: string) => navigate({ to: '/lr/run/$attemptId', params: { attemptId: a } });
  const start = async (t: Item, mode: 'exam' | 'practice') => {
    setBusy(true);
    setErr(false);
    try {
      const a = await call(client.POST('/api/lr/tests/{id}/attempts', { params: { path: { id: t.id } }, body: { mode } }));
      await open(a.id);
    } catch {
      setErr(true);
      setBusy(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={c.title}
        description={c.lede}
        actions={
          variants.size > 1 && (
            <Segmented
              label="Module"
              className="max-sm:w-full"
              value={variant}
              onChange={setVariant}
              options={[{ value: 'all', label: 'All' }, { value: 'academic', label: 'Academic' }, { value: 'general', label: 'General Training' }]}
            />
          )
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={<c.icon />} title={`No ${skill} tests yet`}>
          Tests appear here once they are imported. Run the importer, then reload this page.
        </EmptyState>
      ) : (
        groups(items).map((g) => (
          <section key={g.key} aria-label={g.heading}>
            <GroupHeading>{g.heading}</GroupHeading>
            <ul className={listStyles}>
              {g.tests.map((t) => {
                const r = t.source === 'cambridge' ? parseRef(t.ref) : null;
                return (
                  <li key={t.id}>
                    <button type="button" className={rowStyles} onClick={() => (t.attemptId ? void open(t.attemptId) : setPick(t))}>
                      <RowIcon>
                        <c.icon />
                      </RowIcon>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="type-subheading font-medium">{r ? `Test ${r.test}` : t.title}</span>
                          {t.skill === 'reading' && <Badge tone={t.variant === 'academic' ? 'neutral' : 'info'}>{t.variant === 'academic' ? 'Academic' : 'General Training'}</Badge>}
                        </span>
                        <span className="type-caption mt-0.5 block">
                          {t.attemptId ? `Resume in ${t.mode} mode` : t.status === 'submitted' ? 'Retake or review' : '40 questions'}
                        </span>
                      </span>
                      <Status t={t} target={target} />
                      <RowChevron />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <ModeDialog test={pick} onClose={() => { setPick(null); setErr(false); }} onStart={(m) => pick && void start(pick, m)} busy={busy} error={err} />
    </PageContainer>
  );
}
