import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { userSettings } from './db/schema';

const ModelId = z.string().regex(/^[\w.-]+\/[\w.:-]+$/, 'Invalid model id');

export const SettingsSchema = z.object({
  models: z.object({
    analysis: ModelId,
    examiner: ModelId,
    stt: ModelId,
    tts: ModelId,
    ttsVoice: z.string().min(1),
    audioPron: ModelId,
  }),
  audioPronEnabled: z.boolean(),
  liveProvider: z.enum(['turn', 'openai-realtime']),
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
    analysis: 'openai/gpt-5-mini',
    examiner: 'openai/gpt-5-mini',
    stt: 'openai/whisper-large-v3',
    tts: 'google/gemini-3.8-flash-tts',
    ttsVoice: 'Charon', // must be one of the model's supported_voices (GET /api/models → voices)
    audioPron: 'google/gemini-2.5-flash',
  },
  audioPronEnabled: false,
  liveProvider: 'turn',
  targetBand: 7,
  writingAutoSubmit: true,
  blockPaste: true,
};

export function mergeSettings(patch: SettingsPatch | Record<string, unknown> | undefined): Settings {
  const p = (patch ?? {}) as SettingsPatch;
  return { ...DEFAULT_SETTINGS, ...p, models: { ...DEFAULT_SETTINGS.models, ...(p.models ?? {}) } };
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
