import { P2_PREP_S, SPEAKING_ZONES } from '@ielts/core';
import type { Prompt } from '@server/routes/prompts';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronRight, CircleAlert, Info, LoaderCircle, Mic, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BlockedAlert } from '@/components/community/BlockedPanel';
import { ExamShell } from '@/components/layout/ExamShell';
import { Alert, Badge, Button, Card, Dialog, PageContainer, ProgressBar, ProgressRing, Stat, Textarea } from '@/components/ui';
import { useCountdown } from '@/hooks/useCountdown';
import { savePending, uploadPending, type Pending } from '@/hooks/pendingRecordings';
import { useRecorder } from '@/hooks/useRecorder';
import { rememberSession } from '@/lib/attempt';
import { blockerOf, type Blocker } from '@/lib/community';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CueCard } from './CueCard';
import { SilenceNudge, WpmPill } from './LiveHints';
import { MicButton } from './MicButton';
import { MicCheck } from './MicCheck';
import { MicProblem } from './MicProblem';
import { TimerRing } from './TimerRing';
import { Waveform } from './Waveform';

export type Segment = { part: 1 | 2 | 3; prompt: Prompt; questions: string[] };

/** P1/P3 answer the follow-ups (or the body); P2 is a single cue card. */
export const toSegment = (prompt: Prompt): Segment => {
  const part = prompt.part as 1 | 2 | 3;
  return { part, prompt, questions: part === 2 ? [prompt.title] : prompt.followUps?.length ? prompt.followUps : [prompt.body] };
};

const INTRO = {
  1: 'Short answers about you. One recording covers every question. Press Next question as you go.',
  2: 'Talk for 1 to 2 minutes about the card. You get 1 minute to prepare and can make notes. Recording stops at 2:00.',
  3: 'A discussion linked to Part 2. Develop each answer with reasons and examples. Press Next question as you go.',
};
const P2_MAX_MS = SPEAKING_ZONES[2].max * 1000;

type Upload = { key: number; label: string; status: 'uploading' | 'done' | 'failed'; id?: string; error?: string; /** The quota, balance or traffic limit that refused it: the recording is kept and sent once it clears. */ blocker?: Blocker; /** A copy is in IndexedDB, so leaving or reloading does not lose it. */ kept: boolean };

const HINT_KEY = 'ielts.micHintSeen';
const hintSeen = () => {
  try {
    return !!localStorage.getItem(HINT_KEY);
  } catch {
    return false;
  }
};

/**
 * The recording flow for one or more segments (a full test = P1 topics, P2 card, P3 discussion).
 * Each segment is one recording → one attempt (sharing `sessionId`), uploaded in the background while you continue.
 */
