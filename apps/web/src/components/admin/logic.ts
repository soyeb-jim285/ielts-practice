import type { TestHealth } from '@server/admin/schemas';

/** Pure helpers behind the admin dashboard, funnel and tests list (tested in logic.test.ts). */

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Last `n` values against the `n` before them. */
export function periodDelta(values: number[], n = 7) {
  const cur = sum(values.slice(-n));
  const prev = sum(values.slice(-2 * n, -n));
  return { cur, prev, diff: cur - prev };
}

/** "+3 vs prev 7 d" chip. `upIsGood` false for cost-like numbers. Equal or no baseline gives a neutral chip. */
export function deltaChip(cur: number, prev: number, unit: string, upIsGood = true, fmt: (n: number) => string = (n) => String(Math.round(n))) {
  const diff = cur - prev;
  if (!diff) return { value: `no change ${unit}`, tone: 'neutral' as const };
  const up = diff > 0;
  return { value: `${up ? '+' : '-'}${fmt(Math.abs(diff))} ${unit}`, tone: up === upIsGood ? ('good' as const) : ('bad' as const) };
}

export type Attention = { id: string; tone: 'bad' | 'warn' | 'info'; text: string; to: '/admin/health' | '/admin/costs' | '/admin/feedback'; at?: string };
const RANK = { bad: 0, warn: 1, info: 2 };

/** One list for Dashboard and System: failed work, money running out, unread feedback. Worst first, newest first within a tone. */
export function attentionItems(i: {
  failed24h: number;
  stuck: number;
  emailFailed24h: number;
  feedbackNew: number;
  balanceErrors?: number;
  forecast?: { status: 'ok' | 'low' | 'critical' | 'unknown'; daysLeft: number | null; burnPerDay7d: number | null; remaining: number | null } | null;
  warnings?: string[];
}): Attention[] {
  const out: Attention[] = [];
  const f = i.forecast;
  if (f && (f.status === 'low' || f.status === 'critical') && f.daysLeft != null) {
    const d = Math.max(0, Math.floor(f.daysLeft));
    out.push({ id: 'runway', tone: f.status === 'critical' ? 'bad' : 'warn', to: '/admin/costs', text: `OpenRouter runs out in about ${d} ${d === 1 ? 'day' : 'days'}${f.burnPerDay7d != null ? ` at $${f.burnPerDay7d.toFixed(2)} a day` : ''}.` });
  } else if (i.warnings?.length) out.push({ id: 'balance', tone: 'warn', to: '/admin/costs', text: i.warnings[0]! });
  if (i.failed24h) out.push({ id: 'failed', tone: 'bad', to: '/admin/health', text: `${i.failed24h} ${i.failed24h === 1 ? 'analysis' : 'analyses'} failed in the last 24 h${i.balanceErrors ? ` (${i.balanceErrors} from a low balance)` : ''}.` });
  if (i.stuck) out.push({ id: 'stuck', tone: 'bad', to: '/admin/health', text: `${i.stuck} ${i.stuck === 1 ? 'analysis is' : 'analyses are'} stuck for over 10 minutes.` });
  if (i.emailFailed24h) out.push({ id: 'email', tone: 'warn', to: '/admin/health', text: `${i.emailFailed24h} ${i.emailFailed24h === 1 ? 'email' : 'emails'} failed to send in the last 24 h.` });
  if (i.feedbackNew) out.push({ id: 'feedback', tone: 'info', to: '/admin/feedback', text: `${i.feedbackNew} new ${i.feedbackNew === 1 ? 'report' : 'reports'} to read.` });
  return out.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}

/** Funnel steps with the conversion from the step above. `notNested`: a step larger than the one before it, which a funnel cannot do. */
export function funnelRows(steps: { label: string; users: number }[]) {
  return steps.map((s, k) => {
    const prev = steps[k - 1];
    return { ...s, fromPrev: prev && prev.users > 0 ? s.users / prev.users : null, notNested: !!prev && s.users > prev.users };
  });
}

export type TestSort = 'started' | 'completion' | 'band';
/** Filter by title text and source, order, keep the first `limit`. */
export function rankTests(rows: TestHealth[], o: { q?: string; source?: string; sort: TestSort; limit: number }) {
  const q = o.q?.trim().toLowerCase();
  const list = rows.filter((t) => (!q || `${t.title} ${t.skill} ${t.part ?? ''}`.toLowerCase().includes(q)) && (!o.source || o.source === 'all' || t.source === o.source));
  // Lowest first for completion and band, but tests nobody finished (no band) sort last.
  const key = (t: TestHealth) => (o.sort === 'started' ? -t.started : o.sort === 'completion' ? t.completionRate : (t.avgBand ?? 99));
  list.sort((a, b) => key(a) - key(b) || b.started - a.started);
  return { total: list.length, items: list.slice(0, o.limit) };
}

/** "5 min ago", "3 h ago", "2 d ago"; older than 30 days falls back to the caller's full date. */
export function relative(iso: string, now = Date.now()): string | null {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return null;
}
