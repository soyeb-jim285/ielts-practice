import { eq, lt, sql } from 'drizzle-orm';
import { db } from './db/client';
import { replaySessions } from './db/schema';
import { storage } from './storage';

export const REPLAY_RETENTION_DAYS = 14;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** R2 prefix of one session's chunks: replay/<yyyy-mm-dd of started_at, UTC>/<id>/ (docs/admin/DESIGN.md). */
export const replayPrefix = (row: { id: string; startedAt: Date }) => `replay/${day(row.startedAt)}/${row.id}/`;
export const replayKey = (row: { id: string; startedAt: Date }, seq: number) => `${replayPrefix(row)}${seq}.json.gz`;

/** Retention: sessions idle for 14 days lose their R2 objects, then their row. 500 per run; the daily timer catches up. */
export async function purgeReplays() {
  const old = await db
    .select({ id: replaySessions.id, startedAt: replaySessions.startedAt })
    .from(replaySessions)
    .where(lt(replaySessions.lastAt, sql`now() - ${REPLAY_RETENTION_DAYS} * interval '1 day'`))
    .limit(500);
  let n = 0;
  for (const row of old) {
    try {
      await storage.deletePrefix(replayPrefix(row));
      await db.delete(replaySessions).where(eq(replaySessions.id, row.id));
      n++;
    } catch (e) {
      console.error('purgeReplays failed for', row.id, e); // keep the row so the next run retries the objects
    }
  }
  return n;
}
