import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, MicOff, RotateCcw } from 'lucide-react';
import type { RepeatedWord } from '@ielts/core';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { KeepResult, RefundNote } from '@/components/community/KeepResult';
import { RemoveAttempt } from '@/components/history/RemoveAttempt';
import { AnalyzingState, FailedState, OverviewPanel, ResultHeader } from '@/components/results';
import { AudioBar, useAudio } from '@/components/speaking/AudioBar';
import { CueCard } from '@/components/speaking/CueCard';
import { ImprovePanel } from '@/components/speaking/ImprovePanel';
import { NotSubmittedActions } from '@/components/speaking/PendingUploads';
import { LanguagePanel } from '@/components/speaking/LanguagePanel';
import { SessionSwitcher } from '@/components/speaking/SessionSwitcher';
import { Transcript } from '@/components/speaking/Transcript';
import { Alert, Badge, buttonStyles, Card, EmptyState, PageContainer, PageHeader, Skeleton, StickyTabs, Tabs, type ButtonVariant } from '@/components/ui';
import { formatDate, formatDuration } from '@/lib/format';
import { useMe } from '@/lib/query';
import { attemptQuery } from '@/lib/attempt';
import { timelineMarkers, type Timeline } from '@/lib/timeline';
import { notAssessed, offTopicAnswers, sentenceCase, SPEAKING_CRITERIA, type Attempt } from '@/lib/result';

const TABS = ['overview', 'transcript', 'fluency', 'language', 'improve'] as const;
type Tab = (typeof TABS)[number];
type Search = { session?: string; tab?: Tab };

export const Route = createFileRoute('/_app/speaking/result/$attemptId')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    session: typeof s.session === 'string' ? s.session : undefined,
    tab: TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined,
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(attemptQuery(params.attemptId)),
  component: ResultPage,
});

// Recharts (~100 KB gz) is its own chunk: fetched while the result is scoring (or once a finished result is open), so the Fluency tab does not pop in late.
const loadFluency = () => import('@/components/speaking/FluencyPanel').then((m) => ({ default: m.FluencyPanel }));
const FluencyPanel = lazy(loadFluency);

const STEPS = ['Uploading', 'Transcribing', 'Measuring fluency', 'Scoring against the band descriptors'];

