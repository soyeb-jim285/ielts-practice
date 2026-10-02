import type { OpenAPIHono } from '@hono/zod-openapi';

export type SessionUser = { id: string; email: string; name: string; emailVerified: boolean; isAnonymous: boolean };
export type AppEnv = { Variables: { user: SessionUser | null; payer?: import('./quota').Payer } };
export type App = OpenAPIHono<AppEnv>;
