import { getConnInfo } from '@hono/node-server/conninfo';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { Context } from 'hono';
import { env } from './env';

/** An IPv4 address, or an IPv6 one reduced to its /64 (one household or one phone gets a whole /64, so per-address caps would be free to dodge by rotating the low bits). null when not an IP. */
export function normalizeIp(raw: string): string | null {
  let ip = raw.trim();
  const v = isIP(ip);
  if (!v) return null;
  if (v === 4) return ip;
  ip = ip.toLowerCase().split('%')[0]!;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip); // IPv4-mapped
  if (mapped) return mapped[1]!;
  const [head, tail = ''] = ip.split('::') as [string, string?];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
}

/** Client address behind the Cloudflare Tunnel: CF-Connecting-IP (X-Forwarded-For is ignored whenever it is present: a client can put anything in it), else the LAST X-Forwarded-For hop
 *  (the one our own proxy appended; the first hops are client-written), else the socket. Anything that is not an IP is ignored, so junk headers cannot mint endless fresh counters.
 *  null when unknown (tests, unusual transports). */
export function clientIp(c: Context): string | null {
  const cf = c.req.header('cf-connecting-ip');
  if (cf?.trim()) return normalizeIp(cf) ?? socketIp(c);
  const xff = c.req.header('x-forwarded-for')?.split(',').at(-1);
  return (xff && normalizeIp(xff)) || socketIp(c);
}

function socketIp(c: Context): string | null {
  try {
    const a = getConnInfo(c).remote.address;
    return a ? normalizeIp(a) : null;
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
