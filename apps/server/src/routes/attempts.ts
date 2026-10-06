import { createRoute, z } from '@hono/zod-openapi';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { visiblePromptWhere } from '../access';
import { currentUser, isOwner, requireUser } from '../auth';
import { db } from '../db/client';
import { analyses, attempts, mockExams, prompts } from '../db/schema';
import { ApiError } from '../errors';
import { clientIpHash } from '../ip';
import { runAnalysis } from '../jobs';
import { checkAttempt, payerOf, reserveAttempt } from '../quota';
import { aiLimit, lrSaveLimit } from '../ratelimit';
import { storage, uploadError } from '../storage';
import type { AnalysisResult } from '../ai/types';
import type { App } from '../types';
import { fixCard, inDeck } from './cards';
import { CodedError } from './community';
import { checkMockAttempt } from './mock';

const PAGE_SIZE = 20;
const GUEST_RECENT = 10; // guests get a short "your recent tests" list, never the full History
const AUDIO_EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav' };

const Skill = z.enum(['speaking', 'writing']);
const Status = z.enum(['recording', 'analyzing', 'done', 'failed']);
const Mode = z.enum(['practice', 'live', 'exam']);
const Id = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });
const ErrorSchema = z.object({ error: z.string() }).openapi('Error');
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const notFound = { 404: json(ErrorSchema, 'Not found') };
const authed = { tags: ['Attempts'], security: [{ bearer: [] }], middleware: [requireUser] };
const limited = {
  402: json(CodedError, 'community_balance_exhausted'),
  429: json(CodedError, 'quota_exceeded (or too_many_requests)'),
  503: json(CodedError, 'community_busy'),
};

const CreateAttempt = z
  .object({
    promptId: z.string(),
    skill: Skill,
    part: z.number().int().min(1).max(3),
    mode: Mode.default('practice'),
    sessionId: z.string().optional(),
    mockId: z.string().optional().openapi({ description: 'Full mock test: the attempt belongs to this open mock of the caller; sessionId must be the mock\'s writing/speaking session' }),
    parentAttemptId: z.string().optional(),
    text: z.string().max(20000).optional(),
    audioContentType: z.string().optional().openapi({ description: 'Speaking only: audio/webm | audio/mp4 | audio/m4a | audio/wav (codec params allowed). Default audio/webm.' }),
  })
  .openapi('CreateAttempt');

const CreatedAttempt = z
  .object({
    id: z.string(),
    uploadUrl: z.string().optional().openapi({ description: 'Presigned PUT (speaking). Send the same Content-Type as audioContentType.' }),
    audioKey: z.string().optional(),
  })
  .openapi('CreatedAttempt');

const SubmitAttempt = z
  .object({
    durationMs: z.number().int().min(0).optional().openapi({ description: 'Speaking: recording length. Writing: time spent in the editor (counts toward weekly minutes).' }),
    energy: z.array(z.number().int().min(0).max(255)).max(20000).optional().openapi({ description: '50 ms RMS frames, 0-255' }),
    marks: z.array(z.number().int().min(0)).max(200).optional().openapi({ description: 'Question start offsets (ms)' }),
    segments: z.array(z.object({ q: z.number().int().min(0), startMs: z.number().int().min(0), endMs: z.number().int().min(0) })).max(200).optional().openapi({ description: 'Non-live speaking: answer window of each question (ms within the recording). Time between windows is app timing (page render, examiner audio) and is left out of the pause measurements.' }),
    text: z.string().max(20000).optional(),
    plan: z.string().max(5000).optional(),
    overtime: z.boolean().optional(),
  })
  .openapi('SubmitAttempt');

const AttemptStatusSchema = z
  .object({
    status: Status,
    stage: z.enum(['transcribing', 'analyzing', 'feedback', 'scoring', 'finalizing']).nullable(),
    error: z.string().nullable(),
    retryable: z.boolean(),
  })
  .openapi('AttemptStatus');

