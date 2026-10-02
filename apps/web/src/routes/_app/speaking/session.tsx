import type { Prompt, SpeakingTest } from '@server/routes/prompts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MicOff } from 'lucide-react';
import { useState } from 'react';
import { TestGate } from '@/components/community/TestGate';
import { ExamShell } from '@/components/layout/ExamShell';
import { SessionFlow, toSegment, type Segment } from '@/components/speaking/SessionFlow';
import { Alert, Button, buttonStyles, EmptyState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

const MODES = ['full', 'p1', 'p2', 'p3'] as const;
type Mode = (typeof MODES)[number];
type Search = { mode: Mode; promptId?: string; parent?: string };

export const Route = createFileRoute('/_app/speaking/session')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    mode: MODES.includes(s.mode as Mode) ? (s.mode as Mode) : 'full',
    promptId: typeof s.promptId === 'string' ? s.promptId : undefined,
    parent: typeof s.parent === 'string' ? s.parent : undefined,
  }),
  staticData: { exam: true },
  component: SessionPage,
});

async function loadSegments({ mode, promptId }: Search): Promise<Segment[]> {
  if (promptId) return [toSegment(await api.get<Prompt>(`/prompts/${promptId}`))];
  if (mode === 'full') {
    const t = await api.get<SpeakingTest>('/speaking/test');
    return [...t.part1, t.part2, t.part3].map(toSegment);
  }
  return [toSegment(await api.get<Prompt>(`/prompts/random?skill=speaking&part=${mode.slice(1)}`))];
}

/** The gate first (quota, fair use, guest session); the questions load after it, because picking them needs a session. */
function SessionPage() {
  return (
    <TestGate skill="speaking" title="Speaking">
      <Session />
    </TestGate>
  );
}

function Session() {
  const search = Route.useSearch();
  // A fresh test each visit, stable while you're on the page.
  const q = useQuery({ queryKey: ['speaking-session', search.mode, search.promptId ?? null], queryFn: () => loadSegments(search), staleTime: Infinity, gcTime: 0 });
  const [sessionId] = useState(() => (search.mode === 'full' && !search.promptId ? crypto.randomUUID() : undefined));

  return q.data ? <SessionFlow segments={q.data} sessionId={sessionId} parentAttemptId={search.parent} /> : <Loading q={q} />;
}

function Loading({ q }: { q: ReturnType<typeof useQuery<Segment[]>> }) {
  return (
    <ExamShell title="Speaking">
      {q.isPending ? (
        <div className="space-y-4" aria-busy aria-label="Loading questions">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
          <div className="flex items-center gap-6 pt-8">
            <Skeleton className="size-24 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-full max-w-xs" />
            </div>
          </div>
        </div>
      ) : q.error instanceof ApiError && q.error.status === 404 ? (
        <EmptyState icon={<MicOff />} title="No questions available yet" action={<Link to="/speaking" className={buttonStyles({ variant: 'outline' })}>Back to speaking</Link>}>
          The prompt bank has no speaking prompts for this part. Seed the bank, then try again.
        </EmptyState>
      ) : (
        <Alert tone="bad" title="Couldn't load the questions" action={<Button size="sm" onClick={() => q.refetch()}>Try again</Button>}>
          {q.error?.message}
        </Alert>
      )}
    </ExamShell>
  );
}
