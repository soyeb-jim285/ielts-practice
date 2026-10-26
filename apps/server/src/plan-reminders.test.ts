import { testUser } from './test/helpers'; // first: loads the app before the modules that import it back
import { expect, it, vi } from 'vitest';
import { db } from './db/client';
import { userLimits } from './db/schema';
import { sendEmail } from './email';
import { planReminderSweep, stageFor } from './plan-reminders';

vi.mock('./email', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1', attempts: 1 })), sendBatch: vi.fn(async () => ({ ok: true })) }));
const send = vi.mocked(sendEmail);
const DAY = 86_400_000;
const NOW = new Date('2026-11-01T06:00:00Z');
const mine = (email: string) => send.mock.calls.map(([m]) => m).filter((m) => m.to === email);

async function subscriber(email: string, until: Date, opts: { verified?: boolean } = {}) {
  const { user } = await testUser(email, { unlimited: false, verified: opts.verified });
  await db.insert(userLimits).values({ userId: user.id, subscribedUntil: until, updatedBy: 'test' }).onConflictDoUpdate({ target: userLimits.userId, set: { subscribedUntil: until } });
  return user;
}

it('picks the smallest stage the time left fits in', () => {
  expect(stageFor(8 * DAY)).toBeNull();
  expect(stageFor(7 * DAY)).toBe(7);
  expect(stageFor(4 * DAY)).toBe(7);
  expect(stageFor(2 * DAY)).toBe(3);
  expect(stageFor(DAY / 2)).toBe(1);
});

it('sends 7, 3 and 1 day reminders once each', async () => {
  const until = new Date(NOW.getTime() + 7 * DAY);
  await subscriber('plan-a@test.dev', until);
  send.mockClear();
  await planReminderSweep(NOW);
  await planReminderSweep(new Date(NOW.getTime() + 3_600_000)); // next hour: same stage, nothing new
  expect(mine('plan-a@test.dev').map((m) => m.subject)).toEqual(['Your NextBand paid plan ends in 7 days']);
  await planReminderSweep(new Date(until.getTime() - 3 * DAY));
  await planReminderSweep(new Date(until.getTime() - 20 * 3_600_000));
  const subjects = mine('plan-a@test.dev').map((m) => m.subject);
  expect(subjects).toEqual(['Your NextBand paid plan ends in 7 days', 'Your NextBand paid plan ends in 3 days', 'Your NextBand paid plan ends tomorrow']);
  expect(mine('plan-a@test.dev')[0]!.html).toContain('8 November 2026');
});

it('skips far-off, ended and unverified plans; a failed send retries next hour', async () => {
  await subscriber('plan-far@test.dev', new Date(NOW.getTime() + 20 * DAY));
  await subscriber('plan-over@test.dev', new Date(NOW.getTime() - DAY));
  await subscriber('plan-unverified@test.dev', new Date(NOW.getTime() + 2 * DAY), { verified: false });
  await subscriber('plan-retry@test.dev', new Date(NOW.getTime() + 2 * DAY));
  send.mockClear();
  send.mockImplementation(async (m) => (m.to === 'plan-retry@test.dev' ? { ok: false, kind: 'transient' } : { ok: true, id: 'e', attempts: 1 }) as never);
  await planReminderSweep(NOW);
  expect(mine('plan-far@test.dev')).toHaveLength(0);
  expect(mine('plan-over@test.dev')).toHaveLength(0);
  expect(mine('plan-unverified@test.dev')).toHaveLength(0);
  expect(mine('plan-retry@test.dev')).toHaveLength(1);
  send.mockImplementation(async () => ({ ok: true, id: 'e', attempts: 1 }));
  await planReminderSweep(new Date(NOW.getTime() + 3_600_000));
  expect(mine('plan-retry@test.dev')).toHaveLength(2);
});
