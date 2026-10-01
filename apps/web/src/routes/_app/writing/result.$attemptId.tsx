import { writingOverall } from '@ielts/core';
import type { AnalysisResult } from '@server/ai/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, BookmarkPlus, FileText, RotateCcw } from 'lucide-react';
import { AnalyzingState, FailedState, OverviewPanel, ResultHeader } from '@/components/results';
import { Alert, Badge, Button, buttonStyles, Card, EmptyState, PageContainer, PageHeader, Segmented, Skeleton, StickyTabs, Tabs, toast } from '@/components/ui';
import { DiffView } from '@/components/writing/DiffView';
import { EssayHighlights } from '@/components/writing/EssayHighlights';
import { LanguagePanel } from '@/components/writing/LanguagePanel';
import { capOffTopic } from '@/components/writing/offTopic';
import { PromptTitle, PromptToggle } from '@/components/writing/PromptTitle';
import { StructureMap } from '@/components/writing/StructureMap';
import { formatBand, formatDate, plural } from '@/lib/format';
import { useMe } from '@/lib/query';
import { attemptQuery } from '@/lib/attempt';
import { addFixesToDeck, bandColor, WRITING_CRITERIA, type Attempt } from '@/lib/result';
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
  const [showPrompt, setShowPrompt] = useState(false);

  if (error)
    return (
      <PageContainer>
      <Alert tone="bad" title="Couldn't load this result" action={<Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button>}>
        {error.message}
      </Alert>
      </PageContainer>
    );
  if (!a) return <ResultSkeleton />;

  const { result: r, offTopic } = a.status === 'done' && a.analysis ? capOffTopic(a.analysis) : { result: null, offTopic: false };
  const under = !!r && !r.tooShort && !!r.textMetrics && r.textMetrics.words < minWords(a.part);
  const pairTasks = other ? [a, other].sort((x, y) => x.part - y.part) : null;
  const [p1, p2] = pairTasks?.map((x) => x.analysis && capOffTopic(x.analysis).result.overall) ?? [];
  const combined = p1 != null && p2 != null ? writingOverall(p1, p2) : null;
  const meta = `Writing, ${taskLabel(a.prompt)}, ${formatDate(a.createdAt)}`;

  const back = (
    <Link to="/writing" className={buttonStyles({ variant: 'ghost', size: 'sm', className: '-ml-3 text-muted' })}>
      <ArrowLeft aria-hidden /> Writing
    </Link>
  );
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
    <PageContainer>
      {r ? (
        <ResultHeader
          result={r}
          title={<PromptTitle title={a.prompt.title} open={showPrompt} />}
          meta={
            <>
              {meta}
              <PromptToggle title={a.prompt.title} open={showPrompt} onToggle={() => setShowPrompt((o) => !o)} />
            </>
          }
          target={target}
          back={back}
          flags={
            <>
              {/* On phones the overview banner says it; the chip row stays on one line. */}
              {offTopic && <Badge tone="bad" className="max-sm:hidden">Capped: off topic</Badge>}
              {/* Under-length answers get the word count in the alert instead. */}
              {r.textMetrics && !under && !r.tooShort && <Badge>{plural(r.textMetrics.words, 'word')}</Badge>}
              {a.overtime && <Badge tone="warn">Overtime</Badge>}
            </>
          }
        >
          {switcher}
        </ResultHeader>
      ) : (
        <PageHeader title={a.prompt.title} description={meta} actions={switcher} back={back} />
      )}

      {combined && (
        <Card className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="type-subheading">Writing band for this test</h2>
            <p className="type-caption mt-0.5">Task 2 counts twice as much as Task 1.</p>
          </div>
          <p className={`type-band text-4xl ${TONE_TEXT[bandColor(combined.band, target)]}`}>{formatBand(combined.band)}</p>
        </Card>
      )}

      {a.status === 'analyzing' || a.status === 'recording' ? (
        <AnalyzingState title="Marking your answer" steps={['Measuring vocabulary and linking', 'Scoring against the band descriptors', 'Locating mistakes', 'Writing your fixes']} />
      ) : !r ? (
        <FailedState attemptId={a.id} message={a.error} retryable={a.retryable} />
      ) : (
        <Done a={a} r={r} offTopic={offTopic} under={under} tab={tab} target={target} setTab={(t) => void navigate({ search: (s) => ({ ...s, tab: t }), replace: true })} />
      )}
    </PageContainer>
  );
}

