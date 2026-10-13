// Pronunciation playground (owner only): our wav2vec2 phoneme scorer on Modal (modal/pronunciation) on a recording, with or without the text read.
import { createRoute, z } from '@hono/zod-openapi';
import { requireOwner } from '../auth';
import { assessPronunciation } from '../ai/modal';
import { AiError } from '../ai/openrouter';
import type { App } from '../types';
import { adminRoute } from './common';

const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const route = { tags: adminRoute.tags, security: [{ bearer: [] }], middleware: requireOwner };

const PronPhone = z.object({ expected: z.string(), heard: z.string(), score: z.number().openapi({ description: '0-1: posterior of the expected phone relative to the best phone heard' }), ok: z.boolean() });
const PronRun = z
  .object({
    mode: z.enum(['scripted', 'spontaneous']).openapi({ description: 'scripted: scored against the given text; spontaneous: transcribed first (Whisper small.en)' }),
    text: z.string(),
    audioSeconds: z.number(),
    accuracy: z.number().nullable().openapi({ description: '0-100, phone-weighted mean of word scores; uncalibrated against IELTS bands' }),
    mispronouncedWords: z.number(),
    words: z.array(z.object({ word: z.string(), score: z.number().nullable(), accent: z.enum(['us', 'gb']).nullable(), start: z.number().nullable(), end: z.number().nullable(), phones: z.array(PronPhone) })),
    fluency: z.object({ wordsPerMinute: z.number().nullable(), phonesPerSecond: z.number().nullable(), pauses: z.number(), longPauses: z.number(), speakingSeconds: z.number() }),
    confusions: z.array(z.object({ expected: z.string(), heard: z.string(), count: z.number() })),
    timing: z.record(z.string(), z.number()),
    model: z.string(),
    latencyMs: z.number(),
    costUsd: z.number().openapi({ description: 'Estimate: wall time x T4 price' }),
  })
  .openapi('AdminPronRun');

export function register(app: App) {
  app.openapi(
    createRoute({
      ...route,
      method: 'post',
      path: '/api/admin/pronunciation/assess',
      summary: 'Score the pronunciation of one recording (playground): per word and per phone, with fluency numbers',
      request: {
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z
                .object({
                  audio: z.string().min(1).max(30_000_000).openapi({ description: 'Base64 audio, up to about 22 MB' }),
                  format: z.enum(['webm', 'm4a', 'wav', 'mp3', 'ogg']),
                  text: z.string().max(5000).optional().openapi({ description: 'What the speaker read; omit for free speech' }),
                })
                .openapi('AdminPronRequest'),
            },
          },
        },
      },
      responses: { 200: json(PronRun, 'Scores'), 502: json(z.object({ error: z.string() }), 'The scorer failed') },
    }),
    async (c) => {
      const b = c.req.valid('json');
      try {
        return c.json(await assessPronunciation({ audio: new Uint8Array(Buffer.from(b.audio, 'base64')), format: b.format, text: b.text?.trim() || undefined }), 200);
      } catch (e) {
        return c.json({ error: e instanceof AiError ? `${e.message}${e.status ? ` (${e.status})` : ''}` : (e as Error).message }, 502);
      }
    },
  );
}
