import { createRoute, z } from '@hono/zod-openapi';
import { db } from '../db/client';
import { feedback } from '../db/schema';
import { ApiError } from '../errors';
import { clientIpHash } from '../ip';
import { feedbackOk } from '../ratelimit';
import type { App } from '../types';

const Body = z
  .object({ message: z.string().trim().min(1).max(2000), page: z.string().min(1).max(300), replaySessionId: z.string().uuid().optional() })
  .openapi('FeedbackBody');

export function register(app: App) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/feedback',
      tags: ['Feedback'],
      summary: 'Report a problem (session optional)',
      request: { body: { required: true, content: { 'application/json': { schema: Body } } } },
      responses: { 201: { description: 'Saved', content: { 'application/json': { schema: z.object({ id: z.string() }).openapi('FeedbackCreated') } } } },
    }),
    async (c) => {
      if (!feedbackOk(clientIpHash(c) ?? 'unknown')) throw new ApiError(429, { error: 'Too many requests, slow down.', code: 'too_many_requests' });
      const b = c.req.valid('json');
      const u = c.get('user'); // ponytail: no requireUser, a visitor who cannot sign up can still report
      const [row] = await db
        .insert(feedback)
        .values({
          userId: u?.id ?? null,
          email: u && !u.isAnonymous ? u.email : null,
          message: b.message,
          page: b.page,
          replaySessionId: b.replaySessionId ?? null,
          userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null,
        })
        .returning({ id: feedback.id });
      return c.json({ id: row!.id }, 201);
    },
  );
}