function Done({ a, r, offTopic, under, tab, setTab, target }: { a: Attempt; r: AnalysisResult; offTopic: boolean; under: boolean; tab: Tab; setTab: (t: Tab) => void; target: number }) {
  const text = r.text ?? a.text ?? '';
  const ta = a.part === 1 ? 'Task Achievement' : 'Task Response';
  // One alert for everything wrong with the essay itself; it lives in Overview so the band breakdown is the first thing on the page.
  const alert = r.tooShort ? (
    <Alert tone="warn" title="Too short to assess">
      Responses of 20 words or fewer are rated Band 1 on every criterion. Aim for at least {minWords(a.part)} words.
    </Alert>
  ) : (
    (offTopic || under) && (
      <Alert
        tone={offTopic ? 'bad' : 'warn'}
        title={offTopic ? 'Off topic' : `Under ${minWords(a.part)} words`}
        className={offTopic ? 'bg-bad-soft/50' : undefined}
        action={
          offTopic && (
            <Link to="/writing/task/$promptId" params={{ promptId: a.promptId }} search={{ parent: a.id }} className={buttonStyles({ size: 'sm' })}>
              <RotateCcw aria-hidden /> Rewrite on this topic
            </Link>
          )
        }
      >
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
  );
  return (
    <div className="space-y-4">
      {/* Stays under the top edge while a long panel scrolls. */}
      <StickyTabs>
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
      </StickyTabs>
      <div key={tab} role="tabpanel" id="wr-panel" aria-labelledby={`wr-${tab}`} className="page-enter pt-6 pb-8">
        {tab === 'overview' && (
          <OverviewPanel
            result={r}
            order={WRITING_CRITERIA}
            target={target}
            alert={alert}
            capNote={offTopic ? `the ${a.part === 1 ? 'answer' : 'essay'} is off topic` : undefined}
            parentLink={
              a.parentAttemptId && (
                <Link to="/writing/result/$attemptId" params={{ attemptId: a.parentAttemptId }} search={{}} className={buttonStyles({ variant: 'link' })}>
                  View previous attempt
                </Link>
              )
            }
          />
        )}
        {tab === 'essay' &&
          (text.trim() ? (
            <EssayHighlights text={text} errors={r.errors} />
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
    <div className="space-y-10">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link to="/writing/task/$promptId" params={{ promptId: a.promptId }} search={{ parent: a.id }} className={buttonStyles()}>
          <RotateCcw aria-hidden /> Retry this prompt
        </Link>
        {r.topFixes.length > 0 && (
          <Button variant="outline" icon={<BookmarkPlus />} loading={addFixes.isPending} disabled={addFixes.isSuccess} onClick={() => addFixes.mutate()}>
            {addFixes.isSuccess ? 'Fixes in your deck' : 'Add top fixes to review deck'}
          </Button>
        )}
      </div>
      {a.parentAttemptId && <RetryDiff parentId={a.parentAttemptId} text={text} />}
      {r.rewrite.text ? (
        <section>
          <h2 className="type-heading mb-1">One band higher</h2>
          <p className="mb-4 max-w-prose text-sm text-muted text-pretty">{r.rewrite.note || 'Study what changed and why. Don’t memorise it: examiners recognise learned essays.'}</p>
          <Card padded={false} className="px-5 py-6 sm:px-10 sm:py-9">
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
      <h2 className="type-heading mb-1">Since your last attempt</h2>
      <p className="mb-4 max-w-prose text-sm text-muted">Your previous answer against this one.</p>
      <Card padded={false} className="px-5 py-6 sm:px-10 sm:py-9">
        <DiffView original={before} rewrite={text} cleanLabel="This attempt" />
      </Card>
    </section>
  );
}

/** Back link, header, band strip, tabs and a panel in the shape of the loaded page, so nothing jumps when the result arrives. */
function ResultSkeleton() {
  return (
    <PageContainer aria-busy aria-label="Loading result">
      <Skeleton className="mb-3 h-8 w-28" />
      <div className="mb-6 space-y-3 md:mb-8">
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="mb-8 flex items-end gap-10 border-y border-line py-6 md:mb-10">
        <Skeleton className="h-[4.5rem] w-32" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="mb-6 h-10 w-full" />
      <Skeleton className="h-72 w-full" />
    </PageContainer>
  );
}
