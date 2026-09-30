import { P2_PREP_S, SPEAKING_ZONES } from '@ielts/core';
import type { Prompt } from '@server/routes/prompts';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronRight, CircleAlert, LoaderCircle, Mic, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ExamShell } from '@/components/layout/ExamShell';
import { Alert, Badge, Button, Dialog, ProgressRing, Textarea } from '@/components/ui';
import { useCountdown } from '@/hooks/useCountdown';
import { useRecorder, type Recording } from '@/hooks/useRecorder';
import { api, ApiError } from '@/lib/api';
import { formatClock } from '@/lib/format';
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
  1: 'Short answers about you. One recording covers every question — press Next question as you go.',
  2: 'Talk for 1–2 minutes about the card. You get 1 minute to prepare and can make notes. Recording stops at 2:00.',
  3: 'A discussion linked to Part 2. Develop each answer with reasons and examples. Press Next question as you go.',
};
const P2_MAX_MS = SPEAKING_ZONES[2].max * 1000;

type Upload = { key: number; label: string; status: 'uploading' | 'done' | 'failed'; id?: string; error?: string };

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
  const [exitOpen, setExitOpen] = useState(false);
  const marks = useRef<number[]>([]);
  const stopping = useRef(false);

  const seg = segments[segIdx]!;
  const recording = rec.state === 'recording';
  const lastQ = qIdx >= seg.questions.length - 1;
  const p1Count = segments.filter((s) => s.part === 1).length;
  const p1Pos = segments.slice(0, segIdx + 1).filter((s) => s.part === 1).length;

  const prep = useCountdown(P2_PREP_S, { onEnd: () => void startRecording() });

  // ---- upload: create attempt → PUT audio → submit. A retry resumes from the step that failed. ----
  const recordings = useRef<Record<number, { s: Segment; r: Recording; m: number[] }>>({});
  const progress = useRef<Record<number, { id?: string; uploadUrl?: string; uploaded?: boolean }>>({});
  const upload = async (key: number) => {
    const { s, r, m } = recordings.current[key]!;
    const p = (progress.current[key] ??= {});
    const patch = (u: Partial<Upload>) => setUploads((all) => all.map((x) => (x.key === key ? { ...x, ...u } : x)));
    patch({ status: 'uploading', error: undefined });
    try {
      if (!p.id) {
        const created = await api.post<{ id: string; uploadUrl?: string }>('/attempts', {
          promptId: s.prompt.id,
          skill: 'speaking',
          part: s.part,
          mode: 'practice',
          sessionId,
          parentAttemptId,
          audioContentType: r.mime,
        });
        Object.assign(p, { id: created.id, uploadUrl: created.uploadUrl });
      }
      if (!p.uploaded) {
        const put = await fetch(p.uploadUrl!, { method: 'PUT', body: r.blob, headers: { 'content-type': r.mime } }).catch(() => null);
        if (!put?.ok) throw new Error('Upload failed. Check your connection and retry.');
        p.uploaded = true;
      }
      // 409 = an earlier submit already went through (its response was lost).
      await api.post(`/attempts/${p.id}/submit`, { durationMs: r.durationMs, energy: r.energy, marks: m }).catch((e) => {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
      });
      patch({ status: 'done', id: p.id });
    } catch (e) {
      patch({ status: 'failed', error: e instanceof Error ? e.message : 'Upload failed' });
    }
  };

  const label = (s: Segment, i: number) => (s.part === 1 && p1Count > 1 ? `Part 1 · ${segments.slice(0, i + 1).filter((x) => x.part === 1).length} of ${p1Count}` : `Part ${s.part}`);

  const finishPart = async () => {
    if (stopping.current || rec.state !== 'recording') return;
    stopping.current = true;
    try {
      const r = await rec.stop();
      recordings.current[segIdx] = { s: seg, r, m: marks.current };
      setUploads((u) => [...u, { key: segIdx, label: `${label(seg, segIdx)} — ${seg.prompt.topic || seg.prompt.title}`, status: 'uploading' }]);
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
    void navigate({ to: '/speaking/result/$attemptId', params: { attemptId: first }, search: sessionId ? { session: sessionId } : {}, replace: true });
  }, [allDone, uploads, navigate, sessionId]);

  // Warn before leaving while a recording exists only in this tab (recording, uploading or failed upload).
  const unsaved = uploads.some((u) => u.status !== 'done');
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

  return (
    <ExamShell
      title={title}
      status={
        phase !== 'finishing' &&
        segments.length > 1 && (
          <span className="text-sm text-muted tabular-nums">
            {segIdx + 1}/{segments.length}
          </span>
        )
      }
      exit={
        <Button variant="ghost" size="sm" icon={<X />} aria-label="Exit" onClick={() => (recording || phase === 'prep' || segIdx > 0 || unsaved ? setExitOpen(true) : exit())}>
          <span className="hidden sm:inline">Exit</span>
        </Button>
      }
    >
      {phase === 'finishing' ? (
        <Finishing uploads={uploads} total={segments.length} onRetry={(k) => void upload(k)} />
      ) : (
        <div className="flex flex-col items-center gap-8 text-center">
          <PartHeading seg={seg} p1Pos={p1Pos} p1Count={p1Count} multi={segments.length > 1} />

          {seg.part === 2 ? (
            <CueCard prompt={seg.prompt} />
          ) : (
            <div className="w-full space-y-3">
              {recording || qIdx > 0 ? (
                <p className="text-sm text-muted tabular-nums">
                  Question {qIdx + 1} of {seg.questions.length}
                </p>
              ) : null}
              <p key={qIdx} className="font-serif text-xl leading-snug text-balance md:text-2xl motion-safe:animate-[fade-in_250ms_var(--ease-out-quart)]">
                {recording || qIdx > 0 ? seg.questions[qIdx] : seg.questions[0]}
              </p>
            </div>
          )}

          <MicProblem state={rec.state} error={rec.error} onRetry={() => void startRecording()} />

          {recording ? (
            <div className="flex w-full flex-col items-center gap-5">
              <RecordingDot />
              <TimerRing part={seg.part} seconds={seg.part === 2 ? rec.elapsedMs / 1000 : answerS} />
              <Waveform level={rec.level} tick={rec.elapsedMs} active />
              <div className="flex flex-wrap items-center justify-center gap-2">
                <WpmPill wpm={rec.liveWpm} elapsedMs={rec.elapsedMs} />
                {seg.part === 2 && <Badge tone="neutral">Stops at {formatClock(SPEAKING_ZONES[2].max)}</Badge>}
              </div>
              <SilenceNudge silenceMs={rec.silenceMs} />
              {seg.part === 2 && notes && (
                <div className="w-full rounded-card bg-surface-2 p-4 text-left">
                  <p className="text-xs font-medium text-muted">Your notes</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{notes}</p>
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-3">
                {seg.part !== 2 && !lastQ ? (
                  <>
                    <Button variant="ghost" size="lg" onClick={() => void finishPart()}>
                      Finish part early
                    </Button>
                    <Button size="lg" onClick={nextQuestion} icon={<ChevronRight />}>
                      Next question
                    </Button>
                  </>
                ) : (
                  <Button size="lg" onClick={() => void finishPart()} icon={<Check />}>
                    {segIdx + 1 < segments.length ? 'Finish and continue' : 'Finish'}
                  </Button>
                )}
              </div>
            </div>
          ) : seg.part === 2 && phase === 'prep' ? (
            <>
              <div className="flex w-full flex-col items-center gap-5">
                <ProgressRing value={prep.left / P2_PREP_S} size={96} stroke={7} tone={prep.left <= 10 ? 'warn' : 'accent'} label="Preparation time left">
                  <span className="text-xl font-semibold">{formatClock(prep.left)}</span>
                </ProgressRing>
                <Textarea
                  label="Notes"
                  hint="Only you see these. Recording starts automatically when the minute is up."
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-left"
                  autoFocus
                  spellCheck={false}
                />
              </div>
              {/* Sticky on phones so the cue card and notes never push the CTA below the fold. */}
              <div className="sticky bottom-0 z-10 -mx-4 self-stretch bg-bg/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:-mx-6 sm:px-6 md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
                <Button size="lg" className="w-full md:w-auto" onClick={() => void startRecording()} loading={rec.state === 'requesting'}>
                  Start speaking now
                </Button>
              </div>
            </>
          ) : seg.part === 2 ? (
            <div className="flex flex-col items-center gap-3">
              <p className="max-w-md text-[0.9375rem] text-muted">{INTRO[2]}</p>
              <Button
                size="lg"
                onClick={() => {
                  setPhase('prep');
                  prep.start();
                }}
              >
                Start 1-minute preparation
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <MicButton state={rec.state} level={rec.level} onStart={() => void startRecording()} onStop={() => void finishPart()} />
              <p className="max-w-md text-[0.9375rem] text-muted">{INTRO[seg.part]}</p>
            </div>
          )}

          {segIdx === 0 && !recording && phase === 'ready' && <MicCheckStep />}

          {uploads.some((u) => u.status === 'failed') && (
            <Alert tone="warn" title="An earlier answer didn't upload">
              Keep going — you can retry it at the end.
            </Alert>
          )}
        </div>
      )}

      <Dialog
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Leave this test?"
        description={[
          recording && 'The answer you are recording now will be discarded.',
          unsaved && "Recordings that haven't finished uploading will be lost.",
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

/** Unmistakable "mic is live" cue: red dot (pulsing unless reduced motion) + label. */
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
      <Button variant="ghost" size="sm" icon={<Mic />} onClick={() => void mic.start()}>
        Check your microphone first
      </Button>
    );
  return (
    <div className="w-full max-w-md space-y-3 rounded-card border border-line bg-surface p-4 text-left">
      <MicCheck mic={mic} />
      {mic.state === 'recording' && (
        <Button variant="ghost" size="sm" onClick={() => void mic.stop().catch(() => {})}>
          Done
        </Button>
      )}
    </div>
  );
}

/** Eyebrow repeats the ExamShell title, so it only shows on phones in a multi-part test (where that title is hidden). */
function PartHeading({ seg, p1Pos, p1Count, multi }: { seg: Segment; p1Pos: number; p1Count: number; multi: boolean }) {
  if (seg.part === 2 && !multi) return null;
  return (
    <div className="space-y-1">
      {multi && (
        <p className="text-sm font-medium text-accent-text sm:hidden">
          Part {seg.part}
          {seg.part === 1 && p1Count > 1 && ` · topic ${p1Pos} of ${p1Count}`}
        </p>
      )}
      {seg.part !== 2 && <h2 className="text-lg font-semibold">{seg.prompt.topic || seg.prompt.title}</h2>}
    </div>
  );
}

function Finishing({ uploads, total, onRetry }: { uploads: Upload[]; total: number; onRetry: (key: number) => void }) {
  const failed = uploads.some((u) => u.status === 'failed');
  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold">{failed ? 'Some answers need another try' : 'Uploading your answers'}</h2>
        <p className="mt-1 text-sm text-muted">{failed ? 'Your recordings are still here. Retry to send them.' : `Analysis starts as soon as each of the ${total} recordings arrives.`}</p>
      </div>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface" aria-live="polite">
        {uploads.map((u) => (
          <li key={u.key} className="flex items-center gap-3 px-4 py-3 text-left text-sm">
            {u.status === 'done' ? (
              <Check className="size-4 text-good-text" aria-label="uploaded" />
            ) : u.status === 'failed' ? (
              <CircleAlert className="size-4 text-bad-text" aria-label="failed" />
            ) : (
              <LoaderCircle className="size-4 animate-spin text-muted" aria-label="uploading" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate">{u.label}</p>
              {u.error && <p className="text-xs text-bad-text">{u.error}</p>}
            </div>
            {u.status === 'failed' && (
              <Button size="sm" variant="secondary" icon={<RotateCcw />} onClick={() => onRetry(u.key)}>
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
