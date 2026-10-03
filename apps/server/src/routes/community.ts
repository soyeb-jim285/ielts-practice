import { createRoute, z } from '@hono/zod-openapi';
import { currentUser, requireAccount } from '../auth';
import { communityBalance } from '../community';
import { ApiError } from '../errors';
import { clientIpHash } from '../ip';
import { deleteKey, keysEnabled, listKeys, PROVIDERS, saveKey, validateKey } from '../keys';
import { payerOf, quotaSnapshot, type Payer } from '../quota';
import { aiLimit, keyCheckOk } from '../ratelimit';
import type { App } from '../types';

const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });

const Code = z.enum(['quota_exceeded', 'community_balance_exhausted', 'community_busy', 'too_many_requests', 'live_requires_own_key', 'account_required', 'cambridge_required', 'keys_unavailable', 'invalid_key', 'key_check_failed']);
export const CodedError = z
  .object({
    error: z.string().openapi({ description: 'Friendly, safe to show' }),
    code: Code,
    skill: z.enum(['speaking', 'writing']).optional().openapi({ description: 'quota_exceeded' }),
    resetAt: z.string().nullable().optional().openapi({ description: 'quota_exceeded: ISO time the window resets (00:00 UTC daily, Monday 00:00 UTC weekly)' }),
    tier: z.enum(['guest', 'community', 'own-key']).optional().openapi({ description: 'quota_exceeded, live_requires_own_key' }),
  })
  .openapi('CodedError', { description: 'Errors with a machine-readable code (docs/community.md). Map `code` to UX; `error` is a fallback.' });

export const BalanceSchema = z
  .object({
    limit: z.number().nullable().openapi({ description: 'USD spend limit of the shared OpenRouter key; null if it has none' }),
    used: z.number().nullable().openapi({ description: 'USD spent so far; null if unknown' }),
    remaining: z.number().nullable().openapi({ description: 'USD left; null if unknown or unlimited' }),
    updatedAt: z.string().openapi({ description: 'ISO time of the reading (cached up to 60 s)' }),
  })
  .openapi('CommunityBalance');

const SkillQuota = z
  .object({
    used: z.number().int(),
    limit: z.number().int().nullable().openapi({ description: 'Tests per window; null = unlimited' }),
    remaining: z.number().int().nullable(),
    resetAt: z.string().nullable().openapi({ description: 'ISO instant the window resets; show in local time. null when unlimited' }),
    window: z.enum(['day', 'week']).nullable().openapi({ description: 'day: resets 00:00 UTC; week: resets Monday 00:00 UTC' }),
    blocked: z.enum(['quota_exceeded', 'community_balance_exhausted', 'community_busy']).nullable().openapi({ description: 'Why a test cannot start now; null = it can' }),
  })
  .openapi('SkillQuota');

export const QuotaFields = {
  tier: z.enum(['guest', 'community', 'own-key']),
  speaking: SkillQuota,
  writing: SkillQuota,
  liveProviders: z.array(z.enum(['turn', 'gpt-live', 'gemini-live'])).openapi({ description: 'Live examiner providers this user may use (their own keys; the owner may use the server keys)' }),
  communityBalance: BalanceSchema,
};
const QuotaSchema = z.object(QuotaFields).openapi('Quota');

const Provider = z.enum(PROVIDERS);
const KeyInfo = z
  .object({ provider: Provider, last4: z.string(), addedAt: z.string(), valid: z.boolean().openapi({ description: 'false: the provider rejected this key; enter a new one' }) })
  .openapi('ApiKeyInfo', { description: 'The key itself is never returned.' });
const ProviderParam = z.object({ provider: Provider.openapi({ param: { name: 'provider', in: 'path' } }) });
const authed = { tags: ['Keys'], security: [{ bearer: [] }], middleware: [requireAccount] };
const open = { tags: ['Community'], security: [{ bearer: [] }, {}] as Record<string, string[]>[] }; // {} = also without a session

