// Attempt types and the attempt query, kept apart from lib/result.ts: the result routes' loaders need only these, and result.ts
// pulls in the speech-metrics code of @ielts/core, which the entry bundle should not load on /login.
import { queryOptions } from '@tanstack/react-query';
import type { AnalysisResult } from '@server/ai/types';
import { api } from './api';

export type AttemptStatus = 'recording' | 'analyzing' | 'done' | 'failed';

/** GET /api/attempts/:id */
export type Attempt = {
  id: string;
  promptId: string;
  skill: 'speaking' | 'writing';
  part: number;
  mode: 'practice' | 'live' | 'exam';
  sessionId: string | null;
  parentAttemptId: string | null;
  audioMime: string | null;
  audioUrl: string | null;
  text: string | null;
  plan: string | null;
  energy: number[] | null;
  marks: number[] | null;
  durationMs: number | null;
  overtime: boolean;
  status: AttemptStatus;
  error: string | null;
  /** status failed: false when an immediate retry cannot help (AI credit/key problem). */
  retryable?: boolean;
  createdAt: string;
  analysis: AnalysisResult | null;
  prompt: {
    id: string;
    skill: 'speaking' | 'writing';
    part: number;
    variant: 'academic' | 'general' | null;
    type: string;
    topic: string;
    title: string;
    body: string;
    bullets: string[] | null;
    followUps: string[] | null;
    chart: unknown;
    imageUrl: string | null;
    groupId: string | null;
  };
};

/** GET /api/attempts list row */
export type AttemptListItem = {
  id: string;
  promptId: string;
  promptTitle: string;
  skill: 'speaking' | 'writing';
  part: number;
  mode: 'practice' | 'live' | 'exam';
  sessionId: string | null;
  status: AttemptStatus;
  durationMs: number | null;
  overall: number | null;
  createdAt: string;
};

const pending = (s?: AttemptStatus) => s === 'analyzing';

/** Delay before the next poll while analysing: 2 s for the first five checks, 3 s for the next five, then 5 s (an analysis takes ~10-40 s; ~12 calls instead of ~20). */
export const pollDelay = (checks: number) => (checks < 5 ? 2000 : checks < 10 ? 3000 : 5000);

/** Attempt query that polls (with back-off) while the analysis runs. */
export const attemptQuery = (id: string) =>
  queryOptions({
    queryKey: ['attempt', id],
    queryFn: () => api.get<Attempt>(`/attempts/${id}`),
    refetchInterval: (q) => (pending(q.state.data?.status) ? pollDelay(q.state.dataUpdateCount) : false),
    staleTime: (q) => (pending(q.state.data?.status) ? 0 : 5 * 60_000), // presigned audio URL lives longer than this
  });

/** Re-run a failed analysis (or submit a never-submitted one with its stored data). */
export const retryAnalysis = (id: string) => api.post<{ status: 'analyzing' }>(`/attempts/${id}/submit`, {});