function ResultPage() {
  const { attemptId } = Route.useParams();
  const { session, tab = 'overview' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: a } = useQuery(attemptQuery(attemptId));
  const { data: me } = useMe();
  const audio = useAudio();
  const [lean, setLean] = useState<RepeatedWord | null>(null);
  const timeline = useMemo(() => (a?.analysis?.words ? timelineMarkers(a.analysis) : undefined), [a?.analysis]);
  const warm = a?.status === 'analyzing' || (a?.status === 'done' && !!a.analysis?.metrics);
  useEffect(() => {
    if (warm) void loadFluency();
  }, [warm]);
  if (!a) return null; // loader guarantees data; keeps types narrow
  const target = me?.settings.targetBand ?? 7;
  const r = a.analysis;
  const switcher = session && <SessionSwitcher sessionId={session} currentId={a.id} />;
  const back = (
    <Link to="/speaking" className={buttonStyles({ variant: 'ghost', size: 'sm', className: '-ml-3 text-muted' })}>
      <ArrowLeft aria-hidden /> Speaking
    </Link>
  );
  const retryLink = (variant?: ButtonVariant, size?: 'sm', again?: boolean) => (
    <Link to="/speaking/session" search={{ mode: `p${a.part}` as 'p1' | 'p2' | 'p3', promptId: a.promptId, parent: a.id }} className={buttonStyles({ variant, size })}>
      {/* A retry re-records the whole part, so name the part when it has several questions. */}
      <RotateCcw aria-hidden /> {again ? 'Record again' : (a.prompt.followUps?.length ?? 0) > 1 ? `Retry Part ${a.part}` : 'Retry this question'}
    </Link>
  );
  const retry = retryLink();
  const another = (
    <Link to="/speaking" className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
      Practise another part
    </Link>
  );
  // A Part 1 attempt covers several questions on a topic, so say so; the title starts with the part so it is told apart from a Part 3 on the same topic.
  const nq = r?.questions?.length ?? 0;
  const title = a.part === 1 ? `Part 1: ${sentenceCase(a.prompt.title)}` : sentenceCase(a.prompt.title);
  const meta = `Speaking${a.part === 1 ? '' : `, Part ${a.part}`}${nq > 1 ? `, ${nq} questions` : ''}, ${formatDate(a.createdAt)}${a.durationMs ? `, ${formatDuration(a.durationMs)}` : ''}`;

  const rm = <RemoveAttempt kind="attempt" id={a.id} title={title} variant="menu" onRemoved={() => void navigate({ to: '/speaking' })} />;

  if (a.status !== 'done' || !r) {
    return (
      <PageContainer>
        <PageHeader title={title} description={meta} back={back} actions={rm} />
        <KeepResult />
        {switcher && <div className="mb-6">{switcher}</div>}
        {a.status === 'analyzing' ? (
          <AnalyzingState steps={STEPS} stepSeconds={7} />
        ) : (
          // Not a dead end: the recording (if any), the questions, and ways to record again or move on.
          <div className="space-y-6">
            {a.status === 'recording' ? (
              // The audio never arrived: resume it if this device still holds the recording, else record again; either way it can be deleted.
              <FailedState
                attemptId={a.id}
                title="Not submitted"
                message="This recording never finished uploading. If this device still has it, you can resume the upload."
                action={<NotSubmittedActions attemptId={a.id} onDeleted={() => void navigate({ to: '/history' })} recordAgain={retryLink(undefined, 'sm', true)} />}
                extra={another}
              />
            ) : (
              <FailedState attemptId={a.id} message={a.error} retryable={a.retryable} extra={<>{retryLink('outline', 'sm', true)}{another}</>} />
            )}
            {a.audioUrl && a.status !== 'recording' && <AudioBar src={a.audioUrl} audioRef={audio.ref} durationS={a.durationMs ? a.durationMs / 1000 : undefined} />}
            <Questions a={a} />
          </div>
        )}
      </PageContainer>
    );
  }

  if (notAssessed(r)) {
    return (
      <PageContainer>
        <PageHeader title={title} description={meta} back={back} actions={rm} />
        <KeepResult />
        <div className="space-y-6">
          {switcher}
          <EmptyState icon={<MicOff />} title="No speech detected" action={retry}>
            We couldn't hear enough speech in this recording to score it. Check the right microphone is selected, speak a little closer to it, and keep talking for at least 20 seconds.
            {!session && <RefundNote />}
          </EmptyState>
          {a.audioUrl && <AudioBar src={a.audioUrl} audioRef={audio.ref} durationS={a.durationMs ? a.durationMs / 1000 : undefined} />}
        </div>
      </PageContainer>
    );
  }

  const setTab = (t: Tab) => void navigate({ search: (s) => ({ ...s, tab: t === 'overview' ? undefined : t }), replace: true, resetScroll: false });
  // Picking a word on Language jumps to the transcript with every use highlighted.
  const onLean = (w: RepeatedWord | null) => {
    setLean(w);
    if (w) setTab('transcript');
  };
  const parentLink = r.comparison && (
    <Link to="/speaking/result/$attemptId" params={{ attemptId: r.comparison.parentAttemptId }} className={buttonStyles({ variant: 'link', className: 'hit' })}>
      See last try
    </Link>
  );

  const off = offTopicAnswers(r);
  return (
    <PageContainer>
      <ResultHeader
        result={r}
        title={title}
        meta={meta}
        target={target}
        back={back}
        actions={rm}
        flags={
          off && (
            <Link to="." search={(s) => ({ ...s, tab: 'language' })} hash="relevance" replace className="rounded-full">
              <Badge tone="bad">Off topic</Badge>
            </Link>
          )
        }
      >
        {switcher}
      </ResultHeader>
      <KeepResult />
      {/* One sticky strip: the tabs, plus the player on the tabs that seek into the recording. */}
      <StickyTabs>
        <Tabs id="res" value={tab} onChange={setTab} className="max-sm:[&_button]:px-1.5" items={[
          { value: 'overview', label: 'Overview' },
          // "Text" on phones so all five tabs fit without scrolling.
          { value: 'transcript', label: <><span className="sm:hidden">Text</span><span className="max-sm:hidden">Transcript</span></>, count: r.errors.length },
          { value: 'fluency', label: 'Fluency' },
          { value: 'language', label: 'Language' },
          { value: 'improve', label: 'Improve' },
        ]} />
        {a.audioUrl && tab !== 'overview' && tab !== 'improve' && (
          <div className="mt-3 pb-3">
            <AudioBar src={a.audioUrl} audioRef={audio.ref} durationS={a.durationMs ? a.durationMs / 1000 : undefined} timeline={timeline} onPick={audio.controls.pick} />
          </div>
        )}
      </StickyTabs>
      <div role="tabpanel" id="res-panel" aria-labelledby={`res-${tab}`} tabIndex={-1} className="pt-5 pb-8">
        <Panel tab={tab} a={a} timeline={timeline} target={target} audio={audio.controls} retry={retry} parentLink={parentLink} off={off} lean={lean} onLean={onLean} />
      </div>
    </PageContainer>
  );
}

