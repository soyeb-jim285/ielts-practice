import type { OpenAPIHono } from '@hono/zod-openapi';

export type SessionUser = { id: string; email: string; name: string };
export type AppEnv = { Variables: { user: SessionUser | null } };
export type App = OpenAPIHono<AppEnv>;
