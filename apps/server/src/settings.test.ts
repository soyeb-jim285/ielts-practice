import { expect, it } from 'vitest';
import { req, testUser } from './test/helpers';
import { DEFAULT_SETTINGS, isTimeZone, mergeSettings, storedSettings, updateSettings } from './settings';

it('drops removed settings (models, liveProvider) from stored preferences and keeps the rest', () => {
  expect(mergeSettings({ models: { analysis: 'openai/gpt-5-mini' }, liveProvider: 'gpt-live', targetBand: 8 })).toEqual({ ...DEFAULT_SETTINGS, targetBand: 8 });
});

it('validates time zones', () => {
  expect(isTimeZone('Asia/Dhaka')).toBe(true);
  expect(isTimeZone('Mars/Base')).toBe(false);
});

it('defaults exam date and time zone', () => {
  expect(mergeSettings({})).toMatchObject({ examDate: null, timeZone: 'UTC' });
});

it('storedSettings is the sparse row', async () => {
  const { user } = await testUser();
  await updateSettings(user.id, { timeZone: 'Asia/Dhaka' });
  expect(await storedSettings(user.id)).toEqual({ timeZone: 'Asia/Dhaka' });
});

it('rejects an unknown time zone over HTTP', async () => {
  const { headers } = await testUser();
  expect((await req('/api/settings', { method: 'PUT', headers, body: { timeZone: 'Mars/Base' } })).status).toBe(400);
});
