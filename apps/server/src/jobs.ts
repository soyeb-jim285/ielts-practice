// In-process analysis runner. ponytail: fire-and-forget promises; move to pg-boss if concurrent load demands it.
import { P1_TEST_QUESTIONS } from '@ielts/core';
import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { analyses, attempts, liveSessions, mistakes, prompts } from './db/schema';
import { liveQuestions, type LiveState } from './ai/examiner';
import { AiError } from './ai/openrouter';
import { analyzeSpeaking } from './ai/speaking';
import type { AnalysisResult, CriterionKey } from './ai/types';
import { analyzeWriting } from './ai/writing';
import { getSettings } from './settings';
import { storage } from './storage';

const FORMATS = ['webm', 'm4a', 'wav', 'mp3', 'ogg'] as const;
type Format = (typeof FORMATS)[number];

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
/** Stored prompt figure as a data: URL for vision models. */
const dataUrl = async (key: string) => `data:${IMAGE_MIME[key.split('.').pop()!.toLowerCase()] ?? 'image/png'};base64,${Buffer.from(await storage.get(key)).toString('base64')}`;

const bands = (r: AnalysisResult) => Object.fromEntries(Object.entries(r.criteria).map(([k, c]) => [k, c!.band])) as Partial<Record<CriterionKey, number>>;

async function analyze(attemptId: string): Promise<void> {
  const a = await db.query.attempts.findFirst({ where: eq(attempts.id, attemptId) });
  if (!a) return;
  try {
    const p = await db.query.prompts.findFirst({ where: eq(prompts.id, a.promptId) });
    if (!p) throw new AiError('http', 'The prompt for this attempt no longer exists.');
    const settings = await getSettings(a.userId);

    let result: AnalysisResult;
    let models: Record<string, string>;
    if (a.skill === 'speaking') {
      if (!a.audioKey) throw new AiError('http', 'No recording was uploaded for this attempt.');
      const ext = a.audioKey.split('.').pop() as Format;
      const part = a.part as 1 | 2 | 3;
      const session = a.mode === 'live' && a.sessionId && part !== 2 ? await db.query.liveSessions.findFirst({ where: eq(liveSessions.id, a.sessionId) }) : undefined;
      const questions =
        part === 2
          ? [[p.title, p.body].filter((s, k, all) => s && all.indexOf(s) === k).join('\n') + (p.bullets?.length ? `\nYou should say: ${p.bullets.join('; ')}` : '')]
          : ((session && liveQuestions(session.state as LiveState, part)) ??
            (p.followUps?.length ? (a.sessionId && part === 1 ? p.followUps.slice(0, P1_TEST_QUESTIONS) : p.followUps) : [p.body]));
      result = await analyzeSpeaking({
        audio: await storage.get(a.audioKey),
        format: FORMATS.includes(ext) ? ext : 'webm',
        durationMs: a.durationMs ?? 0,
        energy: a.energy,
        marks: a.marks,
        questions,
        part,
        settings,
      });
      models = { stt: settings.models.stt, analysis: settings.models.analysis, ...(result.pronunciation?.llm && { audioPron: settings.models.audioPron }) };
    } else {
      result = await analyzeWriting({
        text: a.text ?? '',
        task: a.part as 1 | 2,
        variant: p.variant ?? 'academic',
        prompt: { title: p.title, body: p.body, bullets: p.bullets, chart: p.chart, image: !p.chart && p.imageKey ? await dataUrl(p.imageKey) : null },
        plan: a.plan,
        settings,
      });
      models = result.tooShort ? {} : { analysis: settings.models.analysis };
    }

    if (a.parentAttemptId) {
      const parent = await db.query.analyses.findFirst({ where: eq(analyses.attemptId, a.parentAttemptId) });
      const pr = parent?.result as AnalysisResult | undefined;
      if (pr) {
        const prev = bands(pr);
        const deltas = Object.fromEntries(Object.entries(bands(result)).filter(([k]) => prev[k as CriterionKey] != null).map(([k, b]) => [k, b! - prev[k as CriterionKey]!]));
        result.comparison = { parentAttemptId: a.parentAttemptId, parentOverall: pr.overall, deltas };
      }
    }

    await db.transaction(async (tx) => {
      const row = { result, overall: result.overall, criteria: bands(result) as Record<string, number>, models };
      await tx.insert(analyses).values({ attemptId, ...row }).onConflictDoUpdate({ target: analyses.attemptId, set: row });
      await tx.delete(mistakes).where(eq(mistakes.attemptId, attemptId));
      if (result.errors.length)
        await tx.insert(mistakes).values(
          result.errors.map((e) => ({ userId: a.userId, attemptId, errorId: e.id, category: e.category, original: e.original, correction: e.correction, explanation: e.explanation, time: e.time })),
        );
      await tx.update(attempts).set({ status: 'done', error: null, errorRetryable: true }).where(eq(attempts.id, attemptId));
    });
  } catch (e) {
    console.error('analysis failed', attemptId, e);
    const error = e instanceof AiError ? e.message : 'Analysis failed. Please retry.';
    await db.update(attempts).set({ status: 'failed', error, errorRetryable: !(e instanceof AiError) || e.retryable }).where(eq(attempts.id, attemptId)).catch((e2) => console.error('could not mark attempt failed', attemptId, e2));
  }
}

let analyzer: (attemptId: string) => Promise<void> = analyze;
/** Test injection. */
export function setAnalyzer(fn: (attemptId: string) => Promise<void>) {
  analyzer = fn;
}
/** Runs the analysis for an attempt, storing analyses + mistakes and setting status done|failed. Never throws. */
export function runAnalysis(attemptId: string): Promise<void> {
  return analyzer(attemptId).catch((e) => console.error('runAnalysis', attemptId, e));
}

/** Call once at boot: the runner is in-process, so every attempt still `analyzing` was orphaned by the restart. Marks them failed so they can be retried.
 *  ponytail: assumes a single server process; with several, limit this to rows older than the longest analysis. */
export async function recoverStale(): Promise<void> {
  await db.update(attempts).set({ status: 'failed', error: 'Interrupted, retry', errorRetryable: true }).where(eq(attempts.status, 'analyzing'));
}