function Panel({ tab, a, timeline, target, audio, retry, parentLink, off, lean, onLean }: { lean: RepeatedWord | null; onLean: (w: RepeatedWord | null) => void; tab: Tab; a: Attempt; timeline?: Timeline; target: number; audio: ReturnType<typeof useAudio>['controls']; retry: ReactNode; parentLink: ReactNode; off: ReturnType<typeof offTopicAnswers> }) {
  const r = a.analysis!;
  switch (tab) {
    case 'overview':
      return (
        <OverviewPanel
          result={r}
          order={SPEAKING_CRITERIA}
          target={target}
          parentLink={parentLink}
          alert={
            off && (
              <Alert tone="bad" title="Off topic">
                {off.total > 1 ? `${off.off} of ${off.total} answers didn’t` : 'Your answer didn’t'} address the question.{' '}
                <Link to="." search={(s) => ({ ...s, tab: 'language' })} hash="relevance" replace className={buttonStyles({ variant: 'link' })}>
                  See details in Language
                </Link>
              </Alert>
            )
          }
        />
      );
    case 'transcript':
      return <Transcript result={r} audio={audio} lean={lean} onClear={() => onLean(null)} />;
    case 'fluency':
      return r.metrics && timeline ? (
        <Suspense fallback={<Skeleton className="h-72 w-full rounded-lg" />}>
          <FluencyPanel metrics={r.metrics} timeline={timeline} audio={audio} fc={r.criteria.fc} target={target} />
        </Suspense>
      ) : null;
    case 'language':
      return <LanguagePanel result={r} audio={audio} lean={lean} onLean={onLean} />;
    case 'improve':
      return <ImprovePanel result={r} retry={retry} inDeck={!!a.topFixesInDeck} />;
  }
}

/** What the candidate was asked: the cue card (Part 2) or the question list. */
function Questions({ a }: { a: Attempt }) {
  if (a.part === 2) return <CueCard prompt={a.prompt} />;
  const qs = a.prompt.followUps?.length ? a.prompt.followUps : [a.prompt.body];
  return (
    <Card>
      <h2 className="type-subheading mb-3">Questions you were asked</h2>
      <ol className="type-reading-sm list-decimal space-y-1.5 pl-5 marker:font-sans marker:text-muted">
        {qs.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>
    </Card>
  );
}
