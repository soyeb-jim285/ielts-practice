import { Alert, Button } from '@/components/ui';
import type { RecorderState } from '@/hooks/useRecorder';

/** Inline mic denied / unsupported message with how to fix it, plus retry. Nothing is uploaded or created. */
export function MicProblem({ state, error, onRetry }: { state: RecorderState; error?: string; onRetry: () => void }) {
  if (state !== 'denied' && state !== 'unsupported') return null;
  return (
    <Alert
      tone="bad"
      title={state === 'denied' ? 'Microphone access is blocked' : 'Microphone unavailable'}
      action={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      <p>{error}</p>
      {state === 'denied' && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5">
          <li>Click the lock or tune icon next to the address bar.</li>
          <li>Set Microphone to Allow (on iPhone: Settings → Safari → Microphone).</li>
          <li>Come back and press Try again.</li>
        </ol>
      )}
    </Alert>
  );
}
