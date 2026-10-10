// Transcription playground (owner only): try any OpenRouter speech-to-text model on a recording and compare words, timings, fillers and cost.
import { createRoute, z } from '@hono/zod-openapi';
import { requireOwner } from '../auth';
import { hfModels, isHfSpace, transcribeHfSpace } from '../ai/hfspace';
import { AiError, sttModels, transcribeOnce } from '../ai/openrouter';
import type { App } from '../types';
import { adminRoute } from './common';

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
  })
  .openapi('AdminSttRun');

export function register(app: App) {
  app.openapi(
    createRoute({ ...route, method: 'get', path: '/api/admin/stt/models', summary: "OpenRouter's speech-to-text models with list prices (cached an hour), plus CrisperWhisper on Hugging Face Spaces", responses: { 200: json(z.object({ models: z.array(SttModel) }).openapi('AdminSttModels'), 'Models') } }),
    async (c) => c.json({ models: [...hfModels(), ...(await sttModels())] }, 200),
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
                  audio: z.string().min(1).max(30_000_000).openapi({ description: 'Base64 audio, up to about 22 MB' }),
                  format: z.enum(['webm', 'm4a', 'wav', 'mp3', 'ogg']),
                  prompt: z.string().max(1000).optional().openapi({ description: 'Priming prompt (Whisper-style hosts only)' }),
                  language: z.string().max(10).nullable().optional().openapi({ description: 'ISO code; null lets the model detect it' }),
                })
                .openapi('AdminSttRequest'),
            },
          },
        },
      },
      responses: { 200: json(SttRun, 'Transcript'), 502: json(z.object({ error: z.string() }), 'The model failed') },
    }),
    async (c) => {
      const b = c.req.valid('json');
      try {
        const o = { ...b, audio: new Uint8Array(Buffer.from(b.audio, 'base64')), language: b.language === undefined ? 'en' : b.language };
        const r = isHfSpace(b.model) ? await transcribeHfSpace(o) : await transcribeOnce(o);
        return c.json(r, 200);
      } catch (e) {
        return c.json({ error: e instanceof AiError ? `${e.message}${e.status ? ` (${e.status})` : ''}` : (e as Error).message }, 502);
      }
    },
  );
}