/** Payer for a request that may have no session yet: a guest by IP. */
export const requestPayer = (user: Parameters<typeof payerOf>[0] | null): Promise<Payer> => (user ? payerOf(user) : Promise.resolve({ userId: '', tier: 'guest', owner: false, keys: {} }));

export function register(app: App) {
  app.openapi(
    createRoute({
      ...open,
      method: 'get',
      path: '/api/community/balance',
      summary: 'Shared community balance (public, cached 60 s)',
      responses: { 200: json(BalanceSchema, 'Balance') },
    }),
    async (c) => c.json(await communityBalance(), 200),
  );

  app.openapi(
    createRoute({
      ...open,
      method: 'get',
      path: '/api/quota',
      summary: 'Tests left, reset times and live access for the caller. Works without a session (a guest, counted by IP). Call it when a test is about to start',
      responses: { 200: json(QuotaSchema, 'Quota') },
    }),
    async (c) => c.json(await quotaSnapshot(await requestPayer(c.get('user')), clientIpHash(c)), 200),
  );

  app.openapi(
    createRoute({
      ...authed,
      method: 'get',
      path: '/api/keys',
      summary: 'Your saved API keys (provider, last 4 characters, date, whether it still works)',
      responses: { 200: json(z.object({ keys: z.array(KeyInfo) }).openapi('ApiKeyList'), 'Keys'), 403: json(CodedError, 'Guests have no keys (account_required)') },
    }),
    async (c) => c.json({ keys: await listKeys(currentUser(c).id) }, 200),
  );

  app.openapi(
    createRoute({
      ...authed,
      middleware: [requireAccount, aiLimit],
      method: 'put',
      path: '/api/keys/{provider}',
      summary: 'Save (or replace) your own key for a provider. It is checked with a free live call first and stored encrypted',
      request: {
        params: ProviderParam,
        body: { required: true, content: { 'application/json': { schema: z.object({ key: z.string().trim().min(8).max(512).regex(/^[\x21-\x7E]+$/, 'A key has no spaces or unusual characters') }).openapi('PutApiKey') } } },
      },
      responses: {
        200: json(KeyInfo, 'Saved'),
        400: json(CodedError, 'invalid_key: the provider rejected it'),
        403: json(CodedError, 'account_required'),
        429: json(CodedError, 'Too many requests'),
        502: json(CodedError, 'key_check_failed: the provider could not be reached; try again'),
        503: json(CodedError, 'keys_unavailable: the server cannot store keys (KEY_ENCRYPTION_SECRET is not set)'),
      },
    }),
    async (c) => {
      const { provider } = c.req.valid('param');
      const { key } = c.req.valid('json');
      if (!keysEnabled()) throw new ApiError(503, { error: 'Saving your own key is not available on this server yet.', code: 'keys_unavailable' });
      const user = currentUser(c);
      if (!keyCheckOk(clientIpHash(c) ?? user.id)) throw new ApiError(429, { error: 'Too many key checks. Wait a minute, then try again.', code: 'too_many_requests' });
      const label = { openrouter: 'OpenRouter', openai: 'OpenAI', gemini: 'Gemini' }[provider];
      const verdict = await validateKey(provider, key);
      if (verdict === 'invalid') throw new ApiError(400, { error: `${label} did not accept this key. Check that you copied all of it.`, code: 'invalid_key' });
      if (verdict === 'unreachable') throw new ApiError(502, { error: `Could not reach ${label} to check the key. Please try again.`, code: 'key_check_failed' });
      await saveKey(user.id, provider, key);
      return c.json((await listKeys(user.id)).find((k) => k.provider === provider)!, 200);
    },
  );

  app.openapi(
    createRoute({
      ...authed,
      method: 'delete',
      path: '/api/keys/{provider}',
      summary: 'Remove your key for a provider',
      request: { params: ProviderParam },
      responses: { 200: json(z.object({ ok: z.boolean() }), 'Removed (also when there was none)'), 403: json(CodedError, 'account_required') },
    }),
    async (c) => {
      await deleteKey(currentUser(c).id, c.req.valid('param').provider);
      return c.json({ ok: true }, 200);
    },
  );
}