const AttemptSchema = z
  .object({
    id: z.string(),
    promptId: z.string(),
    skill: Skill,
    part: z.number(),
    mode: Mode,
    sessionId: z.string().nullable(),
    parentAttemptId: z.string().nullable(),
    audioMime: z.string().nullable(),
    audioUrl: z.string().nullable(),
    text: z.string().nullable(),
    plan: z.string().nullable(),
    energy: z.array(z.number()).nullable(),
    marks: z.array(z.number()).nullable(),
    durationMs: z.number().nullable(),
    overtime: z.boolean(),
    status: Status,
    error: z.string().nullable(),
    retryable: z.boolean().openapi({ description: 'status failed: false when retrying now cannot help (AI credit/key problem); show "try later" instead of Retry' }),
    createdAt: z.string(),
    stage: z.enum(['transcribing', 'analyzing', 'feedback', 'scoring', 'finalizing']).nullable().openapi({ description: 'While analyzing: the pipeline step now running. writing: feedback → scoring (feedback is ready in `partial`) → finalizing; speaking: transcribing → analyzing → finalizing. null once done|failed or before the first step.' }),
    partial: z.unknown().nullable().openapi({ description: 'Writing, while stage is scoring: the feedback that is ready before the scores (errors, structure, top fixes, vocab upgrades, rewrite, text metrics: AnalysisResult fields without criteria/overall). null otherwise.' }),
    analysis: z.unknown().nullable().openapi({ description: 'AnalysisResult (spec §6) once status is done' }),
    models: z.record(z.string(), z.string()).nullable().openapi({ description: 'Models that produced the analysis, by role (stt, analysis); null until done' }),
    topFixesInDeck: z.boolean().openapi({ description: "Every top fix is already in the review deck (as POST /api/cards/bulk with source 'fix' adds them)" }),
    prompt: z
      .object({
        id: z.string(),
        skill: Skill,
        part: z.number(),
        variant: z.enum(['academic', 'general']).nullable(),
        type: z.string(),
        topic: z.string(),
        title: z.string(),
        body: z.string(),
        bullets: z.array(z.string()).nullable(),
        followUps: z.array(z.string()).nullable(),
        chart: z.unknown().nullable(),
        imageUrl: z.string().nullable(),
        groupId: z.string().nullable(),
      })
      .openapi('AttemptPrompt'),
  })
  .openapi('Attempt');

const AttemptListItem = z
  .object({
    id: z.string(),
    promptId: z.string(),
    promptTitle: z.string(),
    skill: Skill,
    part: z.number(),
    mode: Mode,
    sessionId: z.string().nullable(),
    status: Status,
    durationMs: z.number().nullable(),
    overall: z.number().nullable(),
    createdAt: z.string(),
  })
  .openapi('AttemptListItem');

async function ownAttempt(id: string, userId: string) {
  const a = await db.query.attempts.findFirst({ where: and(eq(attempts.id, id), eq(attempts.userId, userId)) });
  if (!a) throw new HTTPException(404, { message: 'Attempt not found' });
  return a;
}

/** Read-only lookup: the owner may open anyone's attempt (admin area); everyone else only their own. Writes keep using ownAttempt. */
const viewAttempt = (id: string, user: Parameters<typeof isOwner>[0] & { id: string }) => (isOwner(user) ? db.query.attempts.findFirst({ where: eq(attempts.id, id) }).then((a) => a ?? Promise.reject(new HTTPException(404, { message: 'Attempt not found' }))) : ownAttempt(id, user.id));

