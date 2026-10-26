// Analysis queue on the attempts table: an `analyzing` row is a job. A worker claims it atomically (claimed_at, tries), keeps the claim fresh while it
// runs, and the pump picks up queued rows, due retries and claims left stale by a dead process (a deploy). At most CONCURRENCY run per process.
// ponytail: polling every 10 s; LISTEN/NOTIFY if a 10 s wait for a queued job ever matters.
import { P1_TEST_QUESTIONS } from '@ielts/core';
import { and, eq, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { db } from './db/client';
import { analyses, attempts, liveSessions, mistakes, prompts, user } from './db/schema';
import { liveQuestions, type LiveState } from './ai/examiner';
import { AiError } from './ai/openrouter';
import { keyCtx } from './ai/keyctx';
import { analyzeSpeaking, spokenQuestions } from './ai/speaking';
import type { AnalysisPartial, AnalysisResult, AnalysisStage, CriterionKey } from './ai/types';
import { analyzeWriting } from './ai/writing';
import { refundAttempt } from './quota';
import { MODELS } from './settings';
import { storage, uploadError } from './storage';

const FORMATS = ['webm', 'm4a', 'wav', 'mp3', 'ogg'] as const;
type Format = (typeof FORMATS)[number];

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
/** Stored prompt figure as a data: URL for vision models. */
const dataUrl = async (key: string) => `data:${IMAGE_MIME[key.split('.').pop()!.toLowerCase()] ?? 'image/png'};base64,${Buffer.from(await storage.get(key)).toString('base64')}`;

const CONCURRENCY = 3; // analyses at once per process: each holds audio in memory and fans out to 3-4 providers
let MAX_TRIES = 3; // claims per job, counting restarts; retryable errors wait 30 s, then 60 s
const STALE = sql`now() - interval '3 minutes'`; // a claim not refreshed for this long belongs to a dead process
const HEARTBEAT_MS = 60_000;
const DONE_QUEUE = { claimedAt: null, tries: 0, runAfter: null }; // a finished job: a later manual retry starts with fresh tries
/** A row the queue may start now: analyzing, and unclaimed and due, or claimed by a process that stopped refreshing it. */
const claimable = and(eq(attempts.status, 'analyzing'), or(and(isNull(attempts.claimedAt), or(isNull(attempts.runAfter), lte(attempts.runAfter, sql`now()`))), lt(attempts.claimedAt, STALE)));

const bands = (r: AnalysisResult) => Object.fromEntries(Object.entries(r.criteria).map(([k, c]) => [k, c!.band])) as Partial<Record<CriterionKey, number>>;

/** Progress shown to a polling client: the pipeline step now running and, for writing, the feedback that is already ready. Best effort: never fails the analysis. */
const progress = (attemptId: string) => {
  let chain: Promise<void> = Promise.resolve(); // writes are queued so a late stage update can never overtake a newer one
  return (patch: { stage?: AnalysisStage; partial?: AnalysisPartial }) =>
    (chain = chain.then(() => db.update(attempts).set(patch).where(and(eq(attempts.id, attemptId), eq(attempts.status, 'analyzing'))).then(() => undefined, (e) => console.error('progress update failed', attemptId, e))));
};

/** Analysis runs on the server's OpenRouter key; keyCtx tags every call's cost with the attempt. */
export async function analyze(attemptId: string): Promise<void> {
  // the claim: one UPDATE, so two workers can never both get the job
  const [claim] = await db.update(attempts).set({ claimedAt: sql`now()`, tries: sql`${attempts.tries} + 1` }).where(and(eq(attempts.id, attemptId), claimable)).returning({ tries: attempts.tries });
  if (!claim) return; // finished, not due yet, or another worker has it
  const a = await db.query.attempts.findFirst({ where: eq(attempts.id, attemptId) });
  if (!a) return;
  if (claim.tries > MAX_TRIES) return fail(a, 'Interrupted, retry', true); // claimed and lost MAX_TRIES times (restarts): stop
  const beat = setInterval(() => void db.update(attempts).set({ claimedAt: sql`now()` }).where(and(eq(attempts.id, attemptId), eq(attempts.status, 'analyzing'))).catch(() => {}), HEARTBEAT_MS);
  beat.unref();
  try {
    await analyzeAs(a, claim.tries);
  } finally {
    clearInterval(beat);
  }
}

async function analyzeAs(a: typeof attempts.$inferSelect, tries: number): Promise<void> {
  return keyCtx.run({ cost: { userId: a.userId, attemptId: a.id, sessionId: a.sessionId ?? undefined, promptId: a.promptId, skill: a.skill === 'writing' ? 'writing' : 'speaking', part: a.part } }, () => analyzeAttempt(a, tries));
}

/** Final failure: the user sees `error` and gets the test back (a retry reserves it again). */
async function fail(a: typeof attempts.$inferSelect, error: string, errorRetryable: boolean) {
  await db.update(attempts).set({ status: 'failed', error, errorRetryable, stage: null, partial: null, ...DONE_QUEUE }).where(eq(attempts.id, a.id)).catch((e2) => console.error('could not mark attempt failed', a.id, e2));
  await refundAttempt(a);
}

async function analyzeAttempt(a: typeof attempts.$inferSelect, tries: number): Promise<void> {
  const attemptId = a.id;
  const setStage = progress(attemptId);
  try {
    const p = await db.query.prompts.findFirst({ where: eq(prompts.id, a.promptId) });
    if (!p) throw new AiError('http', 'The prompt for this attempt no longer exists.');
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
          : ((a.mode === 'live' ? spokenQuestions(a.segments) : null) ??
            (session && liveQuestions(session.state as LiveState, part)) ??
            (p.followUps?.length ? (a.sessionId && part === 1 ? p.followUps.slice(0, P1_TEST_QUESTIONS) : p.followUps) : [p.body]));
      result = await analyzeSpeaking({
        onStage: (stage) => void setStage({ stage }),
        audio: await (async () => {
          const bad = await uploadError(audioKey);
          if (bad) throw new Error(bad); // checked at submit too; the presigned URL could have overwritten it since
          return storage.get(audioKey);
        })(),
        format: FORMATS.includes(ext) ? ext : 'webm',
        durationMs: a.durationMs ?? 0,
        energy: a.energy,
        marks: a.marks,
        segments: a.segments,
        questions,
        part,
        models: { ...MODELS, analysis: MODELS.speaking },
      });
      models = { stt: result.sttModel ?? MODELS.stt, analysis: MODELS.speaking };
    } else {
      result = await analyzeWriting({
        text: a.text ?? '',
        task: a.part as 1 | 2,
        variant: p.variant ?? 'academic',
        prompt: { title: p.title, body: p.body, bullets: p.bullets, chart: p.chart, image: !p.chart && p.imageKey ? await dataUrl(p.imageKey) : null },
        plan: a.plan,
        models: MODELS,
        onStage: (stage) => void setStage({ stage }),
        onPartial: (partial) => setStage({ partial }),
      });
      models = result.tooShort ? {} : { analysis: MODELS.analysis };
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
      await tx.update(attempts).set({ status: 'done', error: null, errorRetryable: true, stage: null, partial: null, ...DONE_QUEUE }).where(eq(attempts.id, attemptId));
    });
    if (result.noSpeech) await refundAttempt(a); // nothing was heard: the test is given back
  } catch (e) {
    console.error('analysis failed', attemptId, `try ${tries}/${MAX_TRIES}`, e);
    const retryable = !(e instanceof AiError) || e.retryable;
    if (retryable && tries < MAX_TRIES) {
      // back in the queue: the pump runs it again once run_after passes; still `analyzing` to the client, and no refund yet
      await db.update(attempts).set({ claimedAt: null, runAfter: sql`now() + ${30 * tries} * interval '1 second'`, stage: null, partial: null }).where(eq(attempts.id, attemptId)).catch((e2) => console.error('could not requeue attempt', attemptId, e2));
      return;
    }
    await fail(a, e instanceof AiError ? e.message : 'Analysis failed. Please retry.', retryable); // a failed analysis never costs a test
  }
}

