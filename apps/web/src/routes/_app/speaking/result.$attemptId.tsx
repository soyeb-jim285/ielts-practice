import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, MicOff, RotateCcw } from 'lucide-react';
import type { RepeatedWord } from '@ielts/core';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { KeepResult, RefundNote } from '@/components/community/KeepResult';
import { RemoveAttempt } from '@/components/history/RemoveAttempt';
import { AnalyzingState, FailedState } from '@/components/results';
import { ActionRow, CriteriaStrip, FixList, DetailField, InfoNote, ResultScaffold, ScoreHero, Section, StatusLine, type CriterionItem } from '@/components/result';
import { AudioBar, useAudio } from '@/components/speaking/AudioBar';
import { CueCard } from '@/components/speaking/CueCard';
import { ImprovePanel, useAddFixes, type AddFixes } from '@/components/speaking/ImprovePanel';
import { NotSubmittedActions } from '@/components/speaking/PendingUploads';
import { LanguagePanel } from '@/components/speaking/LanguagePanel';
import { SessionSwitcher } from '@/components/speaking/SessionSwitcher';
import { Transcript } from '@/components/speaking/Transcript';
import { Alert, Badge, buttonStyles, Card, EmptyState, PageContainer, PageHeader, Segmented, Skeleton, StickyTabs, Tabs, type ButtonVariant } from '@/components/ui';
import { formatBand, formatDate, formatDuration } from '@/lib/format';
import { useMe } from '@/lib/query';
import { attemptQuery } from '@/lib/attempt';
import { timelineMarkers, type Timeline } from '@/lib/timeline';
import { criterionLabel, notAssessed, offTopicAnswers, pronunciationUnsupported, sentenceCase, SPEAKING_CRITERIA, splitFirstSentence, type Attempt } from '@/lib/result';
import type { AnalysisResult } from '@server/ai/types';
import { roundBand } from '@ielts/core';

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
  const conversation = useAudio();
  // Live duplex parts also keep the whole conversation (with the examiner); the word-synced player stays on the candidate-only recording.
  const [listen, setListen] = useState<'answers' | 'conversation'>('answers');
  const [lean, setLean] = useState<RepeatedWord | null>(null);
  const timeline = useMemo(() => (a?.analysis?.words ? timelineMarkers(a.analysis) : undefined), [a?.analysis]);
  const deck = useAddFixes(a?.analysis?.topFixes ?? [], !!a?.topFixesInDeck);
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
  const metaItems = ['Speaking', a.part !== 1 && `Part ${a.part}`, nq > 1 && `${nq} questions`, formatDate(a.createdAt), a.durationMs ? formatDuration(a.durationMs) : false];
  const meta = metaItems.filter(Boolean).join(', ');

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
  const criteria = SPEAKING_CRITERIA.filter((k) => r.criteria[k]);
  const lowest = Math.min(...criteria.map((k) => r.criteria[k]!.band));
  const strip = (
    <>
      {switcher}
      {tab !== 'overview' && <CriteriaStrip layout="strip" cols={4} items={criteria.map((k) => ({ key: k, label: criterionLabel(k), band: r.criteria[k]!.band, target, weakest: r.criteria[k]!.band === lowest && lowest < Math.max(...criteria.map((c) => r.criteria[c]!.band)) }))} />}
      <RetryLine result={r} />
    </>
  );
  return (
    <ResultScaffold
      back={{ to: '/speaking', label: 'Speaking' }}
      title={title}
      promptFull={<PromptFull a={a} />}
      meta={<StatusLine items={metaItems} />}
      actions={rm}
      hero={
        <>
          <KeepResult />
          <ScoreHero
            value={r.overall}
            target={target}
            range={r.range}
            estimate={r.overall > 0 && r.calibrated === false}
            rawAverage={r.overallRaw}
            note={<p>Overall is the average of the four criteria, rounded to the nearest half band.</p>}
            exceptions={
              off && (
                <Link to="." search={(s) => ({ ...s, tab: 'language' })} hash="relevance" replace className="rounded-full">
                  <Badge tone="bad">Off topic</Badge>
                </Link>
              )
            }
          />
        </>
      }
      strip={strip}
      action={<ActionRow primary={retry} links={parentLink ? [parentLink] : undefined} />}
      tabs={
        // One sticky strip: the tabs, plus the player on the tabs that seek into the recording.
        <StickyTabs>
          <Tabs id="res" value={tab} onChange={setTab} items={[
            { value: 'overview', label: 'Overview' },
            { value: 'transcript', label: 'Transcript', count: r.errors.length },
            { value: 'fluency', label: 'Fluency' },
            { value: 'language', label: 'Language' },
            { value: 'improve', label: 'Improve' },
          ]} />
          {a.audioUrl && tab !== 'overview' && tab !== 'improve' && (
            <div className="mt-3 space-y-2 pb-3">
              {a.conversationUrl && (
                <Segmented label="Recording" size="sm" value={listen} onChange={setListen} options={[{ value: 'answers', label: 'Your answers' }, { value: 'conversation', label: 'With the examiner' }]} />
              )}
              {listen === 'conversation' && a.conversationUrl ? (
                <AudioBar key="conversation" src={a.conversationUrl} audioRef={conversation.ref} />
              ) : (
                <AudioBar src={a.audioUrl} audioRef={audio.ref} durationS={a.durationMs ? a.durationMs / 1000 : undefined} timeline={timeline} onPick={audio.controls.pick} />
              )}
            </div>
          )}
        </StickyTabs>
      }
    >
      <div role="tabpanel" id="res-panel" aria-labelledby={`res-${tab}`} tabIndex={-1}>
        <Panel tab={tab} a={a} timeline={timeline} target={target} audio={audio.controls} off={off} lean={lean} onLean={onLean} deck={deck} />
      </div>
    </ResultScaffold>
  );
}

