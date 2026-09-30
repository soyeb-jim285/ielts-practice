import { Link } from '@tanstack/react-router';
import { Headphones, Mic, X } from 'lucide-react';
import { ExamShell } from '@/components/layout/ExamShell';
import { MicCheck } from '@/components/speaking/MicCheck';
import { Alert, Button, buttonStyles, Card, PageHeader } from '@/components/ui';
import { useRecorder } from '@/hooks/useRecorder';

const STEPS = [
  ['Part 1', '4–5 min', 'Questions about you and familiar topics.'],
  ['Part 2', '3–4 min', 'One minute to prepare from a cue card, then speak for up to two minutes.'],
  ['Part 3', '4–5 min', 'A discussion of broader ideas linked to Part 2.'],
] as const;

/** Before the test (in the exam frame, Exit back to Speaking): how it runs, which examiner, and a mic check with a live level meter. */
export function PreScreen({ realtime, fallback, onStart }: { realtime: boolean; fallback: boolean; onStart: () => void }) {
  const mic = useRecorder();
  const live = mic.state === 'recording';

  return (
    <ExamShell
      exit={
        <Link to="/speaking" aria-label="Exit" className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
          <X aria-hidden />
          <span className="hidden sm:inline">Exit</span>
        </Link>
      }
    >
      <div className="space-y-10">
        <PageHeader title="Live examiner" description="A full speaking test with a voice examiner. About 11–14 minutes, like the real thing." />

        <section aria-labelledby="how">
          <h2 id="how" className="mb-4 text-lg font-semibold">
            How it runs
          </h2>
          <Card padded={false}>
            <ol className="divide-y divide-line">
              {STEPS.map(([part, time, text]) => (
                <li key={part} className="grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-x-4 px-5 py-4">
                  <span className="font-semibold">{part}</span>
                  <span className="text-[0.9375rem]">{text}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{time}</span>
                </li>
              ))}
            </ol>
          </Card>
          <p className="mt-3 text-sm text-muted-foreground">
            {/* Same labels as Settings → Live examiner. */}
            Examiner style: <span className="font-medium text-ink">{realtime ? 'Natural conversation' : 'Examiner waits for you to finish'}</span> ·{' '}
            <Link to="/settings" className={buttonStyles({ variant: 'link', className: 'hit' })}>
              Change
            </Link>
          </p>
          {fallback && (
            <Alert tone="warn" className="mt-4" title="Natural conversation isn't available right now">
              Your examiner will wait for you to finish each answer instead. It runs the same test.
            </Alert>
          )}
        </section>

        <section aria-labelledby="mic">
          <h2 id="mic" className="mb-4 text-lg font-semibold">
            Microphone check
          </h2>
          <Card className="space-y-4">
            <div className="flex items-start gap-3 text-[0.9375rem]">
              <Headphones className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <p>Headphones work best, so the examiner's voice doesn't reach your microphone. Find a quiet room.</p>
            </div>
            <MicCheck mic={mic} />
          </Card>
        </section>

        <div className="space-y-3">
          <Button
            size="lg"
            className="w-full sm:w-auto sm:px-8"
            aria-describedby={live ? undefined : 'start-hint'}
            disabled={!live}
            onClick={() => {
              void mic.stop().catch(() => {});
              onStart();
            }}
          >
            Start test
          </Button>
          {!live && (
            <p id="start-hint" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mic className="size-4 shrink-0" aria-hidden /> Test your microphone above to unlock the test.
            </p>
          )}
        </div>
      </div>
    </ExamShell>
  );
}
