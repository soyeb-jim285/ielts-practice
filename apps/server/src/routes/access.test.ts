import { describe, expect, it } from 'vitest';
import { req, seedPrompt, testUser } from '../test/helpers';

// Guests may browse; everything personal or that spends credit needs a session.
const PUBLIC = ['/api/health', '/api/prompts', '/api/prompts/meta', '/api/prompts/random?skill=speaking', '/api/prompts/nope'];
const PROTECTED: [string, string][] = [
  ['GET', '/api/me'],
  ['GET', '/api/settings'],
  ['PUT', '/api/settings'],
  ['GET', '/api/models'],
  ['GET', '/api/attempts'],
  ['POST', '/api/attempts'],
  ['GET', '/api/attempts/x'],
  ['DELETE', '/api/attempts/x'],
  ['POST', '/api/attempts/x/submit'],
  ['GET', '/api/progress'],
  ['GET', '/api/mistakes'],
  ['GET', '/api/cards/due'],
  ['POST', '/api/cards'],
  ['GET', '/api/speaking/test'],
  ['POST', '/api/live/start'],
  ['POST', '/api/live/turn'],
  ['POST', '/api/live/gpt-live/session'],
  ['POST', '/api/live/gpt-live/cue'],
  ['POST', '/api/live/finish'],
];

describe('public / protected matrix', () => {
  it('serves the browse endpoints to guests', async () => {
    await seedPrompt();
    for (const path of PUBLIC) expect((await req(path)).status, path).not.toBe(401);
  });

  it('rejects guests (no token, bad token) on every personal endpoint', async () => {
    for (const [method, path] of PROTECTED) {
      expect((await req(path, { method })).status, `${method} ${path}`).toBe(401);
      const bad = new Headers({ Authorization: 'Bearer nope', 'Content-Type': 'application/json' });
      expect((await req(path, { method, headers: bad })).status, `${method} ${path} bad token`).toBe(401);
    }
  });

  it('lets a signed-in user through', async () => {
    const { headers } = await testUser();
    for (const path of ['/api/me', '/api/settings', '/api/attempts', '/api/progress']) expect((await req(path, { headers })).status, path).toBe(200);
  });
});
