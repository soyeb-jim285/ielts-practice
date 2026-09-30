import { Link } from '@tanstack/react-router';
import { Headphones, X } from 'lucide-react';
import { ExamShell } from '@/components/layout/ExamShell';
import { MicCheck } from '@/components/speaking/MicCheck';
import { Alert, Button, Card, PageHeader } from '@/components/ui';
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
        <Link to="/speaking" aria-label="Exit" className="hit inline-flex h-9 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink">
          <X className="size-5" aria-hidden />
          <span className="hidden sm:inline">Exit</span>
        </Link>
      }
    >
      <div className="space-y-8">
        <PageHeader title="Live examiner" description="A full speaking test with a voice examiner. About 11–14 minutes, like the real thing." />

        <section aria-labelledby="how">
          <h2 id="how" className="mb-3 text-lg font-semibold">
            How it runs
          </h2>
          <Card padded={false}>
            <ol className="divide-y divide-line">
              {STEPS.map(([part, time, text]) => (
                <li key={part} className="flex gap-4 px-5 py-4">
                  <span className="w-14 shrink-0 font-semibold">{part}</span>
                  <span className="min-w-0 flex-1 text-[0.9375rem]">{text}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted">{time}</span>
                </li>
              ))}
            </ol>
          </Card>
          <p className="mt-3 text-sm text-muted">
            {/* Same labels as Settings → Live examiner. */}
            Examiner: <span className="font-medium text-ink">{realtime ? 'Natural conversation' : 'Examiner waits for you to finish'}</span> ·{' '}
            <Link to="/settings" className="hit text-accent-text underline-offset-2 hover:underline">
              Change
            </Link>
          </p>
          {fallback && (
            <Alert tone="warn" title="Natural conversation isn't available right now">
              Your examiner will wait for you to finish each answer instead. It runs the same test.
            </Alert>
          )}
        </section>

        <section aria-labelledby="mic">
          <h2 id="mic" className="mb-3 text-lg font-semibold">
            Microphone check
          </h2>
          <Card className="space-y-4">
            <div className="flex items-start gap-3 text-[0.9375rem]">
              <Headphones className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
              <p>Headphones work best, so the examiner's voice doesn't reach your microphone. Find a quiet room.</p>
            </div>
            <MicCheck mic={mic} />
          </Card>
        </section>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Button
            size="lg"
            disabled={!live}
            onClick={() => {
              void mic.stop().catch(() => {});
              onStart();
            }}
          >
            Start test
          </Button>
          {!live && <p className="text-sm text-muted">Check your microphone first.</p>}
        </div>
      </div>
    </ExamShell>
  );
}
