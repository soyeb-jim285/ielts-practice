import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Lock } from 'lucide-react';
import { useCallback } from 'react';
import { TestGate } from '@/components/community/TestGate';
import { ExamShell } from '@/components/layout/ExamShell';
import { LiveStage } from '@/components/live/LiveStage';
import { PreScreen } from '@/components/live/PreScreen';
import { buttonStyles, IconTile, Skeleton, toast } from '@/components/ui';
import { rememberSession } from '@/lib/attempt';
import { api } from '@/lib/api';
import { useQuota } from '@/lib/community';
import { queryClient } from '@/lib/query';
import { useLiveKitExaminer } from '@/live/livekit';

export const Route = createFileRoute('/_app/speaking/live')({
  validateSearch: (s: Record<string, unknown>): { source?: 'cambridge' | 'generated'; mock?: string } => ({ source: s.source === 'cambridge' || s.source === 'generated' ? s.source : undefined, mock: typeof s.mock === 'string' ? s.mock : undefined }),
  staticData: { exam: true },
  component: LivePage,
});

/** The live examiner: LiveKit on the server's keys, for everyone (the speaking test allowance applies). */
function LivePage() {
  const quota = useQuota();
  if (quota.isPending)
    return (
      <ExamShell title="Live examiner">
        <Skeleton className="h-9 w-2/3" />
      </ExamShell>
    );
  if (!quota.data?.live) return <Unavailable />;
  return (
    <TestGate skill="examiner" title="Live examiner">
      <Live />
    </TestGate>
  );
}

function Unavailable() {
  return (
    <ExamShell title="Live examiner">
      <div className="space-y-5">
        <IconTile>
          <Lock />
        </IconTile>
        <div className="space-y-2">
          <h1 className="type-title-sm text-balance">The live examiner isn't available right now</h1>
          <p className="type-lede max-w-[56ch]">Please try again later. You can still take a recorded speaking test.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row [&>*]:max-sm:w-full">
          <Link to="/speaking" className={buttonStyles()}>
            <ArrowLeft aria-hidden /> Back to speaking
          </Link>
        </div>
      </div>
    </ExamShell>
  );
}

function Live() {
  const navigate = useNavigate();
  const { source, mock } = Route.useSearch();
  const onFinished = useCallback(
    (sessionId: string, [first, ...rest]: string[]) => {
      if (mock) {
        // Mock test: tie the live session to the mock, then go back to it (it shows the Speaking row being marked).
        if (first) rememberSession(sessionId, [first, ...rest]);
        void api
          .post(`/mock/${mock}/speaking/attach`, { sessionId })
          .catch(() => toast('Saved, but the mock test could not be linked to it. Open the result from History.', { tone: 'bad' }))
          .finally(() => {
            void queryClient.invalidateQueries({ queryKey: ['mock'] });
            void navigate({ to: '/mock/$id', params: { id: mock }, replace: true });
          });
        return;
      }
      if (first) {
        rememberSession(sessionId, [first, ...rest]);
        return void navigate({ to: '/speaking/result/$attemptId', params: { attemptId: first }, search: { session: sessionId }, replace: true });
      }
      toast('Nothing was recorded, so there is nothing to score.');
      void navigate({ to: '/speaking' });
    },
    [navigate, mock],
  );
  const ex = useLiveKitExaminer(onFinished, source, mock);
  if (ex.status === 'idle') return <PreScreen onStart={() => void ex.start()} />;
  return <LiveStage ex={ex} />;
}
