import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env, R2_CONFIGURED } from './env';

export type Storage = {
  presignPut(key: string, contentType: string, expiresS?: number): Promise<string>;
  presignGet(key: string, expiresS?: number): Promise<string>;
  /** Object size in bytes, null when it does not exist. */
  size(key: string): Promise<number | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  deletePrefix(prefix: string): Promise<void>;
};

/** 25 MB: the Whisper input cap, far above a 2-3 min Opus recording. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Why an uploaded recording can't be analysed, or null when it is fine. Guards memory and paid STT from huge uploads. */
export async function uploadError(key: string): Promise<string | null> {
  const n = await storage.size(key);
  return n == null ? 'Upload missing' : n > MAX_AUDIO_BYTES ? 'Recording too large (max 25 MB)' : null;
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID ?? '', secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '' },
});
const Bucket = env.R2_BUCKET;

const r2: Storage = {
  presignPut: (key, contentType, expiresS = 900) =>
    getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), { expiresIn: expiresS }),
  presignGet: (key, expiresS = 3600) => getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: expiresS }),
  async size(key) {
    try {
      return (await s3.send(new HeadObjectCommand({ Bucket, Key: key }))).ContentLength ?? null;
    } catch {
      return null;
    }
  },
  async put(key, body, contentType) {
    await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
  },
  async get(key) {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
    return new Uint8Array(await r.Body!.transformToByteArray());
  },
  async deletePrefix(prefix) {
    for (let token: string | undefined; ; ) {
      const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
      if (r.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: r.Contents.map((o) => ({ Key: o.Key! })) } }));
      if (!(token = r.NextContinuationToken)) return;
    }
  },
};

/** In-memory storage for tests. */
export function memoryStorage(): Storage & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    presignPut: async (key) => `https://upload.test/${key}`,
    presignGet: async (key) => `https://download.test/${key}`,
    size: async (key) => objects.get(key)?.body.length ?? null,
    put: async (key, body, contentType) => void objects.set(key, { body, contentType }),
    get: async (key) => {
      const o = objects.get(key);
      if (!o) throw new Error(`missing object ${key}`);
      return o.body;
    },
    deletePrefix: async (prefix) => {
      for (const k of objects.keys()) if (k.startsWith(prefix)) objects.delete(k);
    },
  };
}

// ---------- dev fallback: local disk + HMAC-signed URLs served by /local-storage/* (see registerLocalStorage) ----------
const ROOT_DIR = resolve(env.LOCAL_STORAGE_DIR);
const pathFor = (key: string) => {
  const p = resolve(ROOT_DIR, key);
  if (!p.startsWith(ROOT_DIR + '/')) throw new Error('bad key');
  return p;
};
export const signLocal = (method: 'GET' | 'PUT', key: string, exp: number) =>
  createHmac('sha256', env.BETTER_AUTH_SECRET).update(`${method}:${key}:${exp}`).digest('hex');
export function verifyLocal(method: 'GET' | 'PUT', key: string, exp: number, sig: string) {
  if (!(exp > Date.now() / 1000)) return false;
  const a = Buffer.from(signLocal(method, key, exp)), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Origin of the request being served (app.ts sets it): dev presigned URLs point back at the host the client used, not a detected LAN IP
 *  or a configured BETTER_AUTH_URL that the client may not reach. Under the Vite proxy that is the web origin, hence the /api prefix it proxies. */
export const requestOrigin = new AsyncLocalStorage<string>();
const localUrl = (method: 'GET' | 'PUT', key: string, expiresS: number) => {
  const exp = Math.floor(Date.now() / 1000) + expiresS;
  return `${requestOrigin.getStore() ?? env.BETTER_AUTH_URL}/api/local-storage/${key}?exp=${exp}&sig=${signLocal(method, key, exp)}`;
};
export const localDisk: Storage = {
  presignPut: async (key, _ct, expiresS = 900) => localUrl('PUT', key, expiresS),
  presignGet: async (key, expiresS = 3600) => localUrl('GET', key, expiresS),
  size: async (key) => stat(pathFor(key)).then((s) => s.size, () => null),
  async put(key, body) {
    await mkdir(dirname(pathFor(key)), { recursive: true });
    await writeFile(pathFor(key), body);
  },
  get: async (key) => new Uint8Array(await readFile(pathFor(key))),
  deletePrefix: async (prefix) => rm(pathFor(prefix.replace(/\/$/, '')), { recursive: true, force: true }),
};
export const localPath = pathFor;

export let storage: Storage = R2_CONFIGURED ? r2 : localDisk;
export function setStorage(s: Storage) {
  storage = s;
}

const STOP = new Set(['"', "'", '\\', ' ', '\n', '\t', '\r']);
/** URL-shaped runs around each signature parameter. Linear: no regex backtracking, and no character is scanned twice
 *  (recordings are user-uploaded text, so the input can be crafted). The signature itself is checked by signedKey. */
function signedUrls(text: string): Set<string> {
  const found = new Set<string>();
  for (const marker of ['X-Amz-Signature=', 'sig=']) {
    for (let i = text.indexOf(marker), done = 0; i !== -1 && found.size < 50; i = text.indexOf(marker, Math.max(i + 1, done))) {
      let start = i, end = i;
      while (start > done && i - start < 2048 && !STOP.has(text[start - 1]!)) start--;
      while (end < text.length && end - i < 4096 && !STOP.has(text[end]!)) end++;
      const url = text.slice(start, end);
      if (/^https?:\/\//.test(url)) found.add(url);
      done = end;
    }
  }
  return found;
}
/** Storage key behind one of our signed GET URLs (R2 path or virtual-host style, or the dev disk), null for any other URL.
 *  Only listening/reading assets (lr/): a recording is user data, so a planted URL must not get any other object signed. */
function signedKey(raw: string): string | null {
  try {
    const u = new URL(raw), path = decodeURIComponent(u.pathname.slice(1)), host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const key = u.searchParams.has('sig')
      ? path.startsWith('api/local-storage/') ? path.slice('api/local-storage/'.length) : null
      : !u.searchParams.has('X-Amz-Signature') ? null
      : u.hostname === host ? (path.startsWith(`${Bucket}/`) ? path.slice(Bucket.length + 1) : null)
      : u.hostname === `${Bucket}.${host}` ? path : null;
    return key?.startsWith('lr/') && !key.includes('..') ? key : null;
  } catch {
    return null;
  }
}

/** Our signed URLs inside stored text (a replay's <audio src>) signed afresh: they expire (listening audio after 6 h) and an old replay would play silence. */
export async function resignUrls(text: string, expiresS = 12 * 3600): Promise<string> {
  for (const url of signedUrls(text)) {
    const key = signedKey(url);
    if (key) text = text.split(url).join(await storage.presignGet(key, expiresS));
  }
  return text;
}
