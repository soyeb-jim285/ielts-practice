import { it, expect } from 'vitest';
import { req, testUser } from '../test/helpers';
import { DEFAULT_SETTINGS } from '../settings';

it('requires auth', async () => {
  expect((await req('/api/settings')).status).toBe(401);
});

it('returns defaults, applies partial updates, rejects bad values', async () => {
  const { headers } = await testUser();
  expect(await (await req('/api/settings', { headers })).json()).toEqual(DEFAULT_SETTINGS);
  expect((await req('/api/settings', { method: 'PUT', headers, body: { targetBand: 8, models: { analysis: 'anthropic/claude-sonnet-5' } } })).status).toBe(200);
  expect(await (await req('/api/settings', { headers })).json()).toEqual({ ...DEFAULT_SETTINGS, targetBand: 8 }); // models are no longer a setting
  expect((await req('/api/settings', { method: 'PUT', headers, body: { targetBand: 7.3 } })).status).toBe(400);
});
