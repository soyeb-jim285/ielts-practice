import { writingOverall, type RepeatedWord } from '@ielts/core';
import type { AnalysisResult } from '@server/ai/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Check, FileText, RotateCcw } from 'lucide-react';
import { RemoveAttempt } from '@/components/history/RemoveAttempt';
import { ActionRow, CriteriaStrip, gapLine, ScoreHero, Section, StatusLine, ResultScaffold } from '@/components/result';
import { AnalyzingState, FailedState } from '@/components/results';
import { Alert, Badge, Button, buttonStyles, EmptyState, PageContainer, PageHeader, Segmented, Skeleton, StickyTabs, Tabs, toast } from '@/components/ui';
import { DiffView } from '@/components/writing/DiffView';
import { EssayHighlights } from '@/components/writing/EssayHighlights';
import { LanguagePanel } from '@/components/writing/LanguagePanel';
import { capOffTopic } from '@/components/writing/offTopic';
import { bandSummary, lastTryLine, OverviewPanel } from '@/components/writing/OverviewPanel';
import { StructureMap } from '@/components/writing/StructureMap';
import { formatBand, formatDate, plural } from '@/lib/format';
import { KeepResult } from '@/components/community/KeepResult';
import { useMe } from '@/lib/query';
import { attemptQuery } from '@/lib/attempt';
import { addFixesToDeck, WRITING_CRITERIA, type Attempt } from '@/lib/result';
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
  const addFixes = useMutation({
    mutationFn: () => addFixesToDeck(a!.analysis!.topFixes),
    onSuccess: () => toast('Fixes added to your review deck', { tone: 'good' }),
    onError: (e) => toast(e.message, { tone: 'bad' }),
  });

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

  const rm = <RemoveAttempt kind="attempt" id={a.id} title={a.prompt.title} variant="menu" onRemoved={() => void navigate({ to: '/writing' })} />;
  const switcher = pairTasks && (
    <Segmented
      label="Task"
      size="sm"
      value={a.id}
      onChange={(id) => id !== a.id && void navigate({ to: '/writing/result/$attemptId', params: { attemptId: id }, search: { pair: a.id, tab } })}
      options={pairTasks.map((x) => ({ value: x.id, label: x.part === 1 ? 'Task 1' : 'Task 2' }))}
    />
  );
  const setTab = (t: Tab) => void navigate({ search: (s) => ({ ...s, tab: t }), replace: true, resetScroll: false });

  if (!r)
    return (
      <PageContainer>
        <PageHeader title={a.prompt.title} description={meta} actions={<>{switcher}{rm}</>} back={<Link to="/writing" className={buttonStyles({ variant: 'ghost', size: 'sm', className: '-ml-3 text-muted' })}>Writing</Link>} />
        <KeepResult />
        {a.status === 'analyzing' || a.status === 'recording' ? (
          <AnalyzingState title="Marking your answer" steps={['Measuring vocabulary and linking', 'Scoring against the band descriptors', 'Locating mistakes', 'Writing your fixes']} />
        ) : (
          <FailedState attemptId={a.id} message={a.error} retryable={a.retryable} />
        )}
      </PageContainer>
    );

  const capNote = offTopic ? `the ${a.part === 1 ? 'answer' : 'essay'} is off topic` : undefined;
  const { how } = bandSummary(r, WRITING_CRITERIA, capNote);
  const added = !!a.topFixesInDeck || addFixes.isSuccess;
  const hero = combined ? (
    <ScoreHero
      value={combined.band}
      label="Writing band for this test"
      target={target}
      estimate={r.calibrated === false}
      rawAverage={combined.raw}
      lede={
        <>
          <span className={`font-medium ${TONE_TEXT[gapLine(combined.band, target).tone]}`}>{gapLine(combined.band, target).lead}</span> {gapLine(combined.band, target).rest}. Task 2 counts twice as much as Task 1.
        </>
      }
      note={<p>Writing band for the test: Task 1 once, Task 2 twice, rounded to the nearest half band.</p>}
      exceptions={
        <>
          {offTopic && <Badge tone="bad">Capped: off topic</Badge>}
          {a.overtime && <Badge tone="warn">Overtime</Badge>}
        </>
      }
    />
  ) : (
    <ScoreHero
      value={r.overall}
      target={target}
      range={r.range}
      estimate={r.calibrated === false}
      rawAverage={r.overallRaw}
      secondary={r.comparison ? lastTryLine(r.overall, r.comparison.parentOverall) : undefined}
      note={<p>{how}</p>}
      exceptions={
        offTopic || a.overtime ? (
          <>
            {offTopic && <Badge tone="bad">Capped: off topic</Badge>}
            {a.overtime && <Badge tone="warn">Overtime</Badge>}
          </>
        ) : undefined
      }
    />
  );

  return (
    <ResultScaffold
      back={{ to: '/writing', label: 'Writing' }}
      title={a.prompt.title}
      promptFull={
        <div className="max-w-[68ch] space-y-3 whitespace-pre-line">
          <p>{a.prompt.body}</p>
          {a.prompt.bullets?.length ? <ul className="list-disc pl-6">{a.prompt.bullets.map((b) => <li key={b}>{b}</li>)}</ul> : null}
        </div>
      }
      meta={<StatusLine items={[meta, r.textMetrics && !r.tooShort && plural(r.textMetrics.words, 'word')]} />}
      actions={rm}
      hero={hero}
      strip={
        <>
          {switcher}
          {combined && pairTasks && <CriteriaStrip cols={2} items={pairTasks.map((x, i) => ({ key: x.id, label: x.part === 1 ? 'Task 1' : 'Task 2', band: [p1, p2][i]!, target }))} />}
          <KeepResult />
        </>
      }
      action={
        <ActionRow
          primary={
            <Link to="/writing/task/$promptId" params={{ promptId: a.promptId }} search={{ parent: a.id }} className={buttonStyles()}>
              <RotateCcw aria-hidden /> Retry this prompt
            </Link>
          }
          links={[
            r.topFixes.length > 0 &&
              (added ? (
                <span className="inline-flex items-center gap-1.5 text-good-text">
                  <Check className="size-4" aria-hidden /> Fixes in review deck
                </span>
              ) : (
                <Button variant="link" loading={addFixes.isPending} onClick={() => addFixes.mutate()}>
                  Add fixes to review deck
                </Button>
              )),
            a.parentAttemptId && (
              <Link to="/writing/result/$attemptId" params={{ attemptId: a.parentAttemptId }} search={{}} className={buttonStyles({ variant: 'link' })}>
                View previous attempt
              </Link>
            ),
          ].filter(Boolean)}
        />
      }
      tabs={
        // Stays under the top edge while a long panel scrolls.
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
      }
    >
      <Done a={a} r={r} offTopic={offTopic} under={under} tab={tab} target={target} capNote={capNote} setTab={setTab} />
    </ResultScaffold>
  );
}

