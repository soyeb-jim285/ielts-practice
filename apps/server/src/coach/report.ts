import { desc, eq, sql as q } from 'drizzle-orm';
import { db, sql } from '../db/client';
import { attempts, coachReports, lrAttempts, userSettings } from '../db/schema';
import { isTimeZone } from '../settings';
import { buildFacts, lastTestAt } from './facts';
import { writeWords } from './words';

const SWEEP_LOCK = 7_301_027; // arbitrary constant: one sweep at a time across processes

export const localDay = (now: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: isTimeZone(timeZone) ? timeZone : 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Read raw: getSettings() throws on a stored zone the runtime no longer knows. */
async function zoneOf(userId: string): Promise<string> {
  const row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  const tz = row?.data?.timeZone;
  return typeof tz === 'string' ? tz : 'UTC';
}

export async function latestReport(userId: string) {
  const [r] = await db.select().from(coachReports).where(eq(coachReports.userId, userId)).orderBy(desc(coachReports.day)).limit(1);
  return r ?? null;
}

export async function isStale(userId: string, now: Date): Promise<boolean> {
  const t = await lastTestAt(userId);
  if (!t) return false;
  const r = await latestReport(userId);
  return !r || (t > r.lastTestAt && r.day < localDay(now, await zoneOf(userId)));
}

export async function generateReport(userId: string, now = new Date()): Promise<'created' | 'skipped'> {
  // ponytail: tx holds a pool connection across the model call while helpers use another from db (max 10), so ~10 concurrent generations can exhaust the pool; pass tx into the helpers or move the model call outside the lock.
  return db.transaction(async (tx) => {
    await tx.execute(q`select pg_advisory_xact_lock(hashtextextended(${'coach:' + userId}, 0))`);
    if (!(await isStale(userId, now))) return 'skipped';
    const t = (await lastTestAt(userId))!; // read before the model call: a test submitted meanwhile is not covered
    const facts = await buildFacts(userId, now);
    const { words, model } = await writeWords(facts);
    const day = localDay(now, await zoneOf(userId));
    const ins = await tx.insert(coachReports).values({ userId, day, lastTestAt: t, facts, words, model }).onConflictDoNothing().returning({ id: coachReports.id });
    return ins.length ? 'created' : 'skipped';
  });
}

/** ponytail: scans every student who ever tested; narrow with a lastTest > latest report query if that gets slow. */
export async function coachSweep(now = new Date()): Promise<number> {
  const conn = await sql.reserve(); // session locks live on one connection
  try {
    const [row] = await conn`select pg_try_advisory_lock(${SWEEP_LOCK}) as ok`;
    if (!row?.ok) return 0;
    try {
      const ids = await db.execute<{ id: string }>(q`select user_id as id from ${attempts} where status = 'done' union select user_id from ${lrAttempts} where status = 'submitted'`);
      let made = 0;
      for (const { id } of ids) {
        try {
          if ((await isStale(id, now)) && (await generateReport(id, now)) === 'created') made++;
        } catch (e) {
          console.error('coach report failed', id, e);
        }
      }
      return made;
    } finally {
      await conn`select pg_advisory_unlock(${SWEEP_LOCK})`;
    }
  } finally {
    conn.release();
  }
}
