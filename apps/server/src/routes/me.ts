import { createRoute, z } from '@hono/zod-openapi';
import { currentUser, isCambridgeAllowed, requireUser } from '../auth';
import { env } from '../env';
import { getSettings, SettingsSchema } from '../settings';
import type { App } from '../types';

const MeSchema = z
  .object({
    user: z.object({ id: z.string(), email: z.string(), name: z.string(), emailVerified: z.boolean() }),
    settings: SettingsSchema,
    cambridgeAccess: z.boolean(),
    realtimeAvailable: z.boolean(),
    geminiLiveAvailable: z.boolean(),
  })
  .openapi('Me');

export function register(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/me',
      tags: ['Account'],
      summary: 'Current user, settings and feature access',
      security: [{ bearer: [] }],
      middleware: [requireUser] as const,
      responses: { 200: { description: 'Current user', content: { 'application/json': { schema: MeSchema } } } },
    }),
    async (c) => {
      const user = currentUser(c);
      return c.json(
        {
          user,
          settings: await getSettings(user.id),
          cambridgeAccess: isCambridgeAllowed(user),
          realtimeAvailable: !!env.OPENAI_API_KEY,
          geminiLiveAvailable: !!env.GEMINI_API_KEY,
        },
        200,
      );
    },
  );
}