export function register(app: App) {
  app.openapi(
    createRoute({
      ...authed,
      method: 'post',
      path: '/api/attempts',
      summary: 'Create an attempt (speaking: returns a presigned audio upload URL)',
      description: 'Also checks the quota first (nothing is reserved yet), so a person out of tests hears before writing the essay: 429 quota_exceeded, 402 community_balance_exhausted, 503 community_busy. docs/community.md',
      request: { body: { required: true, content: { 'application/json': { schema: CreateAttempt } } } },
      responses: { 201: json(CreatedAttempt, 'Created'), 400: json(ErrorSchema, 'Bad request'), ...limited, ...notFound },
    }),
    async (c) => {
      const user = currentUser(c);
      const b = c.req.valid('json');
      const [prompt] = await db.select({ skill: prompts.skill, part: prompts.part }).from(prompts).where(and(eq(prompts.id, b.promptId), visiblePromptWhere(user)));
      if (!prompt) return c.json({ error: 'Prompt not found' }, 404);
      if (prompt.skill !== b.skill) return c.json({ error: 'Skill does not match prompt' }, 400);
      if (prompt.part !== b.part) return c.json({ error: 'Part does not match prompt' }, 400);
      if (b.parentAttemptId) {
        const parent = await ownAttempt(b.parentAttemptId, user.id);
        // A retry compares band deltas with its parent, so it must be the same task.
        if (parent.promptId !== b.promptId) return c.json({ error: 'A retry must use the same prompt as its parent attempt' }, 400);
      }

      const id = crypto.randomUUID();
      if (b.mockId) await checkMockAttempt(user.id, b.mockId, b);
      await checkAttempt(await payerOf(user), { id, userId: user.id, skill: b.skill, part: b.part, sessionId: b.sessionId ?? null }, clientIpHash(c));
      if (b.skill === 'writing') {
        await db.insert(attempts).values({ id, userId: user.id, promptId: b.promptId, skill: b.skill, part: b.part, mode: b.mode, sessionId: b.sessionId, parentAttemptId: b.parentAttemptId, text: b.text });
        if (b.mockId) await db.update(mockExams).set({ writingAttemptIds: sql`array_append(${mockExams.writingAttemptIds}, ${id})` }).where(eq(mockExams.id, b.mockId));
        return c.json({ id }, 201);
      }
      const mime = b.audioContentType ?? 'audio/webm';
      const ext = AUDIO_EXT[mime.split(';')[0]!.trim().toLowerCase()];
      if (!ext) return c.json({ error: `Unsupported audio type ${mime}` }, 400);
      const audioKey = `audio/${user.id}/${id}.${ext}`;
      await db.insert(attempts).values({ id, userId: user.id, promptId: b.promptId, skill: b.skill, part: b.part, mode: b.mode, sessionId: b.sessionId, parentAttemptId: b.parentAttemptId, audioKey, audioMime: mime });
      return c.json({ id, audioKey, uploadUrl: await storage.presignPut(audioKey, mime) }, 201);
    },
  );

  app.openapi(
    createRoute({
      ...authed,
      middleware: [requireUser, aiLimit],
      method: 'post',
      path: '/api/attempts/{id}/submit',
      summary: 'Submit an attempt for analysis (also re-runs a failed one). Returns immediately; poll GET /api/attempts/{id}.',
      description: 'Reserves the test against the quota (one per speaking/writing session; re-submitting the same attempt never costs again; refunded if analysis fails or no speech is heard). When refused, a writing draft sent in the body is still saved on the attempt. docs/community.md',
      request: { params: Id, body: { required: true, content: { 'application/json': { schema: SubmitAttempt } } } },
      responses: {
        200: json(z.object({ status: z.literal('analyzing') }), 'Analysis started'),
        400: json(ErrorSchema, 'Upload missing'),
        409: json(ErrorSchema, 'Already submitted'),
        ...limited,
        ...notFound,
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const b = c.req.valid('json');
      const user = currentUser(c);
      const a = await ownAttempt(id, user.id);
      if (a.status === 'analyzing' || a.status === 'done') return c.json({ error: `Attempt is already ${a.status}` }, 409);
      if (a.skill === 'speaking') {
        const bad = a.audioKey ? await uploadError(a.audioKey) : 'Upload missing';
        if (bad) return c.json({ error: bad }, 400);
      }
      try {
        await reserveAttempt(await payerOf(user), a, clientIpHash(c));
      } catch (e) {
        // The quota ran out between start and submit (a second tab, the window rolled): the essay is kept on the attempt, nothing is lost.
        if (e instanceof ApiError && a.skill === 'writing' && (b.text !== undefined || b.plan !== undefined)) await db.update(attempts).set({ text: b.text, plan: b.plan }).where(eq(attempts.id, id));
        throw e;
      }

      // drizzle skips undefined keys, so a bare {} re-runs a failed attempt with its stored data.
      const [updated] = await db
        .update(attempts)
        .set({ ...b, status: 'analyzing', error: null, errorRetryable: true, stage: null, partial: null })
        .where(and(eq(attempts.id, id), eq(attempts.status, a.status)))
        .returning({ id: attempts.id });
      if (!updated) return c.json({ error: 'Attempt is already analyzing' }, 409); // lost a double-submit race
      void runAnalysis(id).catch((e) => console.error('runAnalysis', id, e));
      return c.json({ status: 'analyzing' as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...authed,
      method: 'get',
      path: '/api/attempts/{id}/status',
      summary: 'Lightweight status for polling (no analysis, prompt or presigned URLs); fetch the full attempt when status or stage changes',
      request: { params: Id },
      responses: { 200: json(AttemptStatusSchema, 'Status'), ...notFound },
    }),
    async (c) => {
      const a = await viewAttempt(c.req.valid('param').id, currentUser(c));
      return c.json({ status: a.status, stage: a.status === 'analyzing' ? a.stage : null, error: a.error, retryable: a.errorRetryable }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...authed,
      method: 'get',
      path: '/api/attempts/{id}',
      summary: 'Attempt with analysis, presigned audio URL and prompt (poll until status is done|failed)',
      request: { params: Id },
      responses: { 200: json(AttemptSchema, 'Attempt'), ...notFound },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const a = await viewAttempt(id, currentUser(c));
      const uid = a.userId; // the owner viewing another user's result sees that user's deck state
      const [p, an] = await Promise.all([
        db.query.prompts.findFirst({ where: eq(prompts.id, a.promptId) }),
        db.query.analyses.findFirst({ where: eq(analyses.attemptId, id), columns: { result: true, models: true } }),
      ]);
      const fixes = (an?.result as AnalysisResult | undefined)?.topFixes ?? [];
      const [audioUrl, imageUrl, fixesAdded] = await Promise.all([
        a.audioKey ? storage.presignGet(a.audioKey) : null,
        p?.imageKey ? storage.presignGet(p.imageKey) : null,
        inDeck(uid, fixes.map(fixCard)),
      ]);
      return c.json(
        {
          id: a.id,
          promptId: a.promptId,
          skill: a.skill,
          part: a.part,
          mode: a.mode,
          sessionId: a.sessionId,
          parentAttemptId: a.parentAttemptId,
          audioMime: a.audioMime,
          audioUrl,
          text: a.text,
          plan: a.plan,
          energy: a.energy,
          marks: a.marks,
          durationMs: a.durationMs,
          overtime: a.overtime,
          status: a.status,
          error: a.error,
          retryable: a.errorRetryable,
          createdAt: a.createdAt.toISOString(),
          stage: a.status === 'analyzing' ? a.stage : null,
          partial: a.status === 'analyzing' ? a.partial : null,
          analysis: an?.result ?? null,
          models: an?.models ?? null,
          topFixesInDeck: fixes.length > 0 && fixesAdded.every(Boolean),
          prompt: {
            id: p!.id,
            skill: p!.skill,
            part: p!.part,
            variant: p!.variant,
            type: p!.type,
            topic: p!.topic,
            title: p!.title,
            body: p!.body,
            bullets: p!.bullets,
            followUps: p!.followUps,
            chart: p!.chart,
            imageUrl,
            groupId: p!.groupId,
          },
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      ...authed,
      method: 'get',
      path: '/api/attempts',
      summary: `Attempt history, newest first, ${PAGE_SIZE} per page. A guest (anonymous session) gets only their ${GUEST_RECENT} latest, no paging.`,
      request: { query: z.object({ skill: Skill.optional(), page: z.coerce.number().int().min(1).default(1) }) },
      responses: {
        200: json(z.object({ items: z.array(AttemptListItem), page: z.number(), pageSize: z.number(), total: z.number() }).openapi('AttemptList'), 'Attempts'),
      },
    }),
    async (c) => {
      const { skill, page: asked } = c.req.valid('query');
      const user = currentUser(c);
      const guest = user.isAnonymous;
      const page = guest ? 1 : asked;
      const size = guest ? GUEST_RECENT : PAGE_SIZE;
      const where = and(eq(attempts.userId, user.id), skill ? eq(attempts.skill, skill) : undefined);
      const [rows, [{ total } = { total: 0 }]] = await Promise.all([
        db
          .select({
            id: attempts.id,
            promptId: attempts.promptId,
            promptTitle: prompts.title,
            skill: attempts.skill,
            part: attempts.part,
            mode: attempts.mode,
            sessionId: attempts.sessionId,
            status: attempts.status,
            durationMs: attempts.durationMs,
            overall: analyses.overall,
            createdAt: attempts.createdAt,
          })
          .from(attempts)
          .innerJoin(prompts, eq(prompts.id, attempts.promptId))
          .leftJoin(analyses, eq(analyses.attemptId, attempts.id))
          .where(where)
          .orderBy(desc(attempts.createdAt), desc(attempts.id))
          .limit(size)
          .offset((page - 1) * size),
        db.select({ total: count() }).from(attempts).where(where),
      ]);
      return c.json({ items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), page, pageSize: size, total: guest ? Math.min(total, size) : total }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...authed,
      middleware: [requireUser, lrSaveLimit],
      method: 'delete',
      path: '/api/attempts/{id}',
      summary: 'Remove an attempt from my history (any status, also one still in progress)',
      description: 'Hard delete: the row, its analysis and mistakes (cascade) and its recording. Review cards stay (they hold no attempt reference). The quota is NOT refunded (quota_usage keeps the payment and its members). A retry whose parent this was loses the parent link.',
      request: { params: Id },
      responses: { 200: json(z.object({ ok: z.boolean() }), 'Deleted'), ...notFound },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const [gone] = await db.delete(attempts).where(and(eq(attempts.id, id), eq(attempts.userId, currentUser(c).id))).returning({ audioKey: attempts.audioKey });
      if (!gone) return c.json({ error: 'Attempt not found' }, 404);
      await db.update(attempts).set({ parentAttemptId: null }).where(and(eq(attempts.userId, currentUser(c).id), eq(attempts.parentAttemptId, id)));
      if (gone.audioKey) await storage.deletePrefix(gone.audioKey).catch((e) => console.error('recording delete failed', gone.audioKey, e)); // keys are unique per attempt, so the prefix is exactly this recording; best effort
      return c.json({ ok: true }, 200);
    },
  );
}
