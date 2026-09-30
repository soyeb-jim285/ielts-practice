import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Alert, Button } from '@/components/ui';
import { retryAnalysis } from '@/lib/attempt';

/** Failed attempt: readable server message plus "Retry analysis" (POST submit again, then refetch), or a custom `action` (e.g. "Record again" when there is nothing to re-analyse). `extra` adds secondary ways out. */
export function FailedState({ attemptId, message, title = 'Analysis failed', action, extra, retryable = true }: { attemptId: string; message?: string | null; title?: string; action?: ReactNode; extra?: ReactNode; retryable?: boolean }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryAnalysis(attemptId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attempt', attemptId] }),
  });
  return (
    <Alert
      tone="bad"
      title={title}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {action ?? (
            // Not retryable (AI service out of credit/misconfigured): an immediate retry fails the same way, so offer it as "later".
            <Button size="sm" variant={retryable ? 'primary' : 'outline'} loading={retry.isPending} onClick={() => retry.mutate()}>
              {retryable ? 'Retry analysis' : 'Try again later'}
            </Button>
          )}
          {extra}
        </div>
      }
    >
      {retry.error?.message ?? message ?? 'Something went wrong. Your answer is saved, so you can retry.'}
    </Alert>
  );
}
