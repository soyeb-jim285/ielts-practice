// In-process analysis runner. ponytail: fire-and-forget promises; move to pg-boss if concurrent load demands it.
import { P1_TEST_QUESTIONS } from '@ielts/core';
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from './db/client';
import { analyses, attempts, liveSessions, mistakes, prompts, user } from './db/schema';
import { liveQuestions, type LiveState } from './ai/examiner';
import { AiError } from './ai/openrouter';
import { keyCtx } from './ai/keyctx';
import { analyzeSpeaking } from './ai/speaking';
import type { AnalysisPartial, AnalysisResult, AnalysisStage, CriterionKey } from './ai/types';
import { analyzeWriting } from './ai/writing';
import { markKeyInvalid } from './keys';
import { payerOf, refundAttempt, type Tier } from './quota';
import { DEFAULT_SETTINGS, getSettings } from './settings';
import { storage } from './storage';

const FORMATS = ['webm', 'm4a', 'wav', 'mp3', 'ogg'] as const;
type Format = (typeof FORMATS)[number];

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
/** Stored prompt figure as a data: URL for vision models. */
const dataUrl = async (key: string) => `data:${IMAGE_MIME[key.split('.').pop()!.toLowerCase()] ?? 'image/png'};base64,${Buffer.from(await storage.get(key)).toString('base64')}`;

const bands = (r: AnalysisResult) => Object.fromEntries(Object.entries(r.criteria).map(([k, c]) => [k, c!.band])) as Partial<Record<CriterionKey, number>>;

/** Progress shown to a polling client: the pipeline step now running and, for writing, the feedback that is already ready. Best effort: never fails the analysis. */
const progress = (attemptId: string) => {
  let chain: Promise<void> = Promise.resolve(); // writes are queued so a late stage update can never overtake a newer one
  return (patch: { stage?: AnalysisStage; partial?: AnalysisPartial }) =>
    (chain = chain.then(() => db.update(attempts).set(patch).where(and(eq(attempts.id, attemptId), eq(attempts.status, 'analyzing'))).then(() => undefined, (e) => console.error('progress update failed', attemptId, e))));
};

/** Analysis runs on the owner's shared OpenRouter key unless the user brought their own, in which case every call in it (STT, scoring, audio pronunciation) uses theirs. */
export async function analyze(attemptId: string): Promise<void> {
  const a = await db.query.attempts.findFirst({ where: eq(attempts.id, attemptId) });
  if (!a) return;
  const u = await db.query.user.findFirst({ where: eq(user.id, a.userId), columns: { id: true, email: true, emailVerified: true, isAnonymous: true } });
  const payer = u ? await payerOf(u) : undefined;
  const ownKey = payer?.keys.openrouter;
  return keyCtx.run({ openrouter: ownKey, cost: { userId: a.userId, attemptId: a.id, sessionId: a.sessionId ?? undefined, promptId: a.promptId, skill: a.skill === 'writing' ? 'writing' : 'speaking', part: a.part }, onAuthFail: () => void markKeyInvalid(a.userId, 'openrouter') }, () => analyzeAttempt(a, payer?.tier ?? 'community'));
}

