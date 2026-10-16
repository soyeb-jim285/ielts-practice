import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { userSettings } from './db/schema';
import { env } from './env';

/** The analysis models: the same for everyone (no per-user choice). */
export const MODELS = {
  analysis: 'openai/gpt-6-luna',
  stt: env.ELEVENLABS_API_KEY ? 'elevenlabs/scribe_v2' : 'openai/whisper-large-v3', // Scribe v2 when its key is set (spec §5.2), falling back to Whisper on error
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
