import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { userSettings } from './db/schema';

/** The analysis models: the same for everyone (no per-user choice). */
export const MODELS = {
  analysis: 'anthropic/claude-haiku-5.5', // writing: proofreading, feedback, image-figure scoring. Falls back to luna (openrouter.ts chat)
  speaking: 'openai/gpt-6-luna', // speaking feedback and disfluency tags stay on luna until Haiku is checked on real recordings
  stt: 'elevenlabs/scribe-v2', // Scribe v2 through OpenRouter (spec §5.2), falling back to Whisper on error
};
export type Models = typeof MODELS;

export const SettingsSchema = z.object({
  targetBand: z.number().min(4).max(9).multipleOf(0.5),
  writingAutoSubmit: z.boolean(),
  blockPaste: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = SettingsSchema.partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = { targetBand: 7, writingAutoSubmit: true, blockPaste: true };

/** Stored rows may still carry removed fields (models, liveProvider): the schema drops them. */
export const mergeSettings = (patch: SettingsPatch | Record<string, unknown> | undefined): Settings => SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...patch });

export async function getSettings(userId: string): Promise<Settings> {
  const row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  return mergeSettings(row?.data);
}

export async function updateSettings(userId: string, patch: SettingsPatch): Promise<Settings> {
  const row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  const next = SettingsPatchSchema.parse({ ...(row?.data ?? {}), ...patch }); // sparse: only what the user changed
  await db.insert(userSettings).values({ userId, data: next }).onConflictDoUpdate({ target: userSettings.userId, set: { data: next } });
  return mergeSettings(next);
}
