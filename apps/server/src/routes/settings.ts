import { createRoute } from '@hono/zod-openapi';
import { currentUser, requireUser } from '../auth';
import { getSettings, SettingsPatchSchema, SettingsSchema, updateSettings } from '../settings';
import type { App } from '../types';

const Settings = SettingsSchema.openapi('Settings');
const ok = { 200: { description: 'Effective settings (user overrides merged over defaults)', content: { 'application/json': { schema: Settings } } } };

export function register(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/settings',
      tags: ['Settings'],
      summary: 'Get settings',
      security: [{ bearer: [] }],
      middleware: [requireUser] as const,
      responses: ok,
    }),
    async (c) => c.json(await getSettings(currentUser(c).id), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/settings',
      tags: ['Settings'],
      summary: 'Update settings (partial; models merge per key)',
      security: [{ bearer: [] }],
      middleware: [requireUser] as const,
      request: { body: { required: true, content: { 'application/json': { schema: SettingsPatchSchema.openapi('SettingsPatch') } } } },
      responses: ok,
    }),
    async (c) => c.json(await updateSettings(currentUser(c).id, c.req.valid('json')), 200),
  );
}
