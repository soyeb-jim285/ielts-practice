// Guest → account: when an anonymous user signs up or signs in (Better Auth anonymous plugin onLinkAccount), everything they made moves to the real account.
// The plugin deletes the anonymous user right after, which would cascade-delete these rows.
import { and, eq } from 'drizzle-orm';
import { db } from './db/client';
import { attempts, liveSessions, mistakes, quotaUsage } from './db/schema';
import { storage } from './storage';

export async function linkGuest(anonId: string, newId: string) {
  if (anonId === newId) return;
  const moved = await db.transaction(async (tx) => {
    // Used tests move too, with their IP hash: the guest's test still counts in today's window and in the IP's weekly cap.
    await tx.update(quotaUsage).set({ userId: newId }).where(eq(quotaUsage.userId, anonId));
    await tx.update(liveSessions).set({ userId: newId }).where(eq(liveSessions.userId, anonId));
    await tx.update(mistakes).set({ userId: newId }).where(eq(mistakes.userId, anonId));
    return tx.update(attempts).set({ userId: newId }).where(eq(attempts.userId, anonId)).returning({ id: attempts.id, audioKey: attempts.audioKey });
  });
  // Recordings live under audio/{userId}/: re-key them so deleting the real account later removes them too. Best effort: a failure leaves the old key working.
  for (const a of moved) {
    if (!a.audioKey?.startsWith(`audio/${anonId}/`)) continue;
    const key = `audio/${newId}/${a.audioKey.slice(`audio/${anonId}/`.length)}`;
    try {
      const mime = (await db.query.attempts.findFirst({ where: eq(attempts.id, a.id), columns: { audioMime: true } }))?.audioMime ?? 'audio/webm';
      await storage.put(key, await storage.get(a.audioKey), mime);
      await db.update(attempts).set({ audioKey: key }).where(and(eq(attempts.id, a.id), eq(attempts.userId, newId)));
      await storage.deletePrefix(a.audioKey);
    } catch (e) {
      console.error('could not re-key guest recording', a.id, (e as Error).message);
    }
  }
}
