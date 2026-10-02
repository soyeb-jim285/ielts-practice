// Users' own provider keys (docs/community.md): AES-256-GCM at rest, never returned, never logged.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { httpFetch } from './ai/openrouter';
import { db } from './db/client';
import { userApiKeys } from './db/schema';
import { env } from './env';

export const PROVIDERS = ['openrouter', 'openai', 'gemini'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type Keys = Partial<Record<Provider, string>>;

/** Saving keys needs a dedicated secret in production; elsewhere it falls back to one derived from BETTER_AUTH_SECRET so dev and tests work. */
export const keysEnabled = () => env.NODE_ENV !== 'production' || !!env.KEY_ENCRYPTION_SECRET;
const aesKey = () => Buffer.from(hkdfSync('sha256', env.KEY_ENCRYPTION_SECRET ?? env.BETTER_AUTH_SECRET, 'ielts-user-keys', 'aes-256-gcm', 32));

/** AES-256-GCM with a random 96-bit IV per row; the user and provider are authenticated data, so a row copied to another user will not decrypt. */
export function encryptKey(plain: string, userId: string, provider: Provider) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', aesKey(), iv);
  c.setAAD(Buffer.from(`${userId}:${provider}`));
  const ciphertext = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64') };
}

export function decryptKey(row: { ciphertext: string; iv: string }, userId: string, provider: Provider): string {
  const raw = Buffer.from(row.ciphertext, 'base64');
  const d = createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(row.iv, 'base64'));
  d.setAAD(Buffer.from(`${userId}:${provider}`));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8');
}

/** The user's working keys, decrypted. Keys the provider rejected (valid = false) and rows that no longer decrypt (secret rotated) are left out. */
export async function getUserKeys(userId: string): Promise<Keys> {
  const rows = await db.select().from(userApiKeys).where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.valid, true)));
  const out: Keys = {};
  for (const r of rows) {
    try {
      out[r.provider] = decryptKey(r, userId, r.provider);
    } catch {
      console.error('user key could not be decrypted', r.provider); // no key material in the message
    }
  }
  return out;
}

export async function listKeys(userId: string) {
  const rows = await db.select().from(userApiKeys).where(eq(userApiKeys.userId, userId));
  return rows
    .sort((a, b) => PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider))
    .map((r) => ({ provider: r.provider, last4: r.last4, addedAt: r.createdAt.toISOString(), valid: r.valid }));
}

export async function saveKey(userId: string, provider: Provider, key: string) {
  const row = { userId, provider, ...encryptKey(key, userId, provider), last4: key.slice(-4), valid: true };
  await db.insert(userApiKeys).values(row).onConflictDoUpdate({ target: [userApiKeys.userId, userApiKeys.provider], set: { ...row, createdAt: new Date() } });
}

export const deleteKey = (userId: string, provider: Provider) => db.delete(userApiKeys).where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider)));

/** The provider answered 401/403 for this key: flag it so the UI asks for a new one and the user falls back to the community tier. */
export const markKeyInvalid = (userId: string, provider: Provider) =>
  db.update(userApiKeys).set({ valid: false }).where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider))).then(
    () => undefined,
    (e) => console.error('could not flag key invalid', provider, (e as Error).message),
  );

const CHECK: Record<Provider, { url: string; headers: (k: string) => Record<string, string> }> = {
  openrouter: { url: 'https://openrouter.ai/api/v1/key', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  openai: { url: 'https://api.openai.com/v1/models', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', headers: (k) => ({ 'x-goog-api-key': k }) }, // header, not ?key=, so it never lands in a URL log
};

/** Cheap live check before saving: a key-listing call that costs nothing. 'unreachable' = the provider did not answer (not the user's fault). */
export async function validateKey(provider: Provider, key: string): Promise<'valid' | 'invalid' | 'unreachable'> {
  const c = CHECK[provider];
  try {
    const res = await httpFetch(c.url, { headers: c.headers(key), signal: AbortSignal.timeout(10_000) });
    if (res.ok) return 'valid';
    return res.status === 400 || res.status === 401 || res.status === 403 ? 'invalid' : 'unreachable'; // Gemini answers 400 "API key not valid"
  } catch {
    return 'unreachable';
  }
}
