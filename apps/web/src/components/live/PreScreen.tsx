import { Link } from '@tanstack/react-router';
import { Headphones, Mic, X } from 'lucide-react';
import { ExamShell } from '@/components/layout/ExamShell';
import { MicCheck } from '@/components/speaking/MicCheck';
import { Alert, Button, buttonStyles, Card, PageContainer, PageHeader } from '@/components/ui';
import { useRecorder } from '@/hooks/useRecorder';

const STEPS = [
  ['1', '4-5 min', 'Questions about you and familiar topics.'],
  ['2', '3-4 min', 'One minute to prepare from a cue card, then speak for up to two minutes.'],
  ['3', '4-5 min', 'A discussion of broader ideas linked to Part 2.'],
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
      <PageContainer width="narrow" className="space-y-10">
        <PageHeader title="Live examiner" description="A full speaking test with a voice examiner. About 11-14 minutes, like the real thing." />

        <section aria-labelledby="how">
          <h2 id="how" className="type-heading mb-4">
            How it runs
          </h2>
          <Card padded={false} className="overflow-hidden">
            <ol className="divide-y divide-line">
              {STEPS.map(([n, time, text]) => (
                <li key={n} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-4 px-5 py-4">
                  <span className="type-subheading w-14">Part {n}</span>
                  <span className="text-body">{text}</span>
                  <span className="type-caption type-num">{time}</span>
                </li>
              ))}
            </ol>
          </Card>
          <p className="type-caption mt-3">
            {/* Same labels as Settings, Live examiner. */}
            Examiner style: <span className="font-medium text-ink">{realtime ? 'Natural conversation' : 'Examiner waits for you to finish'}</span>.{' '}
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
          <h2 id="mic" className="type-heading mb-4">
            Microphone check
          </h2>
          <Card className="space-y-4">
            <div className="flex items-start gap-3 text-body">
              <Headphones className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
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
            <p id="start-hint" className="type-caption flex items-center gap-2">
              <Mic className="size-4 shrink-0" aria-hidden /> Test your microphone above to unlock the test.
            </p>
          )}
        </div>
      </PageContainer>
    </ExamShell>
  );
}
