import { describe, expect, it } from 'vitest';
import { webLink } from './auth';

const api = 'http://192.168.0.105:8787/api/auth/verify-email?token=t&callbackURL=%2F';
describe('webLink', () => {
  it('points email links at the web origin, not the API host, with an absolute callbackURL', () => {
    const u = new URL(webLink(api));
    expect(u.origin).toBe('http://localhost:5173');
    expect(u.pathname).toBe('/api/auth/verify-email');
    expect(u.searchParams.get('callbackURL')).toBe('http://localhost:5173/');
  });
  it('uses the request Origin when it is trusted and ignores unknown ones', () => {
    const req = (origin: string) => new Request('http://x', { headers: { origin } });
    expect(new URL(webLink(api, req('http://localhost:5173'))).origin).toBe('http://localhost:5173');
    expect(new URL(webLink(api, req('https://evil.example'))).origin).toBe('http://localhost:5173');
  });
});