async function analyzeAttempt(a: typeof attempts.$inferSelect, tier: Tier): Promise<void> {
  const attemptId = a.id;
  const setStage = progress(attemptId);
  try {
    const p = await db.query.prompts.findFirst({ where: eq(prompts.id, a.promptId) });
    if (!p) throw new AiError('http', 'The prompt for this attempt no longer exists.');
    const own = await getSettings(a.userId);
    // Community-paid analysis always runs on the default models: a custom model choice (maybe a pricey one) is only honoured on the user's own key.
    const settings = tier === 'own-key' ? own : { ...own, models: DEFAULT_SETTINGS.models };
    let result: AnalysisResult;
    let models: Record<string, string>;
    if (a.skill === 'speaking') {
      // re-read the key: a guest who signed up since the attempt was loaded had the recording re-keyed to the new account (link.ts)
      const audioKey = (await db.query.attempts.findFirst({ where: eq(attempts.id, attemptId), columns: { audioKey: true } }))?.audioKey ?? a.audioKey;
      if (!audioKey) throw new AiError('http', 'No recording was uploaded for this attempt.');
      const ext = audioKey.split('.').pop() as Format;
      const part = a.part as 1 | 2 | 3;
      const session = a.mode === 'live' && a.sessionId && part !== 2 ? await db.query.liveSessions.findFirst({ where: eq(liveSessions.id, a.sessionId) }) : undefined;
      const questions =
        part === 2
          ? [[p.title, p.body.startsWith(p.title) ? p.body.slice(p.title.length).trim() : p.body].filter(Boolean).join('\n') + (p.bullets?.length ? `\nYou should say: ${p.bullets.join('; ')}` : '')]
          : ((session && liveQuestions(session.state as LiveState, part)) ??
            (p.followUps?.length ? (a.sessionId && part === 1 ? p.followUps.slice(0, P1_TEST_QUESTIONS) : p.followUps) : [p.body]));
      result = await analyzeSpeaking({
        onStage: (stage) => void setStage({ stage }),
        audio: await storage.get(audioKey),
        format: FORMATS.includes(ext) ? ext : 'webm',
        durationMs: a.durationMs ?? 0,
        energy: a.energy,
        marks: a.marks,
        segments: a.segments,
        questions,
        part,
        settings,
      });
      models = { stt: result.sttModel ?? settings.models.stt, analysis: settings.models.analysis };
    } else {
      result = await analyzeWriting({
        text: a.text ?? '',
        task: a.part as 1 | 2,
        variant: p.variant ?? 'academic',
        prompt: { title: p.title, body: p.body, bullets: p.bullets, chart: p.chart, image: !p.chart && p.imageKey ? await dataUrl(p.imageKey) : null },
        plan: a.plan,
        settings,
        onStage: (stage) => void setStage({ stage }),
        onPartial: (partial) => setStage({ partial }),
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
      const ownerId = (await tx.select({ userId: attempts.userId }).from(attempts).where(eq(attempts.id, attemptId)))[0]?.userId ?? a.userId; // not a.userId: a guest may have signed up meanwhile
      const row = { result, overall: result.overall, criteria: bands(result) as Record<string, number>, models };
      await tx.insert(analyses).values({ attemptId, ...row }).onConflictDoUpdate({ target: analyses.attemptId, set: row });
      await tx.delete(mistakes).where(eq(mistakes.attemptId, attemptId));
      if (result.errors.length)
        await tx.insert(mistakes).values(
          result.errors.map((e) => ({ userId: ownerId, attemptId, errorId: e.id, category: e.category, original: e.original, correction: e.correction, explanation: e.explanation, time: e.time })),
        );
      await tx.update(attempts).set({ status: 'done', error: null, errorRetryable: true, stage: null, partial: null }).where(eq(attempts.id, attemptId));
    });
    if (result.noSpeech) await refundAttempt(a); // nothing was heard: the test is given back
  } catch (e) {
    console.error('analysis failed', attemptId, e);
    const error = e instanceof AiError ? e.message : 'Analysis failed. Please retry.';
    await db.update(attempts).set({ status: 'failed', error, errorRetryable: !(e instanceof AiError) || e.retryable, stage: null, partial: null }).where(eq(attempts.id, attemptId)).catch((e2) => console.error('could not mark attempt failed', attemptId, e2));
    await refundAttempt(a); // a failed analysis never costs a test; a retry reserves it again
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

/** Spec §4: marks attempts `analyzing` for over 10 min (far beyond the longest analysis, so orphaned by a restart) as failed, so they can be retried.
 *  Younger rows may still be running in another process. Called at boot and every few minutes. */
export async function recoverStale(): Promise<void> {
  const stale = await db
    .update(attempts)
    .set({ status: 'failed', error: 'Interrupted, retry', errorRetryable: true, stage: null, partial: null })
    .where(and(eq(attempts.status, 'analyzing'), lt(attempts.updatedAt, sql`now() - interval '10 minutes'`)))
    .returning();
  for (const a of stale) await refundAttempt(a);
}

const GUEST_KEEP_DAYS = 30;
/** Guest data is kept 30 days (the result page says "Create an account to keep this result"): then the anonymous user, its attempts, quota rows and recordings go. */
export async function purgeGuests(): Promise<number> {
  const old = await db.select({ id: user.id }).from(user).where(and(eq(user.isAnonymous, true), lt(user.createdAt, sql`now() - ${GUEST_KEEP_DAYS} * interval '1 day'`))).limit(200);
  for (const { id } of old) {
    const sessions = await db.select({ id: liveSessions.id }).from(liveSessions).where(eq(liveSessions.userId, id));
    await storage.deletePrefix(`audio/${id}/`);
    for (const s of sessions) await storage.deletePrefix(`live/${s.id}/`);
    await db.delete(user).where(eq(user.id, id)); // cascades attempts, analyses, quota rows, sessions
  }
  return old.length;
}
