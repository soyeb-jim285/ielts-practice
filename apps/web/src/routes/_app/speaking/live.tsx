import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { LiveStage } from '@/components/live/LiveStage';
import { PreScreen } from '@/components/live/PreScreen';
import { toast } from '@/components/ui';
import { useMe } from '@/lib/query';
import { useGeminiExaminer } from '@/live/gemini';
import { useRealtimeExaminer } from '@/live/realtime';
import { useTurnExaminer, type LiveExaminer } from '@/live/turn';

export const Route = createFileRoute('/_app/speaking/live')({ staticData: { exam: true }, component: LivePage });

type Style = 'turn' | 'openai-realtime' | 'gemini-live';
type Run = { style: Style; fallback: boolean; onFinished: (sessionId: string, attemptIds: string[]) => void; onUnavailable: () => void };

function LivePage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  // Set when the chosen conversation provider couldn't connect: the turn-based examiner runs the same test instead.
  const [failed, setFailed] = useState(false);
  const onFinished = useCallback(
    (sessionId: string, [first]: string[]) => {
      if (first) return void navigate({ to: '/speaking/result/$attemptId', params: { attemptId: first }, search: { session: sessionId }, replace: true });
      toast('Nothing was recorded, so there is nothing to score.');
      void navigate({ to: '/speaking' });
    },
    [navigate],
  );
  const wanted = me?.settings.liveProvider ?? 'turn';
  const offered = wanted === 'openai-realtime' ? !!me?.realtimeAvailable : wanted === 'gemini-live' ? !!me?.geminiLiveAvailable : false;
  const style: Style = offered && !failed ? wanted : 'turn';
  const run = { style, fallback: wanted !== 'turn' && style === 'turn', onFinished, onUnavailable: () => setFailed(true) };
  // Separate components so each provider's hook is always called unconditionally.
  return style === 'openai-realtime' ? <RealtimeLive {...run} /> : style === 'gemini-live' ? <GeminiLive {...run} /> : <TurnLive {...run} />;
}

function TurnLive(p: Run) {
  return <Live ex={useTurnExaminer(p.onFinished)} {...p} />;
}

function RealtimeLive(p: Run) {
  return <Live ex={useRealtimeExaminer(p.onFinished, p.onUnavailable)} {...p} />;
}

function GeminiLive(p: Run) {
  return <Live ex={useGeminiExaminer(p.onFinished, p.onUnavailable)} {...p} />;
}

function Live({ ex, style, fallback }: Run & { ex: LiveExaminer }) {
  if (ex.status === 'idle') return <PreScreen style={style} fallback={fallback} onStart={() => void ex.start()} />;
  return <LiveStage ex={ex} />;
}
