import { Link } from '@tanstack/react-router';
import { Headphones, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ExamShell } from '@/components/layout/ExamShell';
import { MicCheck } from '@/components/speaking/MicCheck';
import { Alert, Button, buttonStyles, Card, PageContainer, PageHeader } from '@/components/ui';
import { useRecorder } from '@/hooks/useRecorder';
import { PROVIDER_LABEL, type Provider } from '@/components/settings/LiveProvider';

const STEPS = [
  ['1', '4-5 min', 'Questions about you and familiar topics.'],
  ['2', '3-4 min', 'One minute to prepare from a cue card, then speak for up to two minutes.'],
  ['3', '4-5 min', 'A discussion of broader ideas linked to Part 2.'],
] as const;

/** Before the test (in the exam frame, Exit back to Speaking): how it runs, which examiner, and a mic check with a live level meter. */
export function PreScreen({ style, fallback, onStart }: { style: Provider; fallback: boolean; onStart: () => void }) {
  const mic = useRecorder();
  const live = mic.state === 'recording';
  // Ask for the microphone on entry so the check is already running (and Start works in one tap). The ref keeps StrictMode from asking twice.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void mic.start();
  }, []);

  return (
    <ExamShell
      exit={
        <Link to="/speaking" aria-label="Exit" className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
          <X aria-hidden />
          <span className="hidden sm:inline">Exit</span>
        </Link>
      }
    >
      <PageContainer width="narrow" className="space-y-8">
        <PageHeader title="Live examiner" description="A full speaking test with a voice examiner. About 11-14 minutes, like the real thing." />

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
            Examiner style: <span className="font-medium text-ink">{PROVIDER_LABEL[style]}</span>.{' '}
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

        <div className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {/* Always enabled: before the mic is ready a press retries the permission check instead of starting. */}
          {!live && mic.state !== 'requesting' && (
            <p id="start-hint" className="text-sm text-muted">
              Allow microphone access, then press again to begin.
            </p>
          )}
          <Button
            size="lg"
            className="w-full sm:w-auto sm:px-8"
            aria-describedby={live ? undefined : 'start-hint'}
            loading={mic.state === 'requesting'}
            onClick={() => {
              if (!live) return void mic.start();
              void mic.stop().catch(() => {});
              onStart();
            }}
          >
            {live ? 'Start test' : 'Check microphone and start'}
          </Button>
        </div>
      </PageContainer>
    </ExamShell>
  );
}
