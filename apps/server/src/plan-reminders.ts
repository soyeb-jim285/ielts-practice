import { and, eq, sql } from 'drizzle-orm';
import { db } from './db/client';
import { planReminders } from './db/schema';
import { sendEmail } from './email';
import { renderEmail } from './email-templates';

const DAY = 86_400_000;
const STAGES = [1, 3, 7] as const;
const WHEN: Record<(typeof STAGES)[number], string> = { 1: 'tomorrow', 3: 'in 3 days', 7: 'in 7 days' };

/** The reminder due now: the smallest stage the time left fits in (a plan granted with 2 days left gets only the 3-day one, then the 1-day one). */
export const stageFor = (left: number) => STAGES.find((d) => left <= d * DAY) ?? null;

const dateIn = (d: Date, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  }
};

/** "Your paid plan ends soon" emails, 7, 3 and 1 day before subscribed_until. Account email (no unsubscribe): it is about their plan, not news. */
export async function planReminderSweep(now = new Date()): Promise<number> {
  const rows = (await db.execute(sql`select u.id, u.email, u.name, l.subscribed_until as until, s.data->>'timeZone' as tz
    from user_limits l join "user" u on u.id = l.user_id left join user_settings s on s.user_id = u.id
    where l.subscribed_until > ${now.toISOString()} and l.subscribed_until <= ${new Date(now.getTime() + 7 * DAY).toISOString()}
      and not coalesce(u.is_anonymous, false) and u.email_verified`)) as unknown as { id: string; email: string; name: string | null; until: Date | string; tz: string | null }[];
  let sent = 0;
  for (const r of rows) {
    try {
      const until = new Date(r.until);
      const days = stageFor(until.getTime() - now.getTime());
      if (!days) continue;
      const m = await renderEmail('plan-ending', { name: r.name?.trim() || 'there', when: WHEN[days], until: dateIn(until, r.tz ?? 'UTC') });
      // claimed right before sending: two processes or a double run send once; a failed send frees the claim for the next hour
      if (!(await db.insert(planReminders).values({ userId: r.id, until, days }).onConflictDoNothing().returning()).length) continue;
      const res = await sendEmail({ to: r.email, ...m });
      if (res.ok) sent++;
      else await db.delete(planReminders).where(and(eq(planReminders.userId, r.id), eq(planReminders.until, until), eq(planReminders.days, days)));
    } catch (e) {
      console.error('plan reminder failed', r.id, e);
    }
  }
  return sent;
}
