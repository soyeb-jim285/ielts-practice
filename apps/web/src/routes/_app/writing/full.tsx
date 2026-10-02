import { WRITING_SECONDS } from '@ielts/core';
import { createFileRoute, redirect } from '@tanstack/react-router';
import type { WritingPrompt } from '@/components/writing/PromptPanel';
import { TestGate } from '@/components/community/TestGate';
import { WritingExam } from '@/components/writing/WritingExam';
import { api } from '@/lib/api';

/**
 * Full writing test: Task 1 + Task 2 sharing one 60-minute clock. The prompt ids live in the URL
 * (the writing home picks them) so a reload brings back the same prompts and their saved drafts.
 */
export const Route = createFileRoute('/_app/writing/full')({
  validateSearch: (s: Record<string, unknown>): { t1: string; t2: string } => ({ t1: String(s.t1 ?? ''), t2: String(s.t2 ?? '') }),
  beforeLoad: ({ search }) => {
    if (!search.t1 || !search.t2) throw redirect({ to: '/writing' });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => Promise.all([api.get<WritingPrompt>(`/prompts/${deps.t1}`), api.get<WritingPrompt>(`/prompts/${deps.t2}`)]),
  staleTime: Infinity, // never reload mid-exam
  gcTime: 0,
  staticData: { exam: true },
  component: FullTest,
});

function FullTest() {
  const [t1, t2] = Route.useLoaderData();
  return (
    <TestGate skill="writing" title="Writing, full test">
      <WritingExam key={`${t1.id}+${t2.id}`} prompts={[t1, t2]} seconds={WRITING_SECONDS.full} mode="exam" />
    </TestGate>
  );
}
