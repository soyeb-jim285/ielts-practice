import { WRITING_SECONDS } from '@ielts/core';
import { createFileRoute, redirect } from '@tanstack/react-router';
import type { WritingPrompt } from '@/components/writing/PromptPanel';
import { TestGate } from '@/components/community/TestGate';
import { WritingExam } from '@/components/writing/WritingExam';
import { api, call, client } from '@/lib/api';

/**
 * Full writing test: Task 1 + Task 2 sharing one 60-minute clock. The prompt ids live in the URL
 * (the writing home picks them) so a reload brings back the same prompts and their saved drafts.
 * With `mock` set this is the Writing section of a mock test: the mock supplies the prompts, the session id and the clock used so far.
 */
type Search = { t1?: string; t2?: string; mock?: string };
export const Route = createFileRoute('/_app/writing/full')({
  validateSearch: (s: Record<string, unknown>): Search => ({ t1: typeof s.t1 === 'string' && s.t1 ? s.t1 : undefined, t2: typeof s.t2 === 'string' && s.t2 ? s.t2 : undefined, mock: typeof s.mock === 'string' ? s.mock : undefined }),
  beforeLoad: ({ search }) => {
    if (!search.mock && (!search.t1 || !search.t2)) throw redirect({ to: '/writing' });
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (deps.mock) {
      const w = await call(client.POST('/api/mock/{id}/writing/start', { params: { path: { id: deps.mock } } }));
      const [t1, t2] = [...w.prompts].sort((a, b) => a.part - b.part) as unknown as WritingPrompt[];
      return { prompts: [t1!, t2!], sessionId: w.writingSessionId, elapsedS: w.elapsedS };
    }
    return { prompts: await Promise.all([api.get<WritingPrompt>(`/prompts/${deps.t1!}`), api.get<WritingPrompt>(`/prompts/${deps.t2!}`)]), sessionId: undefined, elapsedS: 0 };
  },
  staleTime: Infinity, // never reload mid-exam
  gcTime: 0,
  staticData: { exam: true },
  component: FullTest,
});

function FullTest() {
  const { prompts, sessionId, elapsedS } = Route.useLoaderData();
  const { mock } = Route.useSearch();
  return (
    <TestGate skill="writing" title="Writing, full test">
      <WritingExam key={prompts.map((p) => p.id).join('+')} prompts={prompts} seconds={WRITING_SECONDS.full} mode="exam" mockId={mock} sessionId={sessionId} initialElapsedS={elapsedS} />
    </TestGate>
  );
}
