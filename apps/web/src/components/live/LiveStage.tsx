import { Captions, CaptionsOff, Check, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ExamShell } from '@/components/layout/ExamShell';
import { CueCard } from '@/components/speaking/CueCard';
import { TimerRing } from '@/components/speaking/TimerRing';
import { Alert, Button, Card, Dialog, PageContainer, ProgressRing, Spinner, Textarea } from '@/components/ui';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PREP_S, TALK_S, type LiveExaminer, type Phase } from '@/live/turn';

export const PHASE_LABEL: Record<Phase, string> = {
  intro: 'Introduction',
  p1: 'Part 1: Introduction and interview',
  'p2-prep': 'Part 2: Preparation',
  'p2-talk': 'Part 2: Long turn',
  'p2-follow': 'Part 2: Long turn',
  p3: 'Part 3: Discussion',
  closing: 'End of the test',
  done: 'End of the test',
};

const STATUS_TEXT: Record<LiveExaminer['status'], string> = {
  idle: '',
  starting: 'Connecting to your examiner',
  examiner: 'The examiner is speaking',
  candidate: 'Your turn. Answer when you are ready',
  thinking: 'The examiner is thinking',
  waiting: 'Use this minute to prepare',
  finishing: 'Uploading your recordings',
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

const BARS = 13;

/** Re-renders every 160 ms while `active`, to move the examiner's bars. Static under reduced motion. */
function useBreath(active: boolean) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setTick((t) => t + 1), 160);
    return () => clearInterval(id);
  }, [active]);
  return tick;
}

/**
 * Examiner presence as a row of voice bars: they move while the examiner speaks, follow your voice while you answer,
 * and rest at a low line otherwise. Only transform changes, so it is cheap.
 */
function Voice({ speaking, listening, level, compact }: { speaking: boolean; listening: boolean; level: number; compact: boolean }) {
  const tick = useBreath(speaking);
  return (
    <div className={cn('flex items-center justify-center gap-1.5 transition-[height] duration-200 ease-(--ease-out-expo)', compact ? 'h-14' : 'h-24')} aria-hidden>
      {Array.from({ length: BARS }, (_, i) => {
        const mid = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2); // 0 at the edges, 1 in the middle
        const rest = 0.1 + 0.08 * mid;
        const scale = listening ? Math.min(1, rest + level * (0.7 + 1.1 * mid)) : speaking ? 0.18 + 0.82 * mid * Math.abs(Math.sin(tick * 0.9 + i * 1.7)) : rest;
        return <span key={i} className={cn('h-full w-1.5 rounded-sm transition-transform duration-150 ease-out', listening ? 'bg-ink/70' : 'bg-brand')} style={{ transform: `scaleY(${scale})` }} />;
      })}
    </div>
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
          <span className="type-caption type-num font-medium" aria-label={`Elapsed ${formatClock(elapsed)}`}>
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
      <PageContainer width="narrow" className="flex flex-col gap-6 md:gap-8">
        <h1 className="type-title">{PHASE_LABEL[ex.phase]}</h1>

        <Card className="flex flex-col items-center gap-4 py-7 text-center">
          <Voice speaking={ex.status === 'examiner'} listening={ex.status === 'candidate'} level={ex.level} compact={part2} />
          <p className="min-h-6 text-body font-medium" aria-live="polite">
            {STATUS_TEXT[ex.status] || '\u00a0'}
          </p>
          {ex.needsTap && (
            <Button icon={<Volume2 />} onClick={ex.resume}>
              Play the examiner
            </Button>
          )}
        </Card>

        {ex.voiceError && (
          // ponytail: the server's detail (model id, Settings hint) is for logs, not the candidate.
          <Alert tone="warn" title="The examiner's voice isn't available right now">
            Questions will appear as text below. The test carries on as normal.
          </Alert>
        )}

        {(captions || ex.voiceError) && ex.caption && (
          <p className="type-reading w-full max-w-none rounded-lg bg-surface-2 px-5 py-4 text-left" aria-live="polite">
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
          <div className="grid w-full gap-6 text-left md:grid-cols-[minmax(0,1fr)_16rem]">
            <CueCard prompt={ex.cueCard} />
            <div className="flex flex-col gap-4">
              {ex.phase === 'p2-prep' ? (
                <div className="flex items-center gap-3 md:flex-col md:items-start">
                  <ProgressRing value={(PREP_S - ex.prepLeft) / PREP_S} size={72} stroke={6} tone={ex.prepLeft <= 10 ? 'warn' : 'accent'} label="Preparation time">
                    <span className="type-num text-base font-semibold">{formatClock(ex.prepLeft)}</span>
                  </ProgressRing>
                  <p className="type-caption">Preparation. The examiner will ask you to start when the minute is up.</p>
                </div>
              ) : (
                ex.talkRunning && <TimerRing part={2} seconds={TALK_S - ex.talkLeft} />
              )}
              <Textarea
                label="Notes"
                hint="Only you see these."
                rows={6}
                className="type-reading-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                readOnly={ex.phase !== 'p2-prep'}
                placeholder="Key words, examples"
              />
            </div>
          </div>
        )}

        {ex.endTurn && (
          <div>
            <Button size="lg" variant={ex.phase === 'p2-talk' ? 'primary' : 'outline'} icon={<Check />} onClick={ex.endTurn} className="w-full sm:w-auto">
              I'm done
            </Button>
          </div>
        )}
      </PageContainer>

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
