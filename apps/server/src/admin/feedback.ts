import { createRoute, z } from '@hono/zod-openapi';
import { count, desc, eq, sql } from 'drizzle-orm';
import { requireOwner } from '../auth';
import { db } from '../db/client';
import { feedback } from '../db/schema';
import type { App } from '../types';
import { adminRoute, pageQuery } from './common';
import { FeedbackItem } from './schemas';

const Status = FeedbackItem.shape.status;
const Page = z.object({ items: z.array(FeedbackItem), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }).openapi('AdminFeedbackPage');
const toItem = (r: typeof feedback.$inferSelect): FeedbackItem => ({ ...r, createdAt: r.createdAt.toISOString() });

export function register(app: App) {
  app.openapi(
    createRoute({
      tags: adminRoute.tags,
      security: [{ bearer: [] }],
      middleware: [requireOwner] as const, // ponytail: spreading adminRoute fails to type check (its middleware is a readonly tuple, needs `as const` at the use site)
      method: 'get',
      path: '/api/admin/feedback',
      summary: 'Feedback inbox (new first, then newest)',
      request: { query: pageQuery.extend({ status: z.enum(['new', 'seen', 'done', 'all']).default('all') }) },
      responses: { 200: { description: 'Page', content: { 'application/json': { schema: Page } } } },
    }),
    async (c) => {
      const { page, pageSize, status } = c.req.valid('query');
      const where = status === 'all' ? undefined : eq(feedback.status, status);
      const [rows, [t]] = await Promise.all([
        db
          .select()
          .from(feedback)
          .where(where)
          .orderBy(sql`(${feedback.status} = 'new') desc`, desc(feedback.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ n: count() }).from(feedback).where(where),
      ]);
      return c.json({ items: rows.map(toItem), page, pageSize, total: t!.n }, 200);
    },
  );

  app.openapi(
    createRoute({
      tags: adminRoute.tags,
      security: [{ bearer: [] }],
      middleware: [requireOwner] as const, // ponytail: spreading adminRoute fails to type check (its middleware is a readonly tuple, needs `as const` at the use site)
      method: 'patch',
      path: '/api/admin/feedback/{id}',
      summary: 'Set a feedback item status',
      request: { params: z.object({ id: z.string() }), body: { required: true, content: { 'application/json': { schema: z.object({ status: Status }).openapi('AdminFeedbackPatch') } } } },
      responses: {
        200: { description: 'Updated', content: { 'application/json': { schema: FeedbackItem } } },
        404: { description: 'Unknown id' },
      },
    }),
    async (c) => {
      const [row] = await db.update(feedback).set({ status: c.req.valid('json').status }).where(eq(feedback.id, c.req.valid('param').id)).returning();
      return row ? c.json(toItem(row), 200) : c.json({ error: 'Not found' }, 404);
    },
  );
}
