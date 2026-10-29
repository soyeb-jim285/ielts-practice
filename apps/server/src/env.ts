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
  // Optional: the LiveKit worker's ElevenLabs STT/TTS options and the admin Costs balance. Speaking STT (Scribe) goes through OpenRouter.
  ELEVENLABS_API_KEY: z.string().optional().transform((v) => v || undefined),
  // Soniox real-time STT and TTS for the LiveKit examiner (worker). Unset: live tests are unavailable.
  SONIOX_API_KEY: z.string().optional().transform((v) => v || undefined),
  CARTESIA_API_KEY: z.string().optional().transform((v) => v || undefined),
  INWORLD_API_KEY: z.string().optional().transform((v) => v || undefined),
  GRADIUM_API_KEY: z.string().optional().transform((v) => v || undefined),
  ELEVENLABS_USD_PER_M_CHARS: z.string().optional(),
  CARTESIA_USD_PER_M_CHARS: z.string().optional(),
  INWORLD_USD_PER_M_CHARS: z.string().optional(),
  GRADIUM_USD_PER_M_CHARS: z.string().optional(),
  LIVEKIT_URL: z.preprocess((v) => v || undefined, z.url().refine((v) => /^wss?:\/\//.test(v), 'Use a ws:// or wss:// LiveKit URL').optional()),
  LIVEKIT_API_KEY: z.string().optional().transform((v) => v || undefined),
  LIVEKIT_API_SECRET: z.string().optional().transform((v) => v || undefined),
  LIVEKIT_AGENT_NAME: z.string().min(1).max(128).default('ielts-examiner'),
  LIVEKIT_REPORT_SECRET: z.preprocess((v) => v || undefined, z.string().min(32).optional()),
  // Optional: Hugging Face token for the CrisperWhisper Spaces in the admin playground (ai/hfspace.ts); raises the ZeroGPU quota. Unset: anonymous quota.
  HF_TOKEN: z.string().optional().transform((v) => v || undefined),
  // Optional: our verbatim Whisper on Modal for the admin playground (ai/modal.ts). A Modal proxy-auth token; unset: that model returns an error.
  MODAL_KEY: z.string().optional().transform((v) => v || undefined),
  MODAL_SECRET: z.string().optional().transform((v) => v || undefined),
  MODAL_ASR_URL: z.string().default('https://soyeb-jim--verbatim-asr-asr-web.modal.run'),
  MODAL_PRON_URL: z.string().default('https://soyeb-jim--pronunciation-pron-web.us-east.modal.run'), // modal/pronunciation (wav2vec2 phoneme GOP), same proxy-auth token
  MODAL_USD_PER_HOUR: z.coerce.number().min(0).default(0.59), // T4 list price; playground cost = wall time x this (estimate)
  // Optional outside production: without them, dev falls back to local-disk storage (storage.ts).
  R2_ACCOUNT_ID: z.string().optional().transform((v) => v || undefined),
  R2_ACCESS_KEY_ID: z.string().optional().transform((v) => v || undefined),
  R2_SECRET_ACCESS_KEY: z.string().optional().transform((v) => v || undefined),
  LOCAL_STORAGE_DIR: z.string().default('../../data/local-storage'),
  R2_BUCKET: z.string().default('ielts-practice'),
  RESEND_API_KEY: z.string().optional().transform((v) => v || undefined),
  EMAIL_FROM: z.string().default('NextBand <noreply@example.com>'),
  CAMBRIDGE_ALLOWED_EMAILS: z
    .string()
    .default('soyebjim@gmail.com')
    .transform((s) => s.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  WEB_DIST: z.string().default('../web/dist'),
  // Community tests are blocked when the shared OpenRouter key has less than this many USD left.
  COMMUNITY_MIN_BALANCE: z.coerce.number().min(0).default(0.25),
  // Global cap on community-paid test submissions per rolling hour, across all users.
  COMMUNITY_MAX_PER_HOUR: z.coerce.number().int().min(1).default(60),
  // Guests per client IP: across all anonymous users an IP may use this many times one guest's allowance, per skill and window.
  GUESTS_PER_IP: z.coerce.number().int().min(1).default(3),
  // Salt for hashing client IPs (never stored raw). Unset: derived from BETTER_AUTH_SECRET.
  IP_HASH_SALT: z.string().optional().transform((v) => v || undefined),
  // PayStation hosted checkout (routes/pay.ts). Unset: checkout answers 503 "payments open soon". Sandbox URL until the live account is approved.
  PAYSTATION_MERCHANT_ID: z.string().optional().transform((v) => v || undefined),
  PAYSTATION_PASSWORD: z.string().optional().transform((v) => v || undefined),
  PAYSTATION_URL: z.string().default('https://sandbox.paystation.com.bd'), // live: https://api.paystation.com.bd
});

export const env = Env.parse(process.env);
export const R2_CONFIGURED = !!(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
if (env.NODE_ENV === 'production' && !R2_CONFIGURED) throw new Error('R2_* env vars are required in production');
export const IS_TEST = isTest;
