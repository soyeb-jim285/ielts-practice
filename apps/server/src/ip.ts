import { getConnInfo } from '@hono/node-server/conninfo';
import { createHmac } from 'node:crypto';
import type { Context } from 'hono';
import { env } from './env';

/** Client address behind the Cloudflare Tunnel: CF-Connecting-IP, else the first X-Forwarded-For hop, else the socket. null when unknown (tests, unusual transports). */
export function clientIp(c: Context): string | null {
  const h = c.req.header('cf-connecting-ip')?.trim() || c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (h) return h;
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

const salt = () => env.IP_HASH_SALT ?? createHmac('sha256', env.BETTER_AUTH_SECRET).update('ip-hash-salt').digest('hex');
/** Salted HMAC: the raw address is never stored. Truncated to 128 bits, plenty to count by. */
export const hashIp = (ip: string) => createHmac('sha256', salt()).update(ip).digest('hex').slice(0, 32);
export const clientIpHash = (c: Context) => {
  const ip = clientIp(c);
  return ip ? hashIp(ip) : null;
};