export function SessionFlow({ segments, sessionId, parentAttemptId }: { segments: Segment[]; sessionId?: string; parentAttemptId?: string }) {
  const navigate = useNavigate();
  const rec = useRecorder();
  const [segIdx, setSegIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [phase, setPhase] = useState<'ready' | 'prep' | 'finishing'>('ready');
  const [notes, setNotes] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [hint, setHint] = useState(() => !hintSeen());
  const [exitOpen, setExitOpen] = useState(false);
  const marks = useRef<number[]>([]);
  const stopping = useRef(false);

  const seg = segments[segIdx]!;
  const recording = rec.state === 'recording';
  const lastQ = qIdx >= seg.questions.length - 1;
  const p1Count = segments.filter((s) => s.part === 1).length;
  const p1Pos = segments.slice(0, segIdx + 1).filter((s) => s.part === 1).length;

  const prep = useCountdown(P2_PREP_S, { onEnd: () => void startRecording() });

  // ---- upload: create attempt → PUT audio → submit (hard timeouts). A retry resumes from the step that failed. ----
  const pending = useRef<Record<number, Pending>>({});
  const kept = useRef<Record<number, boolean>>({});
  const upload = async (key: number) => {
    const patch = (u: Partial<Upload>) => setUploads((all) => all.map((x) => (x.key === key ? { ...x, ...u } : x)));
    patch({ status: 'uploading', error: undefined, blocker: undefined });
    try {
      const id = await uploadPending(pending.current[key]!, kept.current[key]);
      patch({ status: 'done', id });
    } catch (e) {
      const blocker = blockerOf(e) ?? undefined;
      patch({ status: 'failed', error: blocker ? undefined : e instanceof Error ? e.message : 'Upload failed', blocker });
    }
  };

  const label = (s: Segment, i: number) => (s.part === 1 && p1Count > 1 ? `Part 1, ${segments.slice(0, i + 1).filter((x) => x.part === 1).length} of ${p1Count}` : `Part ${s.part}`);

  const finishPart = async () => {
    if (stopping.current || rec.state !== 'recording') return;
    stopping.current = true;
    try {
      const r = await rec.stop();
      const p: Pending = { key: crypto.randomUUID(), promptId: seg.prompt.id, part: seg.part, sessionId, parentAttemptId, label: `${label(seg, segIdx)}: ${seg.prompt.topic || seg.prompt.title}`, createdAt: Date.now(), mime: r.mime, blob: r.blob, durationMs: r.durationMs, energy: r.energy, marks: marks.current };
      pending.current[segIdx] = p;
      kept.current[segIdx] = await savePending(p); // before anything can fail: the recording survives a failed upload, a reload or a closed tab
      setUploads((u) => [...u, { key: segIdx, label: p.label, status: 'uploading', kept: kept.current[segIdx]! }]);
      void upload(segIdx);
      if (segIdx + 1 < segments.length) {
        setSegIdx(segIdx + 1);
        setQIdx(0);
        setNotes('');
        prep.reset();
        setPhase('ready');
      } else setPhase('finishing');
    } finally {
      stopping.current = false;
    }
  };

  const startRecording = async () => {
    prep.stop();
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {}
    setHint(false);
    marks.current = [0];
    await rec.start();
  };

  const nextQuestion = () => {
    marks.current.push(Math.round(rec.elapsedMs));
    setQIdx(qIdx + 1);
  };

  // P2 hard stop at 2:00.
  const hardStop = recording && seg.part === 2 && rec.elapsedMs >= P2_MAX_MS;
  useEffect(() => {
    if (hardStop) void finishPart();
    // fire once when the limit is crossed
  }, [hardStop]);

  // All uploaded → results (first attempt; the session switcher finds the rest).
  const allDone = phase === 'finishing' && uploads.length === segments.length && uploads.every((u) => u.status === 'done');
  useEffect(() => {
    if (!allDone) return;
    const first = uploads.find((u) => u.key === 0)!.id!;
    if (sessionId) rememberSession(sessionId, [...uploads].sort((a, b) => a.key - b.key).map((u) => u.id!));
    void navigate({ to: '/speaking/result/$attemptId', params: { attemptId: first }, search: sessionId ? { session: sessionId } : {}, replace: true });
  }, [allDone, uploads, navigate, sessionId]);

  // Warn before leaving while a recording exists only in this tab (being recorded, or finished but not stored).
  const notDone = uploads.some((u) => u.status !== 'done');
  const unsaved = uploads.some((u) => u.status !== 'done' && !u.kept); // only a recording with no IndexedDB copy is lost on leaving
  const busy = recording || unsaved;
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [busy]);

  const exit = () => {
    if (recording) void rec.stop().catch(() => {});
    void navigate({ to: '/speaking' });
  };

  const answerS = (rec.elapsedMs - (marks.current.at(-1) ?? 0)) / 1000;
  const title = phase === 'finishing' ? 'Saving your answers' : label(seg, segIdx);
  const multiQ = seg.questions.length > 1;

  return (
    <ExamShell
      title={title}
      status={
        phase !== 'finishing' &&
        segments.length > 1 && (
          <span className="type-caption type-num">
            {segIdx + 1}/{segments.length}
          </span>
        )
      }
      exit={
        <Button variant="ghost" size="sm" icon={<X />} aria-label="Exit" onClick={() => (recording || phase === 'prep' || segIdx > 0 || notDone ? setExitOpen(true) : exit())}>
          <span className="hidden sm:inline">Exit</span>
        </Button>
      }
    >
      {phase === 'finishing' ? (
        <Finishing uploads={uploads} total={segments.length} onRetry={(k) => void upload(k)} />
      ) : (
        <PageContainer width="narrow" className="flex flex-col gap-8 sm:min-h-[68dvh] sm:justify-center">
          {seg.part === 2 ? (
            <>
              <h1 className="sr-only">Part 2: Long turn</h1>
              <CueCard prompt={seg.prompt} />
            </>
          ) : (
            <div className="space-y-4">
              <PartMeta seg={seg} p1Pos={p1Pos} p1Count={p1Count} multi={segments.length > 1} n={multiQ ? qIdx + 1 : undefined} total={seg.questions.length} />
              <h1 key={qIdx} className="type-title motion-safe:animate-[fade-in_250ms_var(--ease-out-quart)]">
                {seg.questions[qIdx]}
              </h1>
            </div>
          )}

          <MicProblem state={rec.state} error={rec.error} onRetry={() => void startRecording()} />

          {recording ? (
            <div className="flex w-full flex-col gap-7">
              <div className="grid items-center gap-x-14 gap-y-6 sm:grid-cols-[auto_minmax(0,1fr)]">
                <div className="flex flex-col items-start gap-4">
                  <RecordingDot />
                  <TimerRing part={seg.part} seconds={seg.part === 2 ? rec.elapsedMs / 1000 : answerS} />
                </div>
                <div className="min-w-0 space-y-4">
                  <Waveform level={rec.level} tick={rec.elapsedMs} active />
                  <div className="flex flex-wrap items-center gap-2">
                    <WpmPill wpm={rec.liveWpm} elapsedMs={rec.elapsedMs} />
                    {seg.part === 2 && <Badge tone="neutral" className="text-ink">Stops at {formatClock(SPEAKING_ZONES[2].max)}</Badge>}
                  </div>
                  <SilenceNudge silenceMs={rec.silenceMs} />
                </div>
              </div>
              {seg.part === 2 && notes && (
                <div className="rounded-lg bg-surface-2 p-4 text-left">
                  <p className="type-caption">Your notes</p>
                  <p className="mt-1 type-reading-sm whitespace-pre-wrap">{notes}</p>
                </div>
              )}
              {/* Sticky on phones: a tall cue card must never push Finish off screen while you are speaking. */}
              <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-3 self-stretch border-t border-line bg-bg px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 sm:flex-row sm:justify-start md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
                {seg.part !== 2 && !lastQ ? (
                  <>
                    <Button variant="outline" size="lg" onClick={() => setEarlyOpen(true)}>
                      Finish part early
                    </Button>
                    <Button size="lg" onClick={nextQuestion} icon={<ChevronRight />}>
                      Next question
                    </Button>
                  </>
                ) : (
                  <Button size="lg" className="w-full sm:w-auto" onClick={() => void finishPart()} icon={<Check />}>
                    {segIdx + 1 < segments.length ? 'Finish and continue' : 'Finish'}
                  </Button>
                )}
              </div>
            </div>
          ) : seg.part === 2 && phase === 'prep' ? (
            <>
              <div className="grid items-start gap-x-8 gap-y-5 sm:grid-cols-[auto_minmax(0,1fr)]">
                <ProgressRing value={prep.left / P2_PREP_S} size={96} stroke={6} tone={prep.left <= 10 ? 'warn' : 'accent'} label="Preparation time left">
                  <span className="type-num text-xl font-semibold">{formatClock(prep.left)}</span>
                </ProgressRing>
                <Textarea
                  label="Notes"
                  hint="Only you see these. Recording starts automatically when the minute is up."
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="type-reading-sm text-left"
                  autoFocus={globalThis.matchMedia?.('(pointer: fine)').matches} // a phone keyboard would cover the cue card during prep
                  spellCheck={false}
                />
              </div>
              {/* Sticky on phones so the cue card and notes never push the CTA below the fold. */}
              <div className="sticky bottom-0 z-10 -mx-4 self-stretch border-t border-line bg-bg px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
                <Button size="lg" className="w-full md:w-auto" onClick={() => void startRecording()} loading={rec.state === 'requesting'}>
                  Start speaking now
                </Button>
              </div>
            </>
          ) : seg.part === 2 ? (
            <div className="space-y-6">
              <dl className="flex gap-10">
                <Stat label="Preparation" value={formatClock(P2_PREP_S)} />
                <Stat label="Speaking" value={`up to ${formatClock(SPEAKING_ZONES[2].max)}`} />
              </dl>
              <p className="max-w-[60ch] type-lede">{INTRO[2]}</p>
              <Button
                size="lg"
                className="w-full sm:w-auto"
                onClick={() => {
                  setPhase('prep');
                  prep.start();
                }}
              >
                Start 1-minute preparation
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-5 sm:gap-7">
                <MicButton state={rec.state} level={rec.level} onStart={() => void startRecording()} onStop={() => void finishPart()} />
                <div className="min-w-0">
                  <p className="type-subheading">Press to start recording</p>
                  <p className="type-caption mt-1 max-w-[46ch]">{INTRO[seg.part]}</p>
                </div>
              </div>
              {hint && (
                <p className="type-caption flex items-center gap-2 text-brand-text">
                  <Info className="size-4 shrink-0" aria-hidden />
                  Tap to start, your whole Part {seg.part} is one recording.
                </p>
              )}
            </div>
          )}

          {segIdx === 0 && !recording && phase === 'ready' && <MicCheckStep />}

          {uploads.some((u) => u.status === 'failed') && (
            <Alert tone="warn" title="An earlier answer didn't upload">
              Keep going. You can retry it at the end.
            </Alert>
          )}
        </PageContainer>
      )}

      <Dialog
        open={earlyOpen}
        onClose={() => setEarlyOpen(false)}
        title={`Finish with ${qIdx + 1} of ${seg.questions.length} answered?`}
        description={`Your whole Part ${seg.part} is one recording, so finishing now ends it and skips the last ${seg.questions.length - qIdx - 1} ${seg.questions.length - qIdx - 1 === 1 ? 'question' : 'questions'}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEarlyOpen(false)}>
              Keep going
            </Button>
            <Button
              onClick={() => {
                setEarlyOpen(false);
                void finishPart();
              }}
            >
              Finish now
            </Button>
          </>
        }
      />
      <Dialog
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Leave this test?"
        description={[
          recording && 'The answer you are recording now will be discarded.',
          unsaved && "Recordings that haven't finished uploading will be lost.",
          !unsaved && notDone && 'Recordings that have not uploaded stay on this device. Upload them from the Speaking page.',
          'Answers already uploaded are still analysed.',
        ]
          .filter(Boolean)
          .join(' ')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExitOpen(false)}>
              Keep going
            </Button>
            <Button variant="danger" onClick={exit}>
              Leave
            </Button>
          </>
        }
      />
    </ExamShell>
  );
}

/** Unmistakable "mic is live" cue: red dot (pulsing unless reduced motion) + label. The only perpetual motion on the screen. */
function RecordingDot() {
  return (
    <p className="inline-flex items-center gap-2 text-sm font-medium text-bad-text">
      <span className="relative flex size-2.5" aria-hidden>
        <span className="absolute inset-0 animate-ping rounded-full bg-bad opacity-60 motion-reduce:hidden" />
        <span className="relative size-2.5 rounded-full bg-bad" />
      </span>
      Recording
    </p>
  );
}

/** Optional mic check before the first recording, on its own recorder (released when it unmounts). */
function MicCheckStep() {
  const mic = useRecorder();
  if (mic.state === 'idle' || mic.state === 'stopped')
    return (
      <div>
        <Button variant="secondary" icon={<Mic />} onClick={() => void mic.start()}>
          Check your microphone first
        </Button>
      </div>
    );
  return (
    <Card className="w-full max-w-md space-y-3 p-4 text-left">
      <MicCheck mic={mic} />
      {mic.state === 'recording' && (
        <Button variant="secondary" size="sm" onClick={() => void mic.stop().catch(() => {})}>
          Looks good
        </Button>
      )}
    </Card>
  );
}

/** Topic (+ part on phones, where the top bar title is hidden in a multi-part test) and a segmented track showing which question you are on. */
function PartMeta({ seg, p1Pos, p1Count, multi, n, total }: { seg: Segment; p1Pos: number; p1Count: number; multi: boolean; n?: number; total: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <p className="type-caption type-num flex flex-wrap items-center gap-x-2">
        {multi && (
          <span className="font-medium text-brand-text sm:hidden">
            Part {seg.part}
            {seg.part === 1 && p1Count > 1 && `, ${p1Pos}/${p1Count}`}
          </span>
        )}
        <span className="font-medium text-ink">{seg.prompt.topic || seg.prompt.title}</span>
      </p>
      {n != null && (
        <p className="type-caption type-num flex items-center gap-2.5">
          Question {n} of {total}
          <span className="flex gap-1" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={cn('h-1 w-5 rounded-sm transition-colors duration-200', i < n - 1 ? 'bg-ink/60' : i === n - 1 ? 'bg-brand' : 'bg-line-strong/40')} />
            ))}
          </span>
        </p>
      )}
    </div>
  );
}

function Finishing({ uploads, total, onRetry }: { uploads: Upload[]; total: number; onRetry: (key: number) => void }) {
  const failed = uploads.filter((u) => u.status === 'failed');
  const done = uploads.filter((u) => u.status === 'done').length;
  const kept = failed.every((u) => u.kept);
  return (
    <PageContainer width="narrow" className="grid min-h-[68dvh] content-center gap-7">
      <div className="space-y-1.5">
        <h1 className="type-title">{failed.length ? 'Some answers need another try' : 'Uploading your answers'}</h1>
        <p className="type-lede">{failed.length ? 'Your recordings are still here. Retry to send them.' : `Analysis starts as soon as each of the ${total} recordings arrives.`}</p>
      </div>
      <div className="space-y-2">
        <p className="type-caption type-num" aria-hidden>
          {failed.length ? `${done} of ${total} uploaded, ${failed.length} failed` : done === total ? `${total} of ${total} uploaded` : `Uploading ${Math.min(done + 1, total)} of ${total}`}
        </p>
        {/* ring-line-strong: the default track is too faint against the page (needs 3:1). */}
        <ProgressBar value={done / total} tone={failed.length ? 'warn' : 'accent'} label={`${done} of ${total} recordings uploaded`} className="h-2 ring-line-strong" />
      </div>
      <Card padded={false} className="overflow-hidden">
        <ul className="divide-y divide-line" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} className="flex min-h-14 items-center gap-3 px-5 py-3 text-left text-sm">
              {u.status === 'done' ? (
                <Check role="img" className="size-5 shrink-0 text-good-text" aria-label="uploaded" />
              ) : u.status === 'failed' ? (
                <CircleAlert role="img" className="size-5 shrink-0 text-bad-text" aria-label="failed" />
              ) : (
                <LoaderCircle role="img" className="size-5 shrink-0 animate-spin text-muted" aria-label="uploading" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate">{u.label}</p>
                {u.status === 'uploading' && <p className="text-xs text-muted">Uploading…</p>}
                {u.error && <p className="text-xs text-bad-text">{u.error}</p>}
              </div>
              {u.status === 'failed' && (
                <Button size="sm" variant="outline" icon={<RotateCcw />} onClick={() => onRetry(u.key)}>
                  Retry
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {failed.some((u) => u.blocker) && <BlockedAlert blocker={failed.find((u) => u.blocker)!.blocker!} keeps={kept ? 'Your recording is saved on this device. Upload it from the Speaking page once you can.' : 'Keep this tab open: this recording is not saved anywhere else.'} />}
      {failed.some((u) => !u.blocker) && (
        <Alert
          tone="bad"
          title="Upload failed"
          action={
            <Button size="sm" icon={<RotateCcw />} onClick={() => failed.forEach((u) => onRetry(u.key))}>
              Retry upload
            </Button>
          }
        >
          {kept ? 'Your recording is saved on this device. If it keeps failing, leave and upload it later from the Speaking page, even after a reload.' : 'Keep this tab open until it uploads: this recording is not saved anywhere else.'}
        </Alert>
      )}
    </PageContainer>
  );
}
