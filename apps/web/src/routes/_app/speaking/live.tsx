import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { LiveStage } from '@/components/live/LiveStage';
import { PreScreen } from '@/components/live/PreScreen';
import { toast } from '@/components/ui';
import { useMe } from '@/lib/query';
import { useRealtimeExaminer } from '@/live/realtime';
import { useTurnExaminer, type LiveExaminer } from '@/live/turn';

export const Route = createFileRoute('/_app/speaking/live')({ staticData: { exam: true }, component: LivePage });

type Run = { realtime: boolean; fallback: boolean; onFinished: (sessionId: string, attemptIds: string[]) => void };

function LivePage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const onFinished = useCallback(
    (sessionId: string, [first]: string[]) => {
      if (first) return void navigate({ to: '/speaking/result/$attemptId', params: { attemptId: first }, search: { session: sessionId }, replace: true });
      toast('Nothing was recorded, so there is nothing to score.');
      void navigate({ to: '/speaking' });
    },
    [navigate],
  );
  const wantsRealtime = me?.settings.liveProvider === 'openai-realtime';
  const realtime = wantsRealtime && !!me?.realtimeAvailable;
  const run = { realtime, fallback: wantsRealtime && !realtime, onFinished };
  // Separate components so each provider's hook is always called unconditionally.
  return realtime ? <RealtimeLive {...run} /> : <TurnLive {...run} />;
}

function TurnLive(p: Run) {
  return <Live ex={useTurnExaminer(p.onFinished)} {...p} />;
}

function RealtimeLive(p: Run) {
  return <Live ex={useRealtimeExaminer(p.onFinished)} {...p} />;
}

function Live({ ex, realtime, fallback }: Run & { ex: LiveExaminer }) {
  if (ex.status === 'idle') return <PreScreen realtime={realtime} fallback={fallback} onStart={() => void ex.start()} />;
  return <LiveStage ex={ex} />;
}