function Done({ a, r, offTopic, under, tab, setTab, target, capNote }: { a: Attempt; r: AnalysisResult; offTopic: boolean; under: boolean; tab: Tab; setTab: (t: Tab) => void; target: number; capNote?: string }) {
  const text = r.text ?? a.text ?? '';
  const [lean, setLean] = useState<RepeatedWord | null>(null);
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
    <div key={tab} role="tabpanel" id="wr-panel" aria-labelledby={`wr-${tab}`} className="page-enter space-y-8 md:space-y-12">
      {tab === 'overview' && <OverviewPanel result={r} order={WRITING_CRITERIA} target={target} alert={alert} capNote={capNote} />}
      {tab === 'essay' &&
        (text.trim() ? (
          <EssayHighlights text={text} errors={r.errors} lean={lean} onClear={() => setLean(null)} />
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
      {tab === 'language' && <LanguagePanel r={r} lean={lean} onLean={(w) => (setLean(w), w && text.trim() && setTab('essay'))} />}
      {tab === 'improve' && <Improve a={a} r={r} text={text} />}
    </div>
  );
}

function Improve({ a, r, text }: { a: Attempt; r: AnalysisResult; text: string }) {
  return (
    <>
      {a.parentAttemptId && <RetryDiff parentId={a.parentAttemptId} text={text} />}
      {r.rewrite.text ? (
        <Section title="One band higher" caption={r.rewrite.note || 'Study what changed and why. Don’t memorise it: examiners recognise learned essays.'}>
          <DiffView original={text} rewrite={r.rewrite.text} />
        </Section>
      ) : (
        <EmptyState icon={<FileText />} title="No rewrite for this answer">
          Write a full-length answer to get a band-higher version to compare against.
        </EmptyState>
      )}
    </>
  );
}

/** Spec §7: a retry shows a word diff against the attempt it retried. */
function RetryDiff({ parentId, text }: { parentId: string; text: string }) {
  const { data: parent } = useQuery(attemptQuery(parentId));
  const before = parent?.analysis?.text ?? parent?.text;
  if (!before) return null;
  return (
    <Section title="Since your last attempt" caption="Your previous answer against this one.">
      <DiffView original={before} rewrite={text} cleanLabel="This attempt" defaultView="diff" />
    </Section>
  );
}

/** Back link, header, band strip, tabs and a panel in the shape of the loaded page, so nothing jumps when the result arrives. */
function ResultSkeleton() {
  return (
    <PageContainer aria-busy aria-label="Loading result" className="max-w-[60rem] space-y-8 md:space-y-12">
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-9 w-full max-w-xl" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex items-end gap-10">
          <Skeleton className="h-[4.5rem] w-32" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-72 w-full" />
    </PageContainer>
  );
}
