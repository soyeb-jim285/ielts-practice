import { afterEach, expect, it } from 'vitest';
import { env } from './env';
import { localDisk, resignUrls, setStorage, storage } from './storage';

const prev = storage;
afterEach(() => setStorage(prev));

it('resignUrls: our signed R2 and dev-disk URLs in stored text get fresh signatures, other URLs stay', async () => {
  setStorage({ ...localDisk, presignGet: async (key) => `https://fresh.test/${key}` });
  const r2 = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/lr/lr/gen/a-p1.mp3?X-Amz-Algorithm=AWS4&X-Amz-Expires=21600&X-Amz-Signature=abc123`;
  const vhost = `https://${env.R2_BUCKET}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/lr/b.mp3?X-Amz-Signature=def456&X-Amz-Date=1`;
  const local = 'http://localhost:5173/api/local-storage/lr/c.mp3?exp=1&sig=0a1b';
  const other = 'https://example.com/x.mp3?X-Amz-Signature=999';
  const text = JSON.stringify([{ attributes: { src: r2 } }, { src: vhost }, { src: local }, { src: other }, { src: r2 }]);
  expect(JSON.parse(await resignUrls(text)).map((e: { src?: string; attributes?: { src: string } }) => e.src ?? e.attributes!.src)).toEqual([
    'https://fresh.test/lr/lr/gen/a-p1.mp3', 'https://fresh.test/lr/b.mp3', 'https://fresh.test/lr/c.mp3', other, 'https://fresh.test/lr/lr/gen/a-p1.mp3',
  ]);
  expect(await resignUrls('{"no":"urls"}')).toBe('{"no":"urls"}');
});

it('resignUrls: never signs a key outside lr/ (recordings are user data), and stays fast on crafted input', async () => {
  setStorage({ ...localDisk, presignGet: async (key) => `https://fresh.test/${key}` });
  const planted = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/speaking/u1/a.webm?X-Amz-Signature=abc`;
  const escape = 'http://localhost:5173/api/local-storage/lr/../speaking/a.webm?exp=1&sig=0a';
  const text = JSON.stringify({ a: planted, b: escape });
  expect(await resignUrls(text)).toBe(text);
  const t0 = performance.now();
  await resignUrls(`"${'https://a'.repeat(200_000)}"`); // 1.8 MB with no "?": quadratic with a backtracking pattern
  await resignUrls(`"https://x/?${'sig=0a&'.repeat(300_000)}"`); // 2 MB of signature markers
  expect(performance.now() - t0).toBeLessThan(500);
});