/** Test injection: 1 makes a retryable failure final at once. */
export function setMaxTries(n: number) {
  MAX_TRIES = n;
}

let analyzer: (attemptId: string) => Promise<void> = analyze;
/** Test injection. */
export function setAnalyzer(fn: (attemptId: string) => Promise<void>) {
  analyzer = fn;
}
const active = new Set<string>();
let pumping = false;
/** Starts the analysis of an `analyzing` attempt now if this process has a free slot; otherwise it stays queued for the pump. Never throws. */
export function runAnalysis(attemptId: string): Promise<void> {
  if (active.has(attemptId) || active.size >= CONCURRENCY) return Promise.resolve();
  active.add(attemptId);
  return analyzer(attemptId)
    .catch((e) => console.error('runAnalysis', attemptId, e))
    .finally(() => {
      active.delete(attemptId);
      if (pumping) void pump(); // a slot opened: take the next queued job
    });
}

let pumpRun: Promise<void> | undefined;
/** Starts queued jobs, due retries and stale claims, oldest first, up to the free slots. */
export function pump(): Promise<void> {
  return (pumpRun ??= (async () => {
    try {
      const free = CONCURRENCY - active.size;
      if (free <= 0) return;
      const rows = await db
        .select({ id: attempts.id })
        .from(attempts)
        .where(active.size ? and(claimable, notInArray(attempts.id, [...active])) : claimable)
        .orderBy(attempts.createdAt)
        .limit(free);
      for (const r of rows) void runAnalysis(r.id);
    } catch (e) {
      console.error('analysis pump failed', e);
    } finally {
      pumpRun = undefined;
    }
  })());
}

/** Server boot: pump now and every 10 s (not in tests, which run analyses directly). */
export function startQueue() {
  pumping = true;
  void pump();
  setInterval(() => pumping && void pump(), 10_000).unref();
}

/** Shutdown: claim no more jobs. Running ones carry on until the process exits; a job cut off there is a stale claim the next process picks up. */
export function stopQueue() {
  pumping = false;
}

/** Last safety net behind the queue: an attempt `analyzing` for over 30 min (a running job refreshes its row every minute; a queued one waits
 *  seconds) is broken, so it is marked failed and can be retried. Called at boot and every few minutes. */
export async function recoverStale(): Promise<void> {
  const stale = await db
    .update(attempts)
    .set({ status: 'failed', error: 'Interrupted, retry', errorRetryable: true, stage: null, partial: null, ...DONE_QUEUE })
    .where(and(eq(attempts.status, 'analyzing'), lt(attempts.updatedAt, sql`now() - interval '30 minutes'`)))
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
