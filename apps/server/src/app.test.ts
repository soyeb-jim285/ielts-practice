import { it, expect } from 'vitest';
import { app, req, seedPrompt, testUser } from './test/helpers';

it('health and openapi', async () => {
  expect((await req('/api/health')).status).toBe(200);
  const spec = (await (await req('/openapi.json')).json()) as any;
  expect(spec.openapi).toMatch(/^3\./);
  expect(spec.paths['/api/health']).toBeDefined();
});

it('bearer signup works', async () => {
  const { user } = await testUser();
  expect(user.id).toBeTruthy();
});

it('dev local-disk storage: presigned URLs point back at the host the client used (not a LAN IP), and the upload round-trips there', async () => {
  const { localDisk, setStorage, storage: memory } = await import('./storage');
  setStorage(localDisk);
  try {
    const { headers } = await testUser();
    const p = await seedPrompt();
    // A browser on localhost:5173 (the Vite proxy forwards Host as-is).
    const res = await app.request('http://localhost:5173/api/attempts', { method: 'POST', headers, body: JSON.stringify({ promptId: p.id, skill: 'speaking', part: 1, audioContentType: 'audio/webm' }) });
    const { uploadUrl, audioKey } = (await res.json()) as { uploadUrl: string; audioKey: string };
    expect(uploadUrl).toMatch(/^http:\/\/localhost:5173\/api\/local-storage\/audio\//);
    const put = (url: string) => app.request(url, { method: 'PUT', body: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'audio/webm' } });
    expect((await put(uploadUrl.replace(/sig=\w+/, 'sig=bad'))).status).toBe(403);
    expect((await put(uploadUrl)).status).toBe(200);
    expect(await localDisk.size(audioKey)).toBe(3);
    // another host (a phone on the LAN) gets its own origin
    const lan = await app.request('http://192.168.1.20:8787/api/attempts', { method: 'POST', headers, body: JSON.stringify({ promptId: p.id, skill: 'speaking', part: 1 }) });
    expect(((await lan.json()) as { uploadUrl: string }).uploadUrl).toMatch(/^http:\/\/192\.168\.1\.20:8787\/api\/local-storage\//);
    await localDisk.deletePrefix(audioKey);
  } finally {
    setStorage(memory);
  }
});
