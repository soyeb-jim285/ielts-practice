import { writingOverall } from '@ielts/core';
import type { AnalysisResult } from '@server/ai/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, BookmarkPlus, FileText, RotateCcw } from 'lucide-react';
import { AnalyzingState, FailedState, OverviewPanel, ResultHeader } from '@/components/results';
import { Alert, Badge, Button, buttonStyles, Card, EmptyState, Segmented, Skeleton, Tabs, toast } from '@/components/ui';
import { DiffView } from '@/components/writing/DiffView';
import { EssayHighlights } from '@/components/writing/EssayHighlights';
import { LanguagePanel } from '@/components/writing/LanguagePanel';
import { taskLabel } from '@/components/writing/PromptPanel';
import { StructureMap } from '@/components/writing/StructureMap';
import { formatBand, formatDate, plural } from '@/lib/format';
import { useMe } from '@/lib/query';
import { addFixesToDeck, attemptQuery, bandColor, WRITING_CRITERIA, type Attempt } from '@/lib/result';

const TABS = ['overview', 'essay', 'structure', 'language', 'improve'] as const;
type Tab = (typeof TABS)[number];
const TONE_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };

export const Route = createFileRoute('/_app/writing/result/$attemptId')({
  // `pair` = the other task's attempt in a full test.
  validateSearch: (s: Record<string, unknown>): { pair?: string; tab?: Tab } => ({
    pair: typeof s.pair === 'string' ? s.pair : undefined,
    tab: TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined,
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(attemptQuery(params.attemptId)),
  component: ResultPage,
});

function ResultPage() {
  const { attemptId } = Route.useParams();
  const { pair, tab = 'overview' } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: a, error, refetch } = useQuery(attemptQuery(attemptId));
  const { data: other } = useQuery({ ...attemptQuery(pair ?? ''), enabled: !!pair });
  const target = useMe().data?.settings.targetBand ?? 7;

  if (error)
    return (
      <Alert tone="bad" title="Couldn't load this result" action={<Button size="sm" variant="secondary" onClick={() => void refetch()}>Try again</Button>}>
        {error.message}
      </Alert>
    );
  if (!a) return <Skeleton className="h-64 w-full" />;

  const r = a.status === 'done' ? a.analysis : null;
  const pairTasks = other ? [a, other].sort((x, y) => x.part - y.part) : null;
  const combined = pairTasks?.[0]!.analysis && pairTasks[1]!.analysis ? writingOverall(pairTasks[0]!.analysis.overall, pairTasks[1]!.analysis.overall) : null;
  const meta = `Writing · ${taskLabel(a.prompt)} · ${formatDate(a.createdAt)}`;

  const switcher = pairTasks && (
    <Segmented
      label="Task"
      size="sm"
      value={a.id}
      onChange={(id) => id !== a.id && void navigate({ to: '/writing/result/$attemptId', params: { attemptId: id }, search: { pair: a.id, tab } })}
      options={pairTasks.map((x) => ({ value: x.id, label: x.part === 1 ? 'Task 1' : 'Task 2' }))}
    />
  );

  return (
    <div>
      <Link to="/writing" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Writing
      </Link>

      {r ? (
        <ResultHeader result={r} title={a.prompt.title} meta={meta} target={target}>
          <div className="flex flex-wrap items-center gap-2">
            {switcher}
            {r.textMetrics && <Badge>{plural(r.textMetrics.words, 'word')}</Badge>}
            {a.overtime && <Badge tone="warn">Overtime</Badge>}
          </div>
        </ResultHeader>
      ) : (
        <header className="mb-6 space-y-2">
          <p className="text-sm text-muted">{meta}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-[1.75rem]">{a.prompt.title}</h1>
          {switcher}
        </header>
      )}

      {combined && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-surface-2 shadow-none">
          <div>
            <p className="font-medium">Writing band for this test</p>
            <p className="text-sm text-muted">Task 2 counts twice as much as Task 1.</p>
          </div>
          <p className={`text-3xl font-semibold tracking-tight tabular-nums ${TONE_TEXT[bandColor(combined.band, target)]}`}>{formatBand(combined.band)}</p>
        </Card>
      )}

      {a.status === 'analyzing' || a.status === 'recording' ? (
        <AnalyzingState title="Marking your answer" steps={['Measuring vocabulary and linking', 'Scoring against the band descriptors', 'Locating mistakes', 'Writing your fixes']} />
      ) : !r ? (
        <FailedState attemptId={a.id} message={a.error} />
      ) : (
        <Done a={a} r={r} tab={tab} target={target} setTab={(t) => void navigate({ search: (s) => ({ ...s, tab: t }), replace: true })} />
      )}
    </div>
  );
}

