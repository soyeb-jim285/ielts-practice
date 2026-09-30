import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, MicOff, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { AnalyzingState, FailedState, OverviewPanel, ResultHeader } from '@/components/results';
import { AudioBar, useAudio } from '@/components/speaking/AudioBar';
import { FluencyPanel } from '@/components/speaking/FluencyPanel';
import { ImprovePanel } from '@/components/speaking/ImprovePanel';
import { LanguagePanel } from '@/components/speaking/LanguagePanel';
import { SessionSwitcher } from '@/components/speaking/SessionSwitcher';
import { Transcript } from '@/components/speaking/Transcript';
import { buttonStyles, EmptyState, PageHeader, Tabs } from '@/components/ui';
import { formatDate, formatDuration } from '@/lib/format';
import { useMe } from '@/lib/query';
import { attemptQuery, SPEAKING_CRITERIA, type Attempt } from '@/lib/result';

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
    <Link to="/speaking" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> Speaking
    </Link>
  );
  const retry = (
    <Link to="/speaking/session" search={{ mode: `p${a.part}` as 'p1' | 'p2' | 'p3', promptId: a.promptId, parent: a.id }} className={buttonStyles()}>
      <RotateCcw className="size-4" aria-hidden /> Retry this question
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
        ) : a.status === 'recording' ? (
          // The audio never arrived, so there is nothing to re-analyse: record it again.
          <FailedState attemptId={a.id} title="Not submitted" message="This recording never finished uploading, so there is nothing to analyse." action={retry} />
        ) : (
          <FailedState attemptId={a.id} message={a.error} />
        )}
      </div>
    );
  }

  if (r.noSpeech) {
    return (
      <div className="space-y-6">
        <PageHeader title={a.prompt.title} description={meta} back={back} />
        {switcher}
        <EmptyState icon={<MicOff />} title="No speech detected" action={retry}>
          We couldn't hear any words in this recording, so it wasn't scored. Check the right microphone is selected and speak a little closer to it.
        </EmptyState>
        {a.audioUrl && <AudioBar src={a.audioUrl} audioRef={audio.ref} />}
      </div>
    );
  }

  const setTab = (t: Tab) => void navigate({ search: (s) => ({ ...s, tab: t === 'overview' ? undefined : t }), replace: true, resetScroll: false });
  const parentLink = r.comparison && (
    <Link to="/speaking/result/$attemptId" params={{ attemptId: r.comparison.parentAttemptId }} className="text-sm font-medium text-accent-text hover:underline">
      See last try
    </Link>
  );

  return (
    <div>
      <div className="mb-3">{back}</div>
      <ResultHeader result={r} title={a.prompt.title} meta={meta} target={target}>
        {switcher}
      </ResultHeader>
      <Tabs id="res" value={tab} onChange={setTab} items={[
        { value: 'overview', label: 'Overview' },
        { value: 'transcript', label: 'Transcript', count: r.errors.length },
        { value: 'fluency', label: 'Fluency' },
        { value: 'language', label: 'Language' },
        { value: 'improve', label: 'Improve' },
      ]} className="mb-6" />
      {a.audioUrl && tab !== 'overview' && tab !== 'improve' && (
        <div className="mb-6">
          <AudioBar src={a.audioUrl} audioRef={audio.ref} />
        </div>
      )}
      <div role="tabpanel" id="res-panel" aria-labelledby={`res-${tab}`} tabIndex={-1}>
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
      return r.metrics ? <FluencyPanel metrics={r.metrics} audio={audio} /> : null;
    case 'language':
      return <LanguagePanel result={r} audio={audio} />;
    case 'improve':
      return <ImprovePanel result={r} retry={retry} />;
  }
}
