import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { userSettings } from './db/schema';
import { env } from './env';

const ModelId = z.string().regex(/^[\w.-]+\/[\w.:-]+$/, 'Invalid model id');

export const SettingsSchema = z.object({
  models: z.object({
    analysis: ModelId,
    examiner: ModelId,
    stt: ModelId,
    tts: ModelId,
    ttsVoice: z.string().min(1),
  }),
  liveProvider: z.enum(['turn', 'realtime-mini', 'gpt-live', 'gemini-live']),
  targetBand: z.number().min(4).max(9).multipleOf(0.5),
  writingAutoSubmit: z.boolean(),
  blockPaste: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = SettingsSchema.extend({ models: SettingsSchema.shape.models.partial() }).partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

// ponytail: defaults verified against OpenRouter /models at build time; users override in Settings.
export const DEFAULT_SETTINGS: Settings = {
  models: {
    analysis: 'openai/gpt-6-luna',
    examiner: 'openai/gpt-6-luna',
    stt: env.ELEVENLABS_API_KEY ? 'elevenlabs/scribe_v2' : 'openai/whisper-large-v3', // Scribe v2 when its key is set (spec §5.2), falling back to Whisper on error
    tts: 'google/gemini-3.8-flash-tts',
    ttsVoice: 'Charon', // must be one of the model's supported_voices (GET /api/models → voices)
  },
  liveProvider: 'realtime-mini', // OpenAI Realtime mini (~$0.02/min); without an OpenAI key the live page falls back to turn-based, quietly
  targetBand: 7,
  writingAutoSubmit: true,
  blockPaste: true,
};

export function mergeSettings(patch: SettingsPatch | Record<string, unknown> | undefined): Settings {
  const p = { ...(patch ?? {}) } as SettingsPatch;
  // The OpenAI provider used to be "openai-realtime" (gpt-realtime); stored values and old clients map to GPT-Live.
  if ((p.liveProvider as string) === 'openai-realtime') p.liveProvider = 'gpt-live';
  return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...p, models: { ...DEFAULT_SETTINGS.models, ...(p.models ?? {}) } });
}

export async function getSettings(userId: string): Promise<Settings> {
  const row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  return mergeSettings(row?.data);
}

export async function updateSettings(userId: string, patch: SettingsPatch): Promise<Settings> {
  const row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  const prev = (row?.data ?? {}) as SettingsPatch;
  const next = { ...prev, ...patch, models: { ...(prev.models ?? {}), ...(patch.models ?? {}) } };
  await db.insert(userSettings).values({ userId, data: next }).onConflictDoUpdate({ target: userSettings.userId, set: { data: next } });
  return mergeSettings(next);
}
