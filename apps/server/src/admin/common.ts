import { z } from '@hono/zod-openapi';
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { requireOwner } from '../auth';

/** Spread into createRoute() of every admin endpoint: owner only, 404 for everyone else. */
export const adminRoute = { tags: ['Admin'], security: [{ bearer: [] }], middleware: [requireOwner] as const };

export const DHAKA = 'Asia/Dhaka';
export const dhakaDay = (col: SQL | AnyColumn) => sql<string>`to_char(${col} at time zone 'Asia/Dhaka', 'YYYY-MM-DD')`;
export const dhakaTodayStart = sql`(date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka')`; // timestamptz
/** Start of the Dhaka day n days ago. */
export const daysAgo = (n: number) => sql`(${dhakaTodayStart} - ${n} * interval '1 day')`;
/** (user_id, at) rows of anything a person did: attempts, L/R attempts, replay sessions. Use as a subquery: `sql`${ACTIVITY} a``. */
export const ACTIVITY = sql`(select user_id, created_at as at from attempts union all select user_id, started_at from lr_attempts union all select user_id, last_at from replay_sessions where user_id is not null)`;

export const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export const Paged = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() });
export const guestLabel = (u: { id: string; email: string; isAnonymous: boolean | null }) => (u.isAnonymous ? `Guest ${u.id.slice(0, 6)}` : u.email);
