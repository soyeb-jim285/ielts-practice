import { createRoute, z } from '@hono/zod-openapi';
import { clientIpHash } from '../ip';
import { payerOf, quotaSnapshot, type Payer } from '../quota';
import type { App } from '../types';
import { lrCounts } from './lr';

const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });

const Code = z.enum(['quota_exceeded', 'community_balance_exhausted', 'community_busy', 'too_many_requests', 'account_required', 'cambridge_required']);
export const CodedError = z
  .object({
    error: z.string().openapi({ description: 'Friendly, safe to show' }),
    code: Code,
    skill: z.enum(['speaking', 'writing', 'examiner']).optional().openapi({ description: 'quota_exceeded' }),
    resetAt: z.string().nullable().optional().openapi({ description: 'quota_exceeded: ISO time the next test frees up' }),
    window: z.enum(['day', 'week', 'month']).nullable().optional().openapi({ description: 'quota_exceeded: the rolling window that is full' }),
    tier: z.enum(['guest', 'community', 'subscriber', 'unlimited']).optional().openapi({ description: 'quota_exceeded' }),
  })
  .openapi('CodedError', { description: 'Errors with a machine-readable code (docs/community.md). Map `code` to UX; `error` is a fallback.' });

export const BalanceSchema = z
  .object({
    limit: z.number().nullable().openapi({ description: 'USD spend limit of the shared OpenRouter key; null if it has none' }),
    used: z.number().nullable().openapi({ description: 'USD spent so far; null if unknown' }),
    remaining: z.number().nullable().openapi({ description: 'USD left; null if unknown or unlimited' }),
    updatedAt: z.string().openapi({ description: 'ISO time of the reading (cached up to 60 s)' }),
  })
  .openapi('CommunityBalance', { description: 'Admin only: the server OpenRouter key spend' });

const SkillQuota = z
  .object({
    used: z.number().int(),
    limit: z.number().int().nullable().openapi({ description: 'Tests per window; null = unlimited' }),
    remaining: z.number().int().nullable(),
    resetAt: z.string().nullable().openapi({ description: 'ISO instant the next test frees up (rolling window); show in local time. null when unlimited or nothing used yet' }),
    window: z.enum(['day', 'week', 'month']).nullable().openapi({ description: 'Rolling window the limit counts over: last 24 h, 7 days or 30 days' }),
    blocked: z.enum(['quota_exceeded', 'community_balance_exhausted', 'community_busy']).nullable().openapi({ description: 'Why a test cannot start now; null = it can' }),
  })
  .openapi('SkillQuota');

export const QuotaFields = {
  tier: z.enum(['guest', 'community', 'subscriber', 'unlimited']),
  subscribedUntil: z.string().nullable().openapi({ description: 'ISO end of the paid plan when on it (tier subscriber, or unlimited with a plan too); otherwise null' }),
  speaking: SkillQuota,
  writing: SkillQuota,
  examiner: SkillQuota.openapi({ description: 'Live examiner sessions (LiveKit)' }),
  live: z.boolean().openapi({ description: 'The LiveKit examiner is configured: live speaking tests are available (server keys, for everyone; limited by `examiner`)' }),
  lr: z.object({ listening: z.object({ open: z.number().int(), total: z.number().int() }), reading: z.object({ open: z.number().int(), total: z.number().int() }) }).openapi({ description: 'Listening and Reading tests the caller can open, of all a plan can open (no usage limit; the plan decides which)' }),
};
const QuotaSchema = z.object(QuotaFields).openapi('Quota');

const open = { tags: ['Community'], security: [{ bearer: [] }, {}] as Record<string, string[]>[] }; // {} = also without a session

/** Payer for a request that may have no session yet: a guest by IP. */
export const requestPayer = (user: Parameters<typeof payerOf>[0] | null): Promise<Payer> => (user ? payerOf(user) : Promise.resolve({ userId: '', tier: 'guest', owner: false }));

export function register(app: App) {
  app.openapi(
    createRoute({
      ...open,
      method: 'get',
      path: '/api/quota',
      summary: 'Tests left, reset times and live access for the caller. Works without a session (a guest, counted by IP). Call it when a test is about to start',
      responses: { 200: json(QuotaSchema, 'Quota') },
    }),
    async (c) => c.json({ ...(await quotaSnapshot(await requestPayer(c.get('user')), clientIpHash(c))), lr: await lrCounts(c.get('user')) }, 200),
  );
}
