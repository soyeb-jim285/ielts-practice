import { createRoute, z } from '@hono/zod-openapi';
import { desc, eq } from 'drizzle-orm';
import { requireOwner } from '../auth';
import { db } from '../db/client';
import { coachFeedback, coachReports, user } from '../db/schema';
import type { App } from '../types';
import { adminRoute } from './common';

const Item = z.object({ id: z.string(), email: z.string(), itemKey: z.string(), note: z.string(), day: z.string(), createdAt: z.string() }).openapi('AdminCoachFeedback');

export function register(app: App) {
  app.openapi(
    createRoute({
      tags: adminRoute.tags,
      security: [{ bearer: [] }],
      middleware: [requireOwner] as const, // ponytail: see admin/feedback.ts
      method: 'get',
      path: '/api/admin/coach-feedback',
      summary: 'Latest 100 coach feedback notes',
      responses: { 200: { description: 'Items', content: { 'application/json': { schema: z.array(Item) } } } },
    }),
    async (c) => {
      const rows = await db
        .select({ id: coachFeedback.id, email: user.email, itemKey: coachFeedback.itemKey, note: coachFeedback.note, day: coachReports.day, createdAt: coachFeedback.createdAt })
        .from(coachFeedback)
        .innerJoin(user, eq(user.id, coachFeedback.userId))
        .innerJoin(coachReports, eq(coachReports.id, coachFeedback.reportId))
        .orderBy(desc(coachFeedback.createdAt))
        .limit(100);
      return c.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), 200);
    },
  );
}
