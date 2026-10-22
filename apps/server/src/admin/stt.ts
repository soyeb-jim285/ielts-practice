// Transcription playground (owner only): try any OpenRouter speech-to-text model on a recording and compare words, timings, fillers and cost.
import { createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { requireOwner } from '../auth';
import { hfModels, isHfSpace, transcribeHfSpace } from '../ai/hfspace';
import { isModal, modalModels, transcribeModal } from '../ai/modal';
import { AiError, sttModels, transcribeOnce } from '../ai/openrouter';
import { db } from '../db/client';
import { attempts, prompts, sttPlaygroundRuns, user } from '../db/schema';
import { storage } from '../storage';
import type { App } from '../types';
import { adminRoute, guestLabel, pageQuery, Paged } from './common';

const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const route = { tags: adminRoute.tags, security: [{ bearer: [] }], middleware: requireOwner }; // a single handler: a spread readonly tuple fails to type check

const SttModel = z
  .object({ id: z.string(), name: z.string(), description: z.string(), usdPerSecond: z.number().nullable(), usdPerMTokIn: z.number().nullable(), usdPerMTokOut: z.number().nullable() })
  .openapi('AdminSttModel');
const SttWord = z.object({ w: z.string(), start: z.number(), end: z.number(), conf: z.number().optional() });
const SttRun = z
  .object({
    model: z.string(),
    text: z.string(),
    words: z.array(SttWord),
    duration: z.number(),
    latencyMs: z.number(),
    costUsd: z.number().nullable().openapi({ description: 'null: token-priced model and OpenRouter sent no usage' }),
    costExact: z.boolean().openapi({ description: "true: OpenRouter's own usage.cost; false: list price x audio seconds" }),
    raw: z.unknown().openapi({ description: "The provider's response as OpenRouter returned it" }),
    cached: z.object({ at: z.string(), costUsd: z.number().nullable() }).nullable().openapi({ description: 'Set when this is a stored earlier run (costUsd above is then 0): when it ran and what it cost then' }),
  })
  .openapi('AdminSttRun');
const Recording = z
  .object({ id: z.string(), user: z.string(), name: z.string(), part: z.number().int(), mode: z.string(), prompt: z.string().nullable(), createdAt: z.string(), durationMs: z.number().nullable(), format: z.string(), audioUrl: z.string() })
  .openapi('AdminSttRecording');

const FORMATS = ['webm', 'm4a', 'wav', 'mp3', 'ogg'] as const;
type Format = (typeof FORMATS)[number];
/** OpenRouter's error JSON -> its message, plus the provider's own text when it passes one (`metadata.raw`). */
const upstreamWhy = (detail?: string) => {
  try {
    const { message, metadata } = (JSON.parse(detail ?? '') as { error: { message?: string; metadata?: { raw?: unknown } } }).error;
    return [message, metadata?.raw && String(typeof metadata.raw === 'string' ? metadata.raw : JSON.stringify(metadata.raw)).slice(0, 300)].filter(Boolean).join(': ');
  } catch {
    return detail;
  }
};
const formatOf = (key: string): Format => FORMATS.find((f) => key.endsWith(`.${f}`)) ?? 'webm';
/** Cache key of a playground run: everything that changes the transcript. The audio goes in by content hash, so an upload of a stored recording hits the same row. */
const runKey = (o: { audio: Uint8Array; format: string; model: string; prompt?: string; language: string | null }) =>
  createHash('sha256').update(JSON.stringify([createHash('sha256').update(o.audio).digest('hex'), o.format, o.model, o.prompt ?? '', o.language ?? 'auto'])).digest('hex');

export function register(app: App) {
  app.openapi(
    createRoute({
      ...route,
      method: 'get',
      path: '/api/admin/stt/recordings',
      summary: "Students' stored speaking recordings, newest first, to transcribe in the playground",
      request: { query: pageQuery.extend({ q: z.string().max(100).optional().openapi({ description: 'Email, name or prompt title contains' }) }) },
      responses: { 200: json(Paged(Recording).openapi('AdminSttRecordings'), 'Recordings') },
    }),
    async (c) => {
      const { page, pageSize, q } = c.req.valid('query');
      const like = q?.trim() && `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`;
      const where = and(isNotNull(attempts.audioKey), like ? or(ilike(user.email, like), ilike(user.name, like), ilike(prompts.title, like)) : undefined);
      const [rows, [count]] = await Promise.all([
        db.select({ a: attempts, email: user.email, name: user.name, isAnonymous: user.isAnonymous, title: prompts.title }).from(attempts).innerJoin(user, eq(user.id, attempts.userId)).leftJoin(prompts, eq(prompts.id, attempts.promptId)).where(where).orderBy(desc(attempts.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
        db.select({ n: sql<number>`count(*)::int` }).from(attempts).innerJoin(user, eq(user.id, attempts.userId)).leftJoin(prompts, eq(prompts.id, attempts.promptId)).where(where),
      ]);
      const items = await Promise.all(
        rows.map(async ({ a, email, name, isAnonymous, title }) => ({
          id: a.id, user: guestLabel({ id: a.userId, email, isAnonymous }), name, part: a.part, mode: a.mode, prompt: title, createdAt: a.createdAt.toISOString(), durationMs: a.durationMs, format: formatOf(a.audioKey!), audioUrl: await storage.presignGet(a.audioKey!, 3600),
        })),
      );
      return c.json({ items, page, pageSize, total: count!.n }, 200);
    },
  );

  app.openapi(
    createRoute({ ...route, method: 'get', path: '/api/admin/stt/models', summary: "OpenRouter's speech-to-text models with list prices (cached an hour), plus CrisperWhisper on Hugging Face Spaces and our verbatim Whisper on Modal", responses: { 200: json(z.object({ models: z.array(SttModel) }).openapi('AdminSttModels'), 'Models') } }),
    async (c) => c.json({ models: [...hfModels(), ...modalModels(), ...(await sttModels())] }, 200),
  );

  app.openapi(
    createRoute({
      ...route,
      method: 'post',
      path: '/api/admin/stt/transcribe',
      summary: 'Transcribe one recording with one model (playground; billed to the house key, logged as stage "playground")',
      request: {
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z
                .object({
                  model: z.string().min(3).max(120),
                  audio: z.string().min(1).max(30_000_000).optional().openapi({ description: 'Base64 audio, up to about 22 MB; or send recordingId' }),
                  format: z.enum(FORMATS).optional().openapi({ description: 'Required with audio' }),
                  recordingId: z.string().max(100).optional().openapi({ description: 'A stored speaking attempt (GET /api/admin/stt/recordings) instead of audio' }),
                  fresh: z.boolean().optional().openapi({ description: 'Skip the stored result and run (and store) again' }),
                  prompt: z.string().max(1000).optional().openapi({ description: 'Priming prompt (Whisper-style hosts only)' }),
                  language: z.string().max(10).nullable().optional().openapi({ description: 'ISO code; null lets the model detect it' }),
                })
                .refine((b) => (b.recordingId ? !b.audio : !!(b.audio && b.format)), 'Send audio with format, or recordingId')
                .openapi('AdminSttRequest'),
            },
          },
        },
      },
      responses: { 200: json(SttRun, 'Transcript'), 404: json(z.object({ error: z.string() }), 'No such recording'), 422: json(z.object({ error: z.string() }), 'The model failed (not 502: Cloudflare replaces 502 bodies, hiding the reason)') },
    }),
    async (c) => {
      const { audio, format, recordingId, fresh, ...b } = c.req.valid('json');
      try {
        let src: { audio: Uint8Array; format: Format };
        if (recordingId) {
          // only keys of real attempt rows: the client never names a storage key
          const a = await db.query.attempts.findFirst({ where: and(eq(attempts.id, recordingId), isNotNull(attempts.audioKey)), columns: { audioKey: true } });
          if (!a?.audioKey) return c.json({ error: 'No such recording' }, 404);
          const bytes = await storage.get(a.audioKey).catch(() => null);
          if (!bytes) return c.json({ error: "This recording's audio is no longer in storage" }, 404);
          src = { audio: bytes, format: formatOf(a.audioKey) };
        } else src = { audio: new Uint8Array(Buffer.from(audio!, 'base64')), format: format! };
        const o = { ...b, ...src, language: b.language === undefined ? 'en' : b.language };
        const key = runKey(o);
        if (!fresh) {
          const hit = await db.query.sttPlaygroundRuns.findFirst({ where: eq(sttPlaygroundRuns.key, key) });
          if (hit) {
            const r = hit.result as z.infer<typeof SttRun>;
            return c.json({ ...r, costUsd: 0, costExact: true, cached: { at: hit.createdAt.toISOString(), costUsd: r.costUsd } }, 200);
          }
        }
        const r = { ...(isHfSpace(b.model) ? await transcribeHfSpace(o) : isModal(b.model) ? await transcribeModal(o) : await transcribeOnce(o)), cached: null };
        await db.insert(sttPlaygroundRuns).values({ key, model: b.model, result: r }).onConflictDoUpdate({ target: sttPlaygroundRuns.key, set: { result: r, createdAt: new Date() } });
        return c.json(r, 200);
      } catch (e) {
        return c.json({ error: e instanceof AiError ? `${upstreamWhy(e.detail) || e.message}${e.status ? ` (${e.status})` : ''}` : (e as Error).message }, 422);
      }
    },
  );
}
