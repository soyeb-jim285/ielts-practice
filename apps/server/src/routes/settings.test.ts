import { it, expect } from 'vitest';
import { req, testUser } from '../test/helpers';
import { DEFAULT_SETTINGS } from '../settings';

it('requires auth', async () => {
  expect((await req('/api/settings')).status).toBe(401);
});

it('returns defaults, applies partial updates, rejects bad model ids', async () => {
  const { headers } = await testUser();
  expect(await (await req('/api/settings', { headers })).json()).toEqual(DEFAULT_SETTINGS);

  const put = await req('/api/settings', { method: 'PUT', headers, body: { liveProvider: 'openai-realtime', models: { analysis: 'anthropic/claude-sonnet-5' } } });
  expect(put.status).toBe(200);
  const s = (await (await req('/api/settings', { headers })).json()) as any;
  expect(s.liveProvider).toBe('openai-realtime');
  expect(s.models).toEqual({ ...DEFAULT_SETTINGS.models, analysis: 'anthropic/claude-sonnet-5' });

  expect((await req('/api/settings', { method: 'PUT', headers, body: { models: { analysis: 'bad id!' } } })).status).toBe(400);
  expect((await req('/api/settings', { method: 'PUT', headers, body: { targetBand: 7.3 } })).status).toBe(400);
});
