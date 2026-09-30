import { z } from 'zod';

const isTest = !!process.env.VITEST; // only the test runner gets dummy secrets
// In tests every secret gets a dummy default so the suite runs without a .env.
const secret = (dummy: string) => (isTest ? z.string().default(dummy) : z.string().min(1));

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgres://postgres:ielts@localhost:5433/ielts'),
  BETTER_AUTH_SECRET: secret('test-secret-test-secret-test-secret'),
  BETTER_AUTH_URL: z.string().default('http://localhost:8787'),
  OPENROUTER_API_KEY: secret('test-openrouter'),
  OPENAI_API_KEY: z.string().optional().transform((v) => v || undefined),
  R2_ACCOUNT_ID: secret('test'),
  R2_ACCESS_KEY_ID: secret('test'),
  R2_SECRET_ACCESS_KEY: secret('test'),
  R2_BUCKET: z.string().default('ielts-practice'),
  RESEND_API_KEY: z.string().optional().transform((v) => v || undefined),
  EMAIL_FROM: z.string().default('IELTS Practice <noreply@example.com>'),
  CAMBRIDGE_ALLOWED_EMAILS: z
    .string()
    .default('soyebjim@gmail.com')
    .transform((s) => s.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  WEB_DIST: z.string().default('../web/dist'),
});

export const env = Env.parse(process.env);
export const IS_TEST = isTest;
