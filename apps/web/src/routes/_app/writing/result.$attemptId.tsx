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
import { capOffTopic } from '@/components/writing/offTopic';
import { StructureMap } from '@/components/writing/StructureMap';
import { formatBand, formatDate, plural } from '@/lib/format';
import { useMe } from '@/lib/query';
import { addFixesToDeck, attemptQuery, bandColor, WRITING_CRITERIA, type Attempt } from '@/lib/result';
import { minWords, taskLabel } from '@/lib/writing';

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

  const { result: r, offTopic } = a.status === 'done' && a.analysis ? capOffTopic(a.analysis) : { result: null, offTopic: false };
  const under = !!r && !r.tooShort && !!r.textMetrics && r.textMetrics.words < minWords(a.part);
  const pairTasks = other ? [a, other].sort((x, y) => x.part - y.part) : null;
  const [p1, p2] = pairTasks?.map((x) => x.analysis && capOffTopic(x.analysis).result.overall) ?? [];
  const combined = p1 != null && p2 != null ? writingOverall(p1, p2) : null;
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
            {offTopic && <Badge tone="bad">Capped: off topic</Badge>}
            {/* Under-length answers get the word count in the alert below instead. */}
            {r.textMetrics && !under && !r.tooShort && <Badge>{plural(r.textMetrics.words, 'word')}</Badge>}
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
        <FailedState attemptId={a.id} message={a.error} retryable={a.retryable} />
      ) : (
        <Done a={a} r={r} offTopic={offTopic} under={under} tab={tab} target={target} setTab={(t) => void navigate({ search: (s) => ({ ...s, tab: t }), replace: true })} />
      )}
    </div>
  );
}

function Done({ a, r, offTopic, under, tab, setTab, target }: { a: Attempt; r: AnalysisResult; offTopic: boolean; under: boolean; tab: Tab; setTab: (t: Tab) => void; target: number }) {
  const text = r.text ?? a.text ?? '';
  const ta = a.part === 1 ? 'Task Achievement' : 'Task Response';
  return (
    <div className="space-y-6">
      {r.tooShort ? (
        <Alert tone="warn" title="Too short to assess">
          Responses of 20 words or fewer are rated Band 1 on every criterion. Aim for at least {minWords(a.part)} words.
        </Alert>
      ) : (
        (offTopic || under) && (
          // One alert for everything wrong with the essay itself, so the band breakdown stays near the top.
          <Alert tone={offTopic ? 'bad' : 'warn'} title={offTopic ? 'Off topic' : `Under ${minWords(a.part)} words`}>
            {offTopic && (
              <p>
                Your {a.part === 1 ? 'answer' : 'essay'} doesn’t answer this question, so your overall band can’t go above {formatBand(r.criteria.ta!.band + 1)}: one band over your {ta} score.
              </p>
            )}
            {under && (
              <p>
                You wrote {r.textMetrics!.words} of the {minWords(a.part)} words required, which lowers {ta}.
              </p>
            )}
          </Alert>
        )
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
      {a.parentAttemptId && <RetryDiff parentId={a.parentAttemptId} text={text} />}
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

/** Spec §7: a retry shows a word diff against the attempt it retried. */
function RetryDiff({ parentId, text }: { parentId: string; text: string }) {
  const { data: parent } = useQuery(attemptQuery(parentId));
  const before = parent?.analysis?.text ?? parent?.text;
  if (!before) return null;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Since your last attempt</h2>
      <p className="mb-4 max-w-prose text-sm text-muted">Your previous answer against this one.</p>
      <Card className="sm:p-8">
        <DiffView original={before} rewrite={text} cleanLabel="This attempt" />
      </Card>
    </section>
  );
}
