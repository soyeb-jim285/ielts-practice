import type { Prompt } from '@server/routes/prompts';
import { clsx } from 'clsx';
import { Captions, CaptionsOff, Check, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ExamShell } from '@/components/layout/ExamShell';
import { TimerRing } from '@/components/speaking/TimerRing';
import { Alert, Button, Dialog, ProgressRing, Spinner, Textarea } from '@/components/ui';
import { formatClock } from '@/lib/format';
import { PREP_S, TALK_S, type LiveExaminer, type Phase } from '@/live/turn';

export const PHASE_LABEL: Record<Phase, string> = {
  intro: 'Introduction',
  p1: 'Part 1 · Introduction and interview',
  'p2-prep': 'Part 2 · Preparation',
  'p2-talk': 'Part 2 · Long turn',
  'p2-follow': 'Part 2 · Long turn',
  p3: 'Part 3 · Discussion',
  closing: 'End of the test',
  done: 'End of the test',
};

const STATUS_TEXT: Record<LiveExaminer['status'], string> = {
  idle: '',
  starting: 'Connecting to your examiner…',
  examiner: 'The examiner is speaking',
  candidate: 'Your turn — answer when you are ready',
  thinking: 'The examiner is thinking…',
  waiting: 'Use this minute to prepare',
  finishing: 'Uploading your recordings…',
  error: '',
};

/** Elapsed test time in seconds, counted only while `running` (paused on an error). */
export function useElapsed(running: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now() - s * 1000; // resume from where the pause left off
    const t = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]); // `s` is read once, on resume
  return s;
}

/** Examiner presence: breathes while the examiner speaks, follows the candidate's voice while they answer. */
function Avatar({ speaking, listening, level, compact }: { speaking: boolean; listening: boolean; level: number; compact: boolean }) {
  return (
    <div className={clsx('relative grid shrink-0 place-items-center transition-[width,height] duration-250 ease-(--ease-out-quart)', compact ? 'size-24' : 'size-40 sm:size-48')} aria-hidden>
      {speaking && <span className="absolute inset-0 animate-ping rounded-full bg-accent/15 [animation-duration:1.8s]" />}
      <span
        className={clsx('absolute inset-0 rounded-full transition-transform duration-100', listening ? 'bg-good-soft' : 'bg-accent-soft')}
        style={{ transform: `scale(${listening ? 1 + Math.min(level * 1.2, 0.35) : 1})` }}
      />
      <span
        className={clsx(
          'relative grid place-items-center rounded-full bg-surface font-serif font-semibold text-accent-text shadow-card transition-[width,height] duration-250',
          compact ? 'size-16 text-2xl' : 'size-28 text-5xl sm:size-32',
        )}
      >
        A
      </span>
    </div>
  );
}

function CueCard({ prompt }: { prompt: Prompt }) {
  return (
    <section aria-label="Cue card" className="rounded-card border border-line bg-surface p-5 text-left shadow-card sm:p-6">
      <p className="font-serif text-xl leading-snug text-balance">{prompt.title}</p>
      {prompt.body && prompt.body !== prompt.title && <p className="mt-2 text-[0.9375rem] text-muted">{prompt.body}</p>}
      {prompt.bullets?.length ? (
        <>
          <p className="mt-4 text-sm font-medium">You should say:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[0.9375rem]">
            {prompt.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** The running live test: examiner, phase, timers, captions, cue card and notes, end-test control. */
export function LiveStage({ ex }: { ex: LiveExaminer }) {
  const elapsed = useElapsed(!ex.error);
  const [captions, setCaptions] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notes, setNotes] = useState('');
  const part2 = ex.phase === 'p2-prep' || ex.phase === 'p2-talk';
  const busy = ex.status === 'finishing';

  return (
    <ExamShell
      title="Live examiner"
      exit={
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} disabled={busy}>
          End test
        </Button>
      }
      status={
        <>
          <span className="text-sm font-medium tabular-nums text-muted" aria-label={`Elapsed ${formatClock(elapsed)}`}>
            {formatClock(elapsed)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={captions}
            aria-label={captions ? 'Hide captions' : 'Show captions'}
            title={captions ? 'Hide captions' : 'Show captions'}
            onClick={() => setCaptions((c) => !c)}
          >
            {captions ? <Captions /> : <CaptionsOff />}
          </Button>
        </>
      }
    >
      <div className={clsx('flex flex-col items-center gap-6 text-center', part2 && 'md:gap-8')}>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-balance">{PHASE_LABEL[ex.phase]}</h1>
          <p className="min-h-5 text-sm text-muted" aria-live="polite">
            {STATUS_TEXT[ex.status]}
          </p>
        </div>

        <Avatar speaking={ex.status === 'examiner'} listening={ex.status === 'candidate'} level={ex.level} compact={part2} />

        {ex.needsTap && (
          <Button icon={<Volume2 />} onClick={ex.resume}>
            Play the examiner
          </Button>
        )}

        {captions && ex.caption && (
          <p className="prose-serif w-full rounded-card bg-surface-2 px-5 py-4 text-left" aria-live="polite">
            {ex.caption}
          </p>
        )}

        {ex.error && (
          <Alert
            tone="bad"
            title="The test is paused"
            action={
              ex.retry && (
                <Button size="sm" onClick={ex.retry}>
                  {ex.retryLabel ?? 'Try again'}
                </Button>
              )
            }
          >
            {ex.error}
          </Alert>
        )}

        {busy && <Spinner label="Uploading your recordings" />}

        {part2 && ex.cueCard && (
          <div className="grid w-full gap-4 text-left md:grid-cols-[1fr_16rem]">
            <CueCard prompt={ex.cueCard} />
            <div className="flex flex-col gap-4">
              {ex.phase === 'p2-prep' ? (
                <div className="flex items-center gap-3 md:flex-col md:items-start">
                  <ProgressRing value={(PREP_S - ex.prepLeft) / PREP_S} size={72} stroke={6} tone={ex.prepLeft <= 10 ? 'warn' : 'accent'} label="Preparation time">
                    <span className="text-base font-semibold tabular-nums">{formatClock(ex.prepLeft)}</span>
                  </ProgressRing>
                  <p className="text-sm text-muted">Preparation. The examiner will ask you to start when the minute is up.</p>
                </div>
              ) : (
                ex.talkRunning && <TimerRing part={2} seconds={TALK_S - ex.talkLeft} />
              )}
              <Textarea
                label="Notes"
                hint="Only you see these."
                rows={6}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                readOnly={ex.phase !== 'p2-prep'}
                placeholder="Key words, examples…"
              />
            </div>
          </div>
        )}

        {ex.endTurn && (
          <Button size="lg" variant={ex.phase === 'p2-talk' ? 'primary' : 'secondary'} icon={<Check />} onClick={ex.endTurn} className="w-full sm:w-auto">
            I'm done
          </Button>
        )}
      </div>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="End the test now?"
        description="The parts you've already recorded will be scored. You can't resume this test."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep going
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirm(false);
                void ex.end();
              }}
            >
              End test
            </Button>
          </>
        }
      />
    </ExamShell>
  );
}
