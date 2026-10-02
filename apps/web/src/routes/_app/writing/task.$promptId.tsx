import { WRITING_SECONDS } from '@ielts/core';
import { createFileRoute } from '@tanstack/react-router';
import type { WritingPrompt } from '@/components/writing/PromptPanel';
import { TestGate } from '@/components/community/TestGate';
import { WritingExam } from '@/components/writing/WritingExam';
import { api } from '@/lib/api';

export const Route = createFileRoute('/_app/writing/task/$promptId')({
  validateSearch: (s: Record<string, unknown>): { parent?: string } => ({ parent: typeof s.parent === 'string' ? s.parent : undefined }),
  loader: ({ params }) => api.get<WritingPrompt>(`/prompts/${params.promptId}`),
  // Never reload mid-exam; a fresh visit refetches.
  staleTime: Infinity,
  gcTime: 0,
  staticData: { exam: true },
  component: TaskPage,
});

function TaskPage() {
  const prompt = Route.useLoaderData();
  const { parent } = Route.useSearch();
  return (
    <TestGate skill="writing" title="Writing">
      <WritingExam key={prompt.id} prompts={[prompt]} seconds={prompt.part === 1 ? WRITING_SECONDS.t1 : WRITING_SECONDS.t2} mode="practice" parentAttemptId={parent} />
    </TestGate>
  );
}
