import { beforeEach } from 'vitest';
import { clearBalanceCache } from '../community';
import { sql } from '../db/client';
import { setFetch } from '../ai/openrouter';
import { memoryStorage, setStorage } from '../storage';

// Clean slate per test; storage is in-memory. AI fetch is injected per test (see helpers.fakeFetch).
beforeEach(async () => {
  await sql.unsafe(
    `TRUNCATE "user","session","account","verification","user_settings","prompts","attempts","analyses","mistakes","cards","live_sessions","quota_usage","user_api_keys","lr_attempts","lr_tests","email_log" RESTART IDENTITY CASCADE`,
  );
  setStorage(memoryStorage());
  clearBalanceCache();
  setFetch(async (url) => new Response(`no fake fetch for ${String(url)}`, { status: 599 })); // a test that reaches the network must say so
});
