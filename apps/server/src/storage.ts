import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

export type Storage = {
  presignPut(key: string, contentType: string, expiresS?: number): Promise<string>;
  presignGet(key: string, expiresS?: number): Promise<string>;
  exists(key: string): Promise<boolean>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
};

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});
const Bucket = env.R2_BUCKET;

const r2: Storage = {
  presignPut: (key, contentType, expiresS = 900) =>
    getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), { expiresIn: expiresS }),
  presignGet: (key, expiresS = 3600) => getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: expiresS }),
  async exists(key) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  },
  async put(key, body, contentType) {
    await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
  },
  async get(key) {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
    return new Uint8Array(await r.Body!.transformToByteArray());
  },
};

/** In-memory storage for tests. */
export function memoryStorage(): Storage & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    presignPut: async (key) => `https://upload.test/${key}`,
    presignGet: async (key) => `https://download.test/${key}`,
    exists: async (key) => objects.has(key),
    put: async (key, body, contentType) => void objects.set(key, { body, contentType }),
    get: async (key) => {
      const o = objects.get(key);
      if (!o) throw new Error(`missing object ${key}`);
      return o.body;
    },
  };
}

export let storage: Storage = r2;
export function setStorage(s: Storage) {
  storage = s;
}
