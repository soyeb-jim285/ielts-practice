import { createRoute, z } from '@hono/zod-openapi';
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

const FILTERS: Record<z.infer<typeof Capability>, (m: ModelInfo) => boolean> = {
  text: (m) => m.output.includes('text'),
  'audio-in': (m) => m.input.includes('audio'),
  stt: (m) => m.output.includes('transcription') || /whisper|transcribe/i.test(m.id),
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
      middleware: [requireUser] as const,
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
        return c.json({ models: capability ? all.filter(FILTERS[capability]) : all }, 200);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 502);
      }
    },
  );
}
