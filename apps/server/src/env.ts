import { z } from 'zod';

const isTest = !!process.env.VITEST; // only the test runner gets dummy secrets
// In tests every secret gets a dummy default so the suite runs without a .env.
const secret = (dummy: string) => (isTest ? z.string().default(dummy) : z.string().min(1));

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  // Dev: extra allowed web origins, comma-separated (e.g. a second web dev server).
  EXTRA_ORIGINS: z.string().default('').transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  DATABASE_URL: z.string().default('postgres://postgres:ielts@localhost:5433/ielts'),
  BETTER_AUTH_SECRET: secret('test-secret-test-secret-test-secret'),
  BETTER_AUTH_URL: z.string().default('http://localhost:8787'),
  OPENROUTER_API_KEY: secret('test-openrouter'),
  // Optional: ElevenLabs Scribe v2 speech-to-text (spec §5.2). Unset: Whisper via OpenRouter is the default stt.
  ELEVENLABS_API_KEY: z.string().optional().transform((v) => v || undefined),
  // Optional: live examiner over OpenAI GPT-Live (sessions created server-side with this key) and Gemini Live (ephemeral tokens). Unset: that option is hidden.
  OPENAI_API_KEY: z.string().optional().transform((v) => v || undefined),
  OPENAI_LIVE_MODEL: z.string().default('gpt-live-1'), // $0.05/min, billed per second
  OPENAI_LIVE_VOICE: z.string().default('vesper'), // British, natural, masculine
  GEMINI_API_KEY: z.string().optional().transform((v) => v || undefined),
  GEMINI_LIVE_MODEL: z.string().default('gemini-3.8-live'),
  // Optional outside production: without them, dev falls back to local-disk storage (storage.ts).
  R2_ACCOUNT_ID: z.string().optional().transform((v) => v || undefined),
  R2_ACCESS_KEY_ID: z.string().optional().transform((v) => v || undefined),
  R2_SECRET_ACCESS_KEY: z.string().optional().transform((v) => v || undefined),
  LOCAL_STORAGE_DIR: z.string().default('../../data/local-storage'),
  R2_BUCKET: z.string().default('ielts-practice'),
  RESEND_API_KEY: z.string().optional().transform((v) => v || undefined),
  EMAIL_FROM: z.string().default('IELTS Practice <noreply@example.com>'),
  CAMBRIDGE_ALLOWED_EMAILS: z
    .string()
    .default('soyebjim@gmail.com')
    .transform((s) => s.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  WEB_DIST: z.string().default('../web/dist'),
  // Community mode (docs/community.md). Encrypts users' own API keys at rest (AES-256-GCM). Unset in production: saving keys is disabled (503) instead of using a weak default.
  KEY_ENCRYPTION_SECRET: z.string().optional().transform((v) => {
    if (v && v.length < 32 && !process.env.VITEST) console.warn('KEY_ENCRYPTION_SECRET is shorter than 32 characters: ignored, saving keys stays off (use `openssl rand -hex 32`)');
    return v && v.length >= 32 ? v : undefined; // HKDF does not stretch a weak secret
  }),
  // Community tests are blocked when the shared OpenRouter key has less than this many USD left.
  COMMUNITY_MIN_BALANCE: z.coerce.number().min(0).default(0.25),
  // Global cap on community-paid test submissions per rolling hour, across all users.
  COMMUNITY_MAX_PER_HOUR: z.coerce.number().int().min(1).default(60),
  // Guests: max tests per client IP per skill per week, across all anonymous users (each anonymous user is also capped at 1).
  GUEST_IP_WEEKLY_CAP: z.coerce.number().int().min(1).default(3),
  // Salt for hashing client IPs (never stored raw). Unset: derived from BETTER_AUTH_SECRET.
  IP_HASH_SALT: z.string().optional().transform((v) => v || undefined),
});

export const env = Env.parse(process.env);
export const R2_CONFIGURED = !!(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
if (env.NODE_ENV === 'production' && !R2_CONFIGURED) throw new Error('R2_* env vars are required in production');
export const IS_TEST = isTest;
