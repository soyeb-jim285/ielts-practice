import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Alert, Button } from '@/components/ui';
import { retryAnalysis } from '@/lib/result';

/** Failed attempt: readable server message plus "Retry analysis" (POST submit again, then refetch), or a custom `action` (e.g. "Record again" when there is nothing to re-analyse). */
export function FailedState({ attemptId, message, title = 'Analysis failed', action }: { attemptId: string; message?: string | null; title?: string; action?: ReactNode }) {
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
        action ?? (
          <Button size="sm" loading={retry.isPending} onClick={() => retry.mutate()}>
            Retry analysis
          </Button>
        )
      }
    >
      {retry.error?.message ?? message ?? 'Something went wrong. Your answer is saved, so you can retry.'}
    </Alert>
  );
}