/** The whole prompt, behind "Show prompt" (the h1 is clamped to two lines). */
function PromptFull({ a }: { a: Attempt }) {
  if (a.part === 2) return <p className="whitespace-pre-wrap">{a.prompt.body}</p>;
  const qs = a.prompt.followUps?.length ? a.prompt.followUps : [a.prompt.body];
  return qs.length > 1 ? <ol className="list-decimal space-y-1 pl-6 marker:font-sans marker:text-muted">{qs.map((q) => <li key={q}>{q}</li>)}</ol> : <p>{qs[0]}</p>;
}

const Delta = ({ d }: { d: number }) =>
  d > 0 ? (
    <span className="inline-flex items-center gap-0.5 font-medium text-good-text">
      <ArrowUp role="img" className="size-4" aria-label="up" />+{d}
    </span>
  ) : d < 0 ? (
    <span className="inline-flex items-center gap-0.5 font-medium text-bad-text">
      <ArrowDown role="img" className="size-4" aria-label="down" />
      {`−${Math.abs(d)}`}
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5">
      <Minus role="img" className="size-4" aria-label="no change" />0
    </span>
  );

/** Retry comparison under the hero: last try to now, then each criterion's change. Nothing renders on a first attempt. */
function RetryLine({ result }: { result: AnalysisResult }) {
  const c = result.comparison;
  if (!c) return null;
  const overall = Math.round((result.overall - c.parentOverall) * 10) / 10;
  return (
    <div className="space-y-1">
      <p className="type-body type-num flex flex-wrap items-center gap-x-2">
        <span>Since your last try</span>
        <span className="inline-flex items-center gap-1.5">
          {formatBand(c.parentOverall)}
          <ArrowRight role="img" className="size-4 text-muted" aria-label="to" />
          {formatBand(result.overall)}
        </span>
        <Delta d={overall} />
      </p>
      <ul className="type-caption type-num flex flex-wrap gap-x-5 gap-y-1">
        {Object.entries(c.deltas).map(([k, d]) => (
          <li key={k} className="flex items-center gap-1.5">
            {criterionLabel(k)}
            <Delta d={d!} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Overview: the four criteria (weakest opens first), then what to fix next. */
function Overview({ result: r, target, off, deck }: { result: AnalysisResult; target: number; off: ReturnType<typeof offTopicAnswers>; deck: AddFixes }) {
  const bands = SPEAKING_CRITERIA.filter((k) => r.criteria[k]).map((k) => ({ k, band: r.criteria[k]!.band }));
  const low = bands.reduce((m, x) => (x.band < m.band ? x : m), bands[0] ?? { k: SPEAKING_CRITERIA[0]!, band: 0 });
  const spread = bands.length ? Math.max(...bands.map((x) => x.band)) - low.band : 0;
  const avg = bands.length ? roundBand(bands.reduce((t, x) => t + x.band, 0) / bands.length) : 0;
  const items: CriterionItem[] = bands.map(({ k, band }) => {
    const c = r.criteria[k]!;
    const d = r.comparison?.deltas[k];
    const soft = pronunciationUnsupported(r.criteria, k);
    const [lo, hi] = soft ? [Math.max(0, Math.min(c.range[0], band - 1.5)), Math.min(9, Math.max(c.range[1], band + 1.5))] : c.range;
    const [first, rest] = splitFirstSentence(c.summary);
    return {
      key: k,
      label: criterionLabel(k),
      band,
      target,
      weakest: spread > 0 && k === low.k,
      gist: (
        <>
          {d ? <span className="type-caption type-num mb-1 block"><Delta d={d} /> <span>vs last try</span></span> : null}
          {soft && (
            <span className="type-caption mb-1 flex items-center gap-1 text-warn-text">
              Audio check only, low confidence
              <InfoNote label="About this pronunciation band">The pronunciation band comes from the audio alone. Halting or very short speech is hard to judge, so treat it as a rough guide.</InfoNote>
            </span>
          )}
          {first}
        </>
      ),
      detail: (
        <>
          {rest && <p className="type-body max-w-[68ch]">{rest}</p>}
          <DetailField label="Likely band"><p className="type-body type-num">{lo === hi ? formatBand(lo) : `${formatBand(lo)}–${formatBand(hi)}`}</p></DetailField>
          {c.evidence.length > 0 && (
            <DetailField label="Evidence from your answer">
              <ul className="space-y-2">
                {c.evidence.map((q) => (
                  <li key={q} className="type-reading-sm border-l-2 border-line pl-3">
                    {'“'}{q}{'”'}
                  </li>
                ))}
              </ul>
            </DetailField>
          )}
          {c.descriptor && (
            <DetailField label="Band descriptor"><p className="type-body">{c.descriptor}</p></DetailField>
          )}
        </>
      ),
    };
  });
  return (
    <div className="space-y-8 md:space-y-12">
      {off && (
        <Alert tone="bad" title="Off topic">
          {off.total > 1 ? `${off.off} of ${off.total} answers didn’t` : 'Your answer didn’t'} address the question.
          {r.offTopicPenalty ? ` Off-topic speech can’t count as evidence, so your band is about ${formatBand(Math.max(0.5, Math.round(r.offTopicPenalty * 2) / 2))} lower.` : ''}{' '}
          <Link to="." search={(s) => ({ ...s, tab: 'language' })} hash="relevance" replace className={buttonStyles({ variant: 'link' })}>
            See details in Language
          </Link>
        </Alert>
      )}
      <Section title="Summary" caption={spread >= 2 ? `${criterionLabel(low.k)} (${formatBand(low.band)}) pulls the overall ${formatBand(avg)} down. Fix it first.` : 'Your four criteria, each against your target. The tick on a bar is the target.'}>
        <CriteriaStrip layout="rows" items={items} />
      </Section>
      {r.topFixes.length > 0 && (
        <Section title={r.topFixes.length === 1 ? 'One thing to fix next' : `${r.topFixes.length} things to fix next`}>
          <FixList items={r.topFixes.map((f) => ({ title: f.title, why: f.why, before: f.before, after: f.after }))} onAddAll={deck.add} added={deck.added} />
        </Section>
      )}
    </div>
  );
}

function Panel({ tab, a, timeline, target, audio, off, lean, onLean, deck }: { lean: RepeatedWord | null; onLean: (w: RepeatedWord | null) => void; tab: Tab; a: Attempt; timeline?: Timeline; target: number; audio: ReturnType<typeof useAudio>['controls']; off: ReturnType<typeof offTopicAnswers>; deck: AddFixes }) {
  const r = a.analysis!;
  switch (tab) {
    case 'overview':
      return <Overview result={r} target={target} off={off} deck={deck} />;
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
      return <ImprovePanel result={r} deck={deck} />;
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
