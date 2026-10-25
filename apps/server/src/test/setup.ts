import { beforeEach } from 'vitest';
import { clearBalanceCache } from '../community';
import { sql } from '../db/client';
import { setFetch } from '../ai/openrouter';
import { memoryStorage, setStorage } from '../storage';
import type { PLANS } from '../quota';

// Most tests are about mechanics, not plan sizes: every plan is 1 test per window (guests a week, accounts a day) and every generated L/R test is open.
// community.test.ts 'plans' restores the real ones (realPlans()).
const one = (days: number) => ({ writing: [[1, days]], speaking: [[1, days]], examiner: [[1, days]] }) as (typeof PLANS)['guest'];
let real: { plans: typeof PLANS; lr: typeof import('../routes/lr').LR_PLANS } | undefined;
export const realPlans = () => structuredClone(real!);

// Clean slate per test; storage is in-memory. AI fetch is injected per test (see helpers.fakeFetch).
beforeEach(async () => {
  await sql.unsafe(
    `TRUNCATE "user","session","account","verification","user_settings","prompts","attempts","analyses","mistakes","cards","live_sessions","quota_usage","user_api_keys","lr_attempts","lr_tests","email_log","cambridge_access","replay_sessions","feedback","guest_conversions","ai_costs","stt_playground_runs" RESTART IDENTITY CASCADE`,
  );
  await (await import('../auth')).loadCambridgeGrants(); // table is empty again; imported lazily so a test file's vi.mock('./email') still applies to auth.ts
  // imported lazily like auth below (both load auth.ts)
  const [{ PLANS }, { LR_PLANS }] = await Promise.all([import('../quota'), import('../routes/lr')]);
  real ??= structuredClone({ plans: PLANS, lr: LR_PLANS });
  Object.assign(PLANS, { ...structuredClone(real.plans), guest: one(7), community: one(1) });
  Object.assign(LR_PLANS, { guest: null, account: null });
  setStorage(memoryStorage());
  clearBalanceCache();
  setFetch(async (url) => new Response(`no fake fetch for ${String(url)}`, { status: 599 })); // a test that reaches the network must say so
});
