import { createRoute, z } from '@hono/zod-openapi';
import { currentUser, isCambridgeAllowed, requireUser } from '../auth';
import { clientIpHash } from '../ip';
import { liveKey, payerOf, quotaSnapshot } from '../quota';
import { QuotaFields } from './community';
import { getSettings, SettingsSchema } from '../settings';
import type { App } from '../types';

const MeSchema = z
  .object({
    user: z.object({
      id: z.string(),
      email: z.string().openapi({ description: 'Empty for a guest' }),
      name: z.string(),
      emailVerified: z.boolean(),
      isAnonymous: z.boolean().openapi({ description: 'A guest (anonymous session, no account yet): show "Create an account", hide keys, history and review' }),
    }),
    settings: SettingsSchema,
    cambridgeAccess: z.boolean(),
    gptLiveAvailable: z.boolean().openapi({ description: 'This user has an OpenAI key (or is the owner)' }),
    realtimeAvailable: z.boolean().openapi({ deprecated: true, description: 'Deprecated alias of gptLiveAvailable (app versions from before GPT-Live)' }),
    geminiLiveAvailable: z.boolean().openapi({ description: 'This user has a Gemini key (or is the owner)' }),
    ...QuotaFields,
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
      const payer = await payerOf(user);
      const gpt = !!liveKey(payer, 'openai');
      return c.json(
        {
          user: { ...user, email: user.isAnonymous ? '' : user.email },
          settings: await getSettings(user.id),
          cambridgeAccess: isCambridgeAllowed(user),
          gptLiveAvailable: gpt,
          realtimeAvailable: gpt,
          geminiLiveAvailable: !!liveKey(payer, 'gemini'),
          ...(await quotaSnapshot(payer, clientIpHash(c))),
        },
        200,
      );
    },
  );
}
