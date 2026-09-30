import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, MicOff, RotateCcw } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { AnalyzingState, FailedState, OverviewPanel, ResultHeader } from '@/components/results';
import { AudioBar, useAudio } from '@/components/speaking/AudioBar';
import { CueCard } from '@/components/speaking/CueCard';
import { ImprovePanel } from '@/components/speaking/ImprovePanel';
import { LanguagePanel } from '@/components/speaking/LanguagePanel';
import { SessionSwitcher } from '@/components/speaking/SessionSwitcher';
import { Transcript } from '@/components/speaking/Transcript';
import { Alert, buttonStyles, Card, EmptyState, PageHeader, Skeleton, Tabs, type ButtonVariant } from '@/components/ui';
import { formatDate, formatDuration } from '@/lib/format';
import { useMe } from '@/lib/query';
import { attemptQuery, notAssessed, offTopicAnswers, SPEAKING_CRITERIA, type Attempt } from '@/lib/result';

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

// Recharts (~100 KB gz) loads only when the Fluency tab opens.
const FluencyPanel = lazy(() => import('@/components/speaking/FluencyPanel').then((m) => ({ default: m.FluencyPanel })));

const STEPS = ['Uploading', 'Transcribing', 'Measuring fluency', 'Scoring against the band descriptors'];

function ResultPage() {
  const { attemptId } = Route.useParams();
  const { session, tab = 'overview' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: a } = useQuery(attemptQuery(attemptId));
  const { data: me } = useMe();
  const audio = useAudio();
  if (!a) return null; // loader guarantees data; keeps types narrow
  const target = me?.settings.targetBand ?? 7;
  const r = a.analysis;
  const switcher = session && <SessionSwitcher sessionId={session} currentId={a.id} />;
  const back = (
    <Link to="/speaking" className={buttonStyles({ variant: 'ghost', size: 'sm', className: '-ml-3 text-muted-foreground' })}>
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
  const meta = `Speaking · Part ${a.part} · ${formatDate(a.createdAt)}${a.durationMs ? ` · ${formatDuration(a.durationMs)}` : ''}`;

  if (a.status !== 'done' || !r) {
    return (
      <div>
        <PageHeader title={a.prompt.title} description={meta} back={back} />
        {switcher && <div className="mb-6">{switcher}</div>}
        {a.status === 'analyzing' ? (
          <AnalyzingState steps={STEPS} stepSeconds={7} />
        ) : (
          // Not a dead end: the recording (if any), the questions, and ways to record again or move on.
          <div className="space-y-6">
            {a.status === 'recording' ? (
              // The audio never arrived, so there is nothing to re-analyse: record it again.
              <FailedState attemptId={a.id} title="Not submitted" message="This recording never finished uploading, so there is nothing to analyse." action={retryLink(undefined, 'sm', true)} extra={another} />
            ) : (
              <FailedState attemptId={a.id} message={a.error} retryable={a.retryable} extra={<>{retryLink('secondary', 'sm', true)}{another}</>} />
            )}
            {a.audioUrl && <AudioBar src={a.audioUrl} audioRef={audio.ref} durationS={a.durationMs ? a.durationMs / 1000 : undefined} />}
            <Questions a={a} />
          </div>
        )}
      </div>
    );
  }

  if (notAssessed(r)) {
    return (
      <div className="space-y-6">
        <PageHeader title={a.prompt.title} description={meta} back={back} />
        {switcher}
        <EmptyState icon={<MicOff />} title="No speech detected" action={retry}>
          We couldn't hear enough speech in this recording to score it. Check the right microphone is selected, speak a little closer to it, and keep talking for at least 20 seconds.
        </EmptyState>
        {a.audioUrl && <AudioBar src={a.audioUrl} audioRef={audio.ref} durationS={a.durationMs ? a.durationMs / 1000 : undefined} />}
      </div>
    );
  }

  const setTab = (t: Tab) => void navigate({ search: (s) => ({ ...s, tab: t === 'overview' ? undefined : t }), replace: true, resetScroll: false });
  const parentLink = r.comparison && (
    <Link to="/speaking/result/$attemptId" params={{ attemptId: r.comparison.parentAttemptId }} className={buttonStyles({ variant: 'link', className: 'hit' })}>
      See last try
    </Link>
  );

  const off = offTopicAnswers(r);
  return (
    <div>
      <div className="mb-2">{back}</div>
      <ResultHeader result={r} title={a.prompt.title} meta={meta} target={target}>
        {switcher}
      </ResultHeader>
      {off && (
        <Alert tone="bad" title="Off topic" className="mb-6">
          {off.total > 1 ? `${off.off} of ${off.total} answers didn’t` : 'Your answer didn’t'} address the question.{' '}
          <Link to="." search={(s) => ({ ...s, tab: 'language' })} hash="relevance" replace className={buttonStyles({ variant: 'link' })}>
            See details in Language
          </Link>
        </Alert>
      )}
      {/* One sticky strip: the tabs, plus the player on the tabs that seek into the recording. */}
      <div className="sticky top-0 z-20 -mx-4 bg-bg px-4 pb-3 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
        <Tabs id="res" value={tab} onChange={setTab} items={[
          { value: 'overview', label: 'Overview' },
          { value: 'transcript', label: 'Transcript', count: r.errors.length },
          { value: 'fluency', label: 'Fluency' },
          { value: 'language', label: 'Language' },
          { value: 'improve', label: 'Improve' },
        ]} />
        {a.audioUrl && tab !== 'overview' && tab !== 'improve' && (
          <div className="mt-3">
            <AudioBar src={a.audioUrl} audioRef={audio.ref} durationS={a.durationMs ? a.durationMs / 1000 : undefined} />
          </div>
        )}
      </div>
      <div role="tabpanel" id="res-panel" aria-labelledby={`res-${tab}`} tabIndex={-1} className="pt-3 pb-8">
        <Panel tab={tab} a={a} target={target} audio={audio.controls} retry={retry} parentLink={parentLink} />
      </div>
    </div>
  );
}

function Panel({ tab, a, target, audio, retry, parentLink }: { tab: Tab; a: Attempt; target: number; audio: ReturnType<typeof useAudio>['controls']; retry: ReactNode; parentLink: ReactNode }) {
  const r = a.analysis!;
  switch (tab) {
    case 'overview':
      return <OverviewPanel result={r} order={SPEAKING_CRITERIA} target={target} parentLink={parentLink} />;
    case 'transcript':
      return <Transcript result={r} audio={audio} />;
    case 'fluency':
      return r.metrics ? (
        <Suspense fallback={<Skeleton className="h-72 w-full rounded-card" />}>
          <FluencyPanel metrics={r.metrics} audio={audio} fc={r.criteria.fc} target={target} />
        </Suspense>
      ) : null;
    case 'language':
      return <LanguagePanel result={r} audio={audio} />;
    case 'improve':
      return <ImprovePanel result={r} retry={retry} />;
  }
}

/** What the candidate was asked: the cue card (Part 2) or the question list. */
function Questions({ a }: { a: Attempt }) {
  if (a.part === 2) return <CueCard prompt={a.prompt} />;
  const qs = a.prompt.followUps?.length ? a.prompt.followUps : [a.prompt.body];
  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold">Questions you were asked</h2>
      <ol className="list-decimal space-y-1.5 pl-5 text-[0.9375rem]">
        {qs.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>
    </Card>
  );
}
