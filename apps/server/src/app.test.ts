import { it, expect } from 'vitest';
import { req, testUser } from './test/helpers';

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
