import { createRoute, z } from '@hono/zod-openapi';
import { etag } from 'hono/etag';
import { listModels, type ModelInfo } from '../ai/openrouter';
import { requireUser } from '../auth';
import type { App } from '../types';

const Capability = z.enum(['text', 'audio-in', 'stt', 'tts']);

const ModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    input: z.array(z.string()),
    output: z.array(z.string()),
    pricing: z.object({ prompt: z.string(), completion: z.string() }).openapi({ description: 'USD per token, as strings' }),
    voices: z.array(z.string()).openapi({ description: 'TTS voices the model supports (empty for non-speech models)' }),
  })
  .openapi('Model');

/** Transcription models our call cannot use: we ask for word timestamps (verbose_json), which gpt-*-transcribe, voxtral-small and qwen-asr-flash reject, and whisper-large-v3-turbo loops
 *  on disfluent speech (.eval/stt-bakeoff; docs/stt-models.md). Hiding them keeps Settings to models that work. */
const STT_UNUSABLE = /(^|\/)gpt-(4o-)?(mini-)?transcribe|^openai\/gpt-transcribe|voxtral-small|qwen3-asr-flash|whisper-large-v3-turbo/i;

const FILTERS: Record<z.infer<typeof Capability>, (m: ModelInfo) => boolean> = {
  text: (m) => m.output.includes('text'),
  'audio-in': (m) => m.input.includes('audio'),
  stt: (m) => (m.output.includes('transcription') || /whisper|transcribe/i.test(m.id)) && !STT_UNUSABLE.test(m.id),
  // /audio/speech models only; music (lyria) and chat-audio (gpt-audio) models output 'audio' and fail there. A voice is required by Settings.
  tts: (m) => m.output.includes('speech') && m.voices.length > 0,
};

export function register(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/models',
      tags: ['Settings'],
      summary: 'OpenRouter models (cached 1 h), optionally filtered by capability',
      security: [{ bearer: [] }],
      middleware: [requireUser, etag()] as const,
      request: { query: z.object({ capability: Capability.optional() }) },
      responses: {
        200: { description: 'Models', content: { 'application/json': { schema: z.object({ models: z.array(ModelSchema) }).openapi('ModelList') } } },
        502: { description: 'OpenRouter unavailable', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
      },
    }),
    async (c) => {
      const { capability } = c.req.valid('query');
      try {
        const all = await listModels();
        c.header('Cache-Control', 'private, max-age=3600'); // near-static list (cached server-side for 1 h too); ETag revalidation is free after that
        return c.json({ models: capability ? all.filter(FILTERS[capability]) : all }, 200);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 502);
      }
    },
  );
}
