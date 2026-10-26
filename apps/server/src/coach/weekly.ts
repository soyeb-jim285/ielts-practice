import { and, eq } from 'drizzle-orm';
import { db, sql } from '../db/client';
import { coachWeekly } from '../db/schema';
import { sendBatch } from '../email';
import { docOf, fill, renderDoc } from '../email-templates';
import type { Block, EmailDoc } from '../emails/blocks';
import { audienceOf, campaignEmail } from '../emails/campaigns';
import { getSettings } from '../settings';
import { buildFacts, lastTestAt } from './facts';
import { latestReport, localDay } from './report';
import type { CoachFacts, CoachWords } from './types';

const LOCK = 7_301_028; // arbitrary constant: one weekly sweep at a time across processes
const DAY = 86_400_000;

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const change = (now: number, before: number) => ({ change: now === before ? 'same' : `${now > before ? '+' : ''}${now - before}`, trend: now > before ? 'up' : now < before ? 'down' : 'none' }) as const;
const deep = (v: unknown, vars: Record<string, string>): any =>
  typeof v === 'string' ? fill(v, vars) : Array.isArray(v) ? v.map((x) => deep(x, vars)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, vars)])) : v;

/** The saved weekly template with {{headline}} (the win when there is one, so it is not repeated) filled and the week's numbers added after the intro. */
export function weeklyDoc(base: EmailDoc, report: { facts: Pick<CoachFacts, 'skills'>; words: Pick<CoachWords, 'summary' | 'win' | 'focus'> }, w: CoachFacts['weekStats']): EmailDoc {
  const { words } = report;
  const headline = words.win || words.summary.split(/(?<=[.!?])\s/)[0]!;
  const items: Extract<Block, { type: 'stats' }>['items'] = [];
  for (const [label, key] of [['Tests', 'tests'], ['Minutes', 'minutes'], ['Days practised', 'days']] as const)
    if (w[key]) items.push({ value: String(w[key]), label, ...change(w[key], w.prev[key]) });
  const up = report.facts.skills.find((s) => s.trend === 'improving' && s.band != null && s.trendDelta != null);
  if (up) items.push({ value: String(up.band), label: `${cap(up.skill)} band`, change: `${up.trendDelta! > 0 ? '+' : ''}${up.trendDelta}`, trend: 'up' });
  const extra: Block[] = [
    ...(items.length ? [{ type: 'stats' as const, items }] : []),
    ...(words.focus[0] ? [{ type: 'text' as const, text: `**This week:** ${words.focus[0].title}` }] : []),
  ];
  const intro = base.blocks.findIndex((b) => b.type === 'text');
  const i = (intro >= 0 ? intro : base.blocks.findIndex((b) => b.type === 'hero')) + 1; // an admin may have removed the intro
  const d = { ...base, blocks: [...base.blocks.slice(0, i), ...extra, ...base.blocks.slice(i)] };
  return deep(d, { headline });
}

/** ISO week (YYYY-Www) of a local YYYY-MM-DD day. */
function isoWeek(day: string): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // the week's Thursday decides the year
  const y = d.getUTCFullYear();
  return `${y}-W${String(Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / DAY + 1) / 7)).padStart(2, '0')}`;
}

/** Monday, 09:00 or later, in the zone. */
function mondayMorning(now: Date, timeZone: string): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return p.weekday === 'Mon' && Number(p.hour) >= 9;
}

/** ponytail: walks every verified opted-in account hourly (settings read per user); filter by zone in SQL if the user count grows. */
export async function weeklySweep(now = new Date()): Promise<number> {
  const conn = await sql.reserve(); // session locks live on one connection
  try {
    const [row] = await conn`select pg_try_advisory_lock(${LOCK}) as ok`;
    if (!row?.ok) return 0;
    try {
      let sent = 0;
      const doc = await docOf('weekly-report');
      for (const u of await audienceOf('all')) {
        try {
          const tz = (await getSettings(u.id)).timeZone;
          if (!mondayMorning(now, tz)) continue;
          const t = await lastTestAt(u.id);
          const report = await latestReport(u.id);
          if (!t || t.getTime() <= now.getTime() - 7 * DAY || !report) continue;
          const week = isoWeek(localDay(now, tz));
          if (await db.query.coachWeekly.findFirst({ where: and(eq(coachWeekly.userId, u.id), eq(coachWeekly.week, week)) })) continue;
          const { weekStats } = await buildFacts(u.id, now);
          const r = await renderDoc(weeklyDoc(doc, report, weekStats), 'promo');
          if (!(await db.insert(coachWeekly).values({ userId: u.id, week }).onConflictDoNothing().returning()).length) continue; // claimed right before sending: a double run sends once, a failed build keeps the week open
          const res = await sendBatch([campaignEmail(r, u)], `coach-weekly-${u.id}-${week}`);
          if (res.ok) sent++;
          else await db.delete(coachWeekly).where(and(eq(coachWeekly.userId, u.id), eq(coachWeekly.week, week)));
        } catch (e) {
          console.error('weekly email failed', u.id, e);
        }
      }
      return sent;
    } finally {
      await conn`select pg_advisory_unlock(${LOCK})`;
    }
  } finally {
    conn.release();
  }
}
