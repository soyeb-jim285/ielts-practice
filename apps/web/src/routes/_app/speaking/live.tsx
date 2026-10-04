import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Lock } from 'lucide-react';
import { useCallback, useState } from 'react';
import { TestGate } from '@/components/community/TestGate';
import { ExamShell } from '@/components/layout/ExamShell';
import { LiveStage } from '@/components/live/LiveStage';
import { PreScreen } from '@/components/live/PreScreen';
import { buttonStyles, IconTile, Skeleton, toast } from '@/components/ui';
import { rememberSession } from '@/lib/attempt';
import { useQuota } from '@/lib/community';
import { useMe } from '@/lib/query';
import { useGeminiExaminer } from '@/live/gemini';
import { useGptLiveExaminer } from '@/live/gptLive';
import { useTurnExaminer, type LiveExaminer, type LiveSource } from '@/live/turn';

export const Route = createFileRoute('/_app/speaking/live')({
  validateSearch: (s: Record<string, unknown>): { source?: 'cambridge' | 'generated' } => ({ source: s.source === 'cambridge' || s.source === 'generated' ? s.source : undefined }),
  staticData: { exam: true },
  component: LivePage,
});

type Style = 'turn' | 'gpt-live' | 'gemini-live';
type Run = { style: Style; fallback: false | 'failed' | 'locked'; source: LiveSource; onFinished: (sessionId: string, attemptIds: string[]) => void; onUnavailable?: () => void };

/** The live examiner runs on the person's own key and is never paid from the community balance: no key, no live. */
function LivePage() {
  const quota = useQuota();
  if (quota.isPending)
    return (
      <ExamShell title="Live examiner">
        <Skeleton className="h-9 w-2/3" />
      </ExamShell>
    );
  const providers = quota.data?.liveProviders ?? [];
  if (!providers.length) return <Locked guest={quota.data?.tier === 'guest'} />;
  return (
    <TestGate skill="speaking" title="Live examiner">
      <Live providers={providers} />
    </TestGate>
  );
}

function Locked({ guest }: { guest: boolean }) {
  return (
    <ExamShell title="Live examiner">
      <div className="space-y-5">
        <IconTile>
          <Lock />
        </IconTile>
        <div className="space-y-2">
          <h1 className="type-title-sm text-balance">Live needs your own OpenAI or Gemini key</h1>
          <p className="type-lede max-w-[56ch]">
            The live examiner talks with you in real time, so it runs on your own key and never uses the community balance. Add an OpenAI key for GPT-Live or a Gemini key for Gemini Live.
          </p>
          <p className="type-caption max-w-[56ch]">{guest ? 'Keys belong to an account, so create one first. ' : ''}An OpenRouter key also unlocks the turn-based examiner, which waits for you to finish each answer.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row [&>*]:max-sm:w-full">
          {guest ? (
            <Link to="/signup" search={{ redirect: '/speaking/live' }} className={buttonStyles()}>
              Create an account
            </Link>
          ) : (
            <Link to="/settings" hash="api-keys" className={buttonStyles()}>
              Add your own key
            </Link>
          )}
          <Link to="/speaking" className={buttonStyles({ variant: 'ghost' })}>
            <ArrowLeft aria-hidden /> Back to speaking
          </Link>
        </div>
      </div>
    </ExamShell>
  );
}

function Live({ providers }: { providers: Style[] }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const { source } = Route.useSearch();
  // Set when the chosen conversation provider couldn't connect: the turn-based examiner runs the same test instead (when the person has an OpenRouter key).
  const [failed, setFailed] = useState(false);
  const onFinished = useCallback(
    (sessionId: string, [first, ...rest]: string[]) => {
      if (first) {
        rememberSession(sessionId, [first, ...rest]);
        return void navigate({ to: '/speaking/result/$attemptId', params: { attemptId: first }, search: { session: sessionId }, replace: true });
      }
      toast('Nothing was recorded, so there is nothing to score.');
      void navigate({ to: '/speaking' });
    },
    [navigate],
  );
  const wanted = me?.settings.liveProvider ?? 'turn';
  const canTurn = providers.includes('turn');
  const natural = providers.find((p) => p !== 'turn');
  // The saved choice if it is allowed; else turn-based; else whichever conversation provider their key unlocks.
  const chosen: Style = providers.includes(wanted) && !(failed && wanted !== 'turn') ? wanted : canTurn ? 'turn' : (natural ?? 'turn');
  const fallback = wanted !== 'turn' && chosen === 'turn' ? (providers.includes(wanted) ? 'failed' : 'locked') : false;
  const run: Run = { style: chosen, fallback, source, onFinished, onUnavailable: canTurn ? () => setFailed(true) : undefined };
  // Separate components so each provider's hook is always called unconditionally.
  return chosen === 'gpt-live' ? <GptLive {...run} /> : chosen === 'gemini-live' ? <GeminiLive {...run} /> : <TurnLive {...run} />;
}

function TurnLive(p: Run) {
  return <Stage ex={useTurnExaminer(p.onFinished, p.source)} {...p} />;
}

function GptLive(p: Run) {
  return <Stage ex={useGptLiveExaminer(p.onFinished, p.onUnavailable, p.source)} {...p} />;
}

function GeminiLive(p: Run) {
  return <Stage ex={useGeminiExaminer(p.onFinished, p.onUnavailable, p.source)} {...p} />;
}

function Stage({ ex, style, fallback }: Run & { ex: LiveExaminer }) {
  if (ex.status === 'idle') return <PreScreen style={style} fallback={fallback} onStart={() => void ex.start()} />;
  return <LiveStage ex={ex} />;
}
