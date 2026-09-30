import { beforeEach } from 'vitest';
import { sql } from '../db/client';
import { memoryStorage, setStorage } from '../storage';

// Clean slate per test; storage is in-memory. AI fetch is injected per test (see helpers.fakeFetch).
beforeEach(async () => {
  await sql.unsafe(
    `TRUNCATE "user","session","account","verification","user_settings","prompts","attempts","analyses","mistakes","cards","live_sessions" RESTART IDENTITY CASCADE`,
  );
  setStorage(memoryStorage());
});