function Done({ a, r, tab, setTab, target }: { a: Attempt; r: AnalysisResult; tab: Tab; setTab: (t: Tab) => void; target: number }) {
  const text = r.text ?? a.text ?? '';
  return (
    <div className="space-y-6">
      {r.tooShort && (
        <Alert tone="warn" title="Too short to assess">
          Responses of 20 words or fewer are rated Band 1 on every criterion. Aim for at least {a.part === 1 ? 150 : 250} words.
        </Alert>
      )}
      <Tabs
        id="wr"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'essay', label: 'Essay', count: r.errors.length },
          { value: 'structure', label: 'Structure' },
          { value: 'language', label: 'Language' },
          { value: 'improve', label: 'Improve' },
        ]}
      />
      <div role="tabpanel" id="wr-panel" aria-labelledby={`wr-${tab}`} className="pb-8">
        {tab === 'overview' && (
          <OverviewPanel
            result={r}
            order={WRITING_CRITERIA}
            target={target}
            parentLink={
              a.parentAttemptId && (
                <Link to="/writing/result/$attemptId" params={{ attemptId: a.parentAttemptId }} search={{}} className="text-accent-text hover:underline">
                  View previous attempt
                </Link>
              )
            }
          />
        )}
        {tab === 'essay' &&
          (text.trim() ? (
            <Card className="sm:p-8">
              <EssayHighlights text={text} errors={r.errors} />
            </Card>
          ) : (
            <EmptyState icon={<FileText />} title="No essay text">
              Nothing was written for this task.
            </EmptyState>
          ))}
        {tab === 'structure' &&
          (r.structure ? (
            <StructureMap structure={r.structure} />
          ) : (
            <EmptyState icon={<FileText />} title="No structure analysis">
              The answer was too short to map its paragraphs.
            </EmptyState>
          ))}
        {tab === 'language' && <LanguagePanel r={r} />}
        {tab === 'improve' && <Improve a={a} r={r} text={text} />}
      </div>
    </div>
  );
}

function Improve({ a, r, text }: { a: Attempt; r: AnalysisResult; text: string }) {
  const addFixes = useMutation({
    mutationFn: () => addFixesToDeck(r.topFixes),
    onSuccess: () => toast('Fixes added to your review deck', { tone: 'good' }),
    onError: (e) => toast(e.message, { tone: 'bad' }),
  });
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <Link to="/writing/task/$promptId" params={{ promptId: a.promptId }} search={{ parent: a.id }} className={buttonStyles()}>
          <RotateCcw aria-hidden /> Retry this prompt
        </Link>
        {r.topFixes.length > 0 && (
          <Button variant="secondary" icon={<BookmarkPlus />} loading={addFixes.isPending} disabled={addFixes.isSuccess} onClick={() => addFixes.mutate()}>
            {addFixes.isSuccess ? 'Fixes in your deck' : 'Add top fixes to review deck'}
          </Button>
        )}
      </div>
      {r.rewrite.text ? (
        <section>
          <h2 className="mb-1 text-lg font-semibold">One band higher</h2>
          <p className="mb-4 max-w-prose text-sm text-muted">{r.rewrite.note || 'Study what changed and why. Don’t memorise it: examiners recognise learned essays.'}</p>
          <Card className="sm:p-8">
            <DiffView original={text} rewrite={r.rewrite.text} />
          </Card>
        </section>
      ) : (
        <EmptyState icon={<FileText />} title="No rewrite for this answer">
          Write a full-length answer to get a band-higher version to compare against.
        </EmptyState>
      )}
    </div>
  );
}
