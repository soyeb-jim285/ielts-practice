import { Captions, CaptionsOff, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ExamShell } from '@/components/layout/ExamShell';
import { CueCard } from '@/components/speaking/CueCard';
import { TimerRing } from '@/components/speaking/TimerRing';
import { Alert, Button, Card, Dialog, PageContainer, ProgressRing, Spinner, Textarea } from '@/components/ui';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PREP_S, TALK_S, type LiveExaminer, type Phase } from '@/live/turn';
import { Visualizer, type VoiceState } from './Visualizer';

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

/** Whose turn it is, above the bars. */
const WHO: Partial<Record<LiveExaminer['status'], string>> = { starting: 'Examiner', examiner: 'Examiner', thinking: 'Examiner', candidate: 'You' };

/** The visualizer's state for each examiner status. */
const VOICE: Record<LiveExaminer['status'], VoiceState> = {
  idle: 'idle', starting: 'connecting', examiner: 'speaking', candidate: 'listening', thinking: 'thinking', waiting: 'idle', finishing: 'idle', error: 'idle',
};

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

        {/* Part 2: the card is the focus, so the examiner shrinks to one row beside its status. */}
        <Card className={cn('flex items-center overflow-hidden', part2 ? 'flex-row gap-4 px-5 py-3 text-left' : 'flex-col gap-4 py-7 text-center')}>
          {!part2 && WHO[ex.status] && (
            <p className="type-caption flex items-center gap-2 font-medium tracking-wide uppercase">
              <span className={cn('size-2 rounded-full', ex.status === 'candidate' ? 'bg-ink/70' : 'bg-brand', (ex.status === 'examiner' || ex.status === 'candidate') && 'motion-safe:animate-pulse')} aria-hidden />
              {WHO[ex.status]}
            </p>
          )}
          <Visualizer state={VOICE[ex.status]} stream={ex.voice} level={ex.level} getLevel={ex.micLevel} compact={part2} className={part2 ? 'shrink-0' : undefined} />
          <p className={cn('min-h-6 font-medium', part2 ? 'text-sm' : 'text-body')} aria-live="polite">
            {STATUS_TEXT[ex.status] || '\u00a0'}
          </p>
        </Card>

        {captions && ex.caption && (
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
          // Pinned to the bottom of the screen, so it stays in reach however long the card and notes are.
          <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-bg/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur sm:-mx-6 sm:px-6">
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
