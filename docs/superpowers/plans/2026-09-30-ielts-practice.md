# IELTS Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web + native iOS app for IELTS Speaking (practice + live examiner) and Writing practice, with descriptor-anchored AI scoring, locatable mistakes, and improvement loops.

**Architecture:** pnpm monorepo. A Hono API (zod-openapi, Scalar docs) on Node owns auth (Better Auth), data (Postgres/Drizzle), storage (R2), and every AI call (OpenRouter, plus optional OpenAI Realtime token minting). The same server serves the Vite React SPA. The SwiftUI app consumes the same `/openapi.json` via swift-openapi-generator. Pure metric/scoring logic lives in `packages/core`, unit tested.

**Tech Stack:**
- Server: Node 22+, TypeScript, Hono 4, @hono/zod-openapi, @scalar/hono-api-reference, better-auth, drizzle-orm + postgres (postgres.js), drizzle-kit, @aws-sdk/client-s3 + s3-request-presigner, resend, zod, vitest.
- Web: Vite, React 19, @tanstack/react-router, @tanstack/react-query, Tailwind v4, recharts, openapi-typescript + openapi-fetch.
- iOS: SwiftUI iOS 17, XcodeGen, swift-openapi-generator, Swift Charts, AVFoundation.
- Ops: Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-30-ielts-practice-design.md` (read it; every section number referenced below is from it). Research: `docs/research.md`.

## Global Constraints

- All AI goes via OpenRouter `https://openrouter.ai/api/v1` (chat, `/audio/transcriptions`, `/audio/speech`, `/models`). The only exception is OpenAI Realtime ephemeral tokens when `liveProvider='openai-realtime'` and `OPENAI_API_KEY` is set.
- Every route is defined with `createRoute` from `@hono/zod-openapi` and appears in `/openapi.json`. Scalar UI is at `/docs`.
- Cambridge gating is server-side: `restricted=false OR user.email ∈ CAMBRIDGE_ALLOWED_EMAILS` (default `soyebjim@gmail.com`, comma-separated, case-insensitive). No Cambridge content is ever committed. `data/cambridge/` is gitignored.
- The public repo is `soyeb-jim285/ielts-practice`, default branch `main`. Commits carry no attribution trailers.
- Band maths:
  - Criteria are whole bands 0–9.
  - Overall rounding: frac < .25 → floor, < .75 → floor + .5, else → floor + 1.
  - Writing: (T1 + 2·T2)/3.
  - ≤ 20 words → Band 1.
- Speech thresholds: pause ≥ 250 ms, long pause ≥ 1000 ms, unclear word conf < 0.6, WPM window 10 s with a 5 s hop, voiced-gap filler ≥ 300 ms.
- Writing inputs must set `spellcheck=false autocorrect=off autocapitalize=off autocomplete=off data-gramm=false data-gramm_editor=false data-enable-grammarly=false`. On iOS the text view disables autocorrection, spell checking, smart quotes/dashes/insert-delete and inline prediction.
- Timers:
  - Writing: T1 1200 s, T2 2400 s, full 3600 s.
  - Speaking P2: 60 s prep, 120 s talk with a hard stop.
  - Speaking target zones: P1 15–40 s, P2 60–120 s (green ≥ 90 s), P3 30–60 s.
- The analysis result JSON has `v: 1` and follows the spec §6 schema. `topFixes` has exactly 3 entries.
- Secrets come from env only. `.env.example` is committed with every key from spec §2.

## Review Focus

1. **Mic permission denied or no input device.** Show a clear inline message with how to enable it. No crash, and no empty attempt is created. Test: Task 13 recorder hook test.
2. **Silent or near-empty recording.** STT returns 0 words, so the result says "No speech detected" and the analysis LLM is never called. Test: Task 7 `analyzeSpeaking` returns `noSpeech` without calling chat.
3. **LLM returns malformed or partial JSON.** One repair retry with the zod errors sent back. Then the attempt becomes `failed` with a message, and `POST /attempts/:id/submit` can re-run it. Test: Task 6 `chatJson` repair test.
4. **Writing submitted nearly empty** (e.g. the timer auto-submits with 0–20 words). No LLM call; the result is Band 1 on every criterion with the reason. Test: Task 8.
5. **Non-allowlisted user requests a restricted prompt by id**, or asks for its image. Returns 404, never leaks. The prompt list never includes it. Test: Task 9 gating test.

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .env.example, .gitignore, docker-compose.yml, Dockerfile
.github/workflows/ci.yml
packages/core/src/{band.ts,speech.ts,text.ts,srs.ts,constants.ts,index.ts} + src/*.test.ts
apps/server/src/
  index.ts            node entry (serve), static web, startup recovery
  app.ts              OpenAPIHono app factory (routes mounted, /docs, /openapi.json) — exported for tests
  env.ts              zod-validated env
  db/{schema.ts,client.ts}  drizzle schema + client; drizzle/ migrations
  auth.ts             better-auth instance + session middleware (requireUser)
  email.ts            resend send helpers
  storage.ts          R2 presign put/get, head, putObject
  ai/openrouter.ts    chatJson, chatText, transcribe, speak, listModels (injectable fetch)
  ai/descriptors.ts   condensed band descriptors text
  ai/speaking.ts      analyzeSpeaking()
  ai/writing.ts       analyzeWriting()
  ai/examiner.ts      live examiner state machine + prompt
  ai/schemas.ts       zod schemas for LLM outputs + AnalysisResult
  settings.ts         defaults + resolveSettings()
  routes/{me.ts,settings.ts,models.ts,prompts.ts,attempts.ts,live.ts,progress.ts,mistakes.ts,cards.ts}.ts
  jobs.ts             runAnalysis(attemptId) + recoverStale()
  test/helpers.ts     test db + fake fetch
apps/web/src/
  main.tsx, router.tsx, api.ts (openapi-fetch client), schema.d.ts (generated), auth.ts
  styles.css (tailwind + tokens)
  components/{Layout,Timer,MicButton,Waveform,BandGauge,Tabs,Transcript,WpmChart,ErrorCard,ChartRenderer,ModelPicker,Empty}.tsx
  hooks/{useRecorder.ts,useVad.ts,useCountdown.ts}
  routes/{index,login,signup,speaking,speaking.session,speaking.live,speaking.result,writing,writing.task,writing.result,bank,mistakes,review,history,settings}.tsx
apps/ios/
  project.yml (XcodeGen), IELTS/{App.swift, API/ (openapi.yaml, openapi-generator-config.yaml), Views/…, Audio/…}
scripts/{seed-bank.ts, gen-bank.ts, export-openapi.ts, cambridge-extract.py}
data/bank/{speaking.json, writing.json}
```

---

### Task 1: Monorepo scaffold, CI check job, GitHub repo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`, `.github/workflows/ci.yml`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/smoke.test.ts`

**Interfaces:** Produces: workspace names `@ielts/core`, `@ielts/server`, `@ielts/web`. Root scripts: `pnpm test`, `pnpm typecheck`, `pnpm build`.

- [ ] **Step 1: Root files**

`pnpm-workspace.yaml`:
```yaml
packages: ["apps/*", "packages/*"]
```
Root `package.json`:
```json
{ "name": "ielts-practice", "private": true, "type": "module",
  "packageManager": "pnpm@11.26.0",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  } }
```
`tsconfig.base.json`: `strict`, `target ES2023`, `module ESNext`, `moduleResolution Bundler`, `skipLibCheck`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
`.env.example`: every key from spec §2, plus `PORT=8787` and `WEB_ORIGIN=http://localhost:5173`.

- [ ] **Step 2: core package with a smoke test**

`packages/core/package.json`: name `@ielts/core`, `"main": "src/index.ts"`, `"types": "src/index.ts"`, scripts `test: vitest run`, `typecheck: tsc --noEmit`, devDeps vitest and typescript.
`src/smoke.test.ts`: `expect(1).toBe(1)`. Run `pnpm install && pnpm test`. Expected: PASS.

- [ ] **Step 3: CI**

`.github/workflows/ci.yml` job `check` (ubuntu-latest): checkout, pnpm/action-setup, setup-node 22 with pnpm cache, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Later tasks add `docker` and `ios` jobs.

- [ ] **Step 4: Create repo and push**

```bash
git add -A && git commit -m "chore: monorepo scaffold and CI"
gh repo create soyeb-jim285/ielts-practice --public --source=. --remote=origin --push
gh run watch --exit-status $(gh run list -L1 --json databaseId -q '.[0].databaseId')
```
Expected: the CI run is green.

---

### Task 2: `packages/core` — band maths, speech metrics, text metrics, SRS (TDD)

**Files:**
- Create: `packages/core/src/{constants.ts,band.ts,speech.ts,text.ts,srs.ts}` and `band.test.ts`, `speech.test.ts`, `text.test.ts`, `srs.test.ts`
- Modify: `packages/core/src/index.ts` (re-export all); delete `smoke.test.ts`

**Interfaces (Produces):**
```ts
// constants.ts
export const PAUSE_MS = 250, LONG_PAUSE_MS = 1000, UNCLEAR_CONF = 0.6, WPM_WINDOW_S = 10, WPM_HOP_S = 5, VOICED_GAP_MS = 300;
export const WRITING_SECONDS = { t1: 1200, t2: 2400, full: 3600 } as const;
export const MIN_WORDS = { t1: 150, t2: 250 } as const;
export const SPEAKING_ZONES = { 1: { min: 15, max: 40 }, 2: { min: 60, good: 90, max: 120 }, 3: { min: 30, max: 60 } } as const;
export const P2_PREP_S = 60;
export const FILLERS: string[]; // ["um","uh","er","erm","ah","hmm","like","you know","i mean","sort of","kind of"]
export const LINKERS: string[]; // moreover, furthermore, in addition, however, therefore, firstly, secondly, finally, on the other hand, in conclusion, additionally, consequently, nevertheless, for example, for instance, as a result, thus, hence, although, whereas
// band.ts
export function roundBand(x: number): number;
export function speakingOverall(c: { fc: number; lr: number; gra: number; p: number }): { raw: number; band: number };
export function taskBand(c: { ta: number; cc: number; lr: number; gra: number }): number; // mean of 4, raw (unrounded)
export function writingOverall(t1: number | null, t2: number | null): { raw: number; band: number }; // null = task not done → other task alone
// speech.ts
export type Word = { w: string; start: number; end: number; conf?: number }; // seconds
export type Pause = { start: number; end: number; dur: number; kind: 'short' | 'long'; midClause: boolean; voiced: boolean };
export type SpeechMetrics = {
  durationS: number; wordCount: number; speechRate: number; articulationRate: number;
  phonationRatio: number; pauseRatio: number; mlr: number;
  pauses: Pause[]; longPauses: number; midClausePauses: number;
  fillers: { word: string; time: number; kind: 'lexical' | 'voiced' }[]; fillersPerMin: number;
  repetitions: { phrase: string; time: number; wordIdx: number }[];
  selfCorrections: { time: number; wordIdx: number }[];
  unclear: { wordIdx: number; w: string; conf: number; tier: 1 | 2 | 3 }[];
  wpmSeries: { t: number; wpm: number }[]; wpmStdDev: number;
};
export function computeSpeechMetrics(words: Word[], opts: { durationS: number; energy?: number[]; frameMs?: number; voiceThreshold?: number }): SpeechMetrics;
// text.ts
export type TextMetrics = { words: number; sentences: number; paragraphs: number; avgSentenceLen: number; mtld: number; ttr: number;
  linkers: { word: string; count: number; overused: boolean }[]; repeated: { word: string; count: number }[] };
export function tokenize(text: string): string[]; // lowercase words, apostrophes kept
export function mtld(tokens: string[], threshold?: number): number;
export function computeTextMetrics(text: string): TextMetrics;
// srs.ts
export type CardState = { ease: number; interval: number; reps: number; due: Date };
export function review(s: CardState, grade: 0 | 1 | 2 | 3 | 4 | 5, now?: Date): CardState; // SM-2
```

- [ ] **Step 1: Write failing tests**

`band.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { roundBand, speakingOverall, writingOverall } from './band';
describe('roundBand', () => {
  it.each([[6, 6], [6.1, 6], [6.25, 6.5], [6.4, 6.5], [6.5, 6.5], [6.74, 6.5], [6.75, 7], [6.9, 7], [8.875, 9]])('%f -> %f', (x, y) => expect(roundBand(x)).toBe(y));
});
it('speaking overall', () => expect(speakingOverall({ fc: 7, lr: 6, gra: 6, p: 6 })).toEqual({ raw: 6.25, band: 6.5 }));
it('writing weights task 2 double', () => {
  expect(writingOverall(6, 7)).toEqual({ raw: 20 / 3, band: 6.5 });
  expect(writingOverall(null, 7)).toEqual({ raw: 7, band: 7 });
});
```
`speech.test.ts` (synthetic words: helper `mk(list: [string, number, number, number?][])`):
```ts
import { it, expect } from 'vitest';
import { computeSpeechMetrics, type Word } from './speech';
const mk = (a: [string, number, number, number?][]): Word[] => a.map(([w, start, end, conf]) => ({ w, start, end, conf }));
it('detects short and long pauses, mid-clause flag', () => {
  const m = computeSpeechMetrics(mk([['I', 0, 0.2], ['like', 0.25, 0.5], ['the', 0.9, 1.0], ['city.', 1.1, 1.5], ['It', 2.8, 3.0]]), { durationS: 3 });
  expect(m.pauses.map(p => [p.kind, p.midClause])).toEqual([['short', true], ['long', false]]);
  expect(m.longPauses).toBe(1);
  expect(m.mlr).toBeCloseTo(5 / 3);
});
it('lexical fillers and repetitions and self-correction', () => {
  const m = computeSpeechMetrics(mk([['I', 0, .1], ['um', .2, .3], ['I', .35, .4], ['I', .45, .5], ['went', .55, .7], ['go', .75, .9], ['went', .95, 1.1]]), { durationS: 1.2 });
  expect(m.fillers.map(f => f.word)).toEqual(['um']);
  expect(m.repetitions.length).toBeGreaterThanOrEqual(1);
});
it('voiced gap from energy counts as filler', () => {
  const energy = Array.from({ length: 40 }, (_, i) => (i >= 10 && i < 20 ? 200 : i < 10 || i >= 30 ? 150 : 0)); // 50ms frames
  const m = computeSpeechMetrics(mk([['hello', 0, 0.45], ['there', 1.5, 1.9]]), { durationS: 2, energy, frameMs: 50, voiceThreshold: 60 });
  expect(m.fillers.some(f => f.kind === 'voiced')).toBe(true);
});
it('wpm series 10s windows 5s hop and unclear tiers', () => {
  const words = Array.from({ length: 60 }, (_, i) => ({ w: 'w', start: i * 0.5, end: i * 0.5 + 0.4, conf: i === 3 ? 0.3 : 0.95 }));
  const m = computeSpeechMetrics(words, { durationS: 30 });
  expect(m.wpmSeries[0]).toEqual({ t: 0, wpm: 120 });
  expect(m.wpmSeries.length).toBe(5);
  expect(m.unclear).toEqual([{ wordIdx: 3, w: 'w', conf: 0.3, tier: 3 }]);
});
it('empty words', () => expect(computeSpeechMetrics([], { durationS: 5 }).wordCount).toBe(0));
```
`text.test.ts`:
```ts
import { it, expect } from 'vitest';
import { computeTextMetrics, mtld, tokenize } from './text';
it('counts paragraphs, sentences, words', () => {
  const m = computeTextMetrics('First para. Has two sentences!\n\nSecond one?');
  expect([m.paragraphs, m.sentences, m.words]).toEqual([2, 3, 7]);
});
it('flags overused linkers (>=3 or >1.5 per 100 words)', () => {
  const m = computeTextMetrics('Moreover it is. Moreover it was. Moreover it will be.');
  expect(m.linkers.find(l => l.word === 'moreover')).toMatchObject({ count: 3, overused: true });
});
it('mtld higher for diverse text', () => {
  expect(mtld(tokenize('the cat the cat the cat the cat the cat the cat'))).toBeLessThan(mtld(tokenize('a quick brown fox jumps over lazy dogs while seven wizards quietly hex ancient boxes')));
});
```
`srs.test.ts`:
```ts
import { it, expect } from 'vitest';
import { review } from './srs';
const now = new Date('2026-01-01T00:00:00Z');
it('sm2 progression', () => {
  let s = { ease: 2.5, interval: 0, reps: 0, due: now };
  s = review(s, 4, now); expect(s.interval).toBe(1);
  s = review(s, 4, now); expect(s.interval).toBe(6);
  s = review(s, 4, now); expect(s.interval).toBe(15);
  s = review(s, 1, now); expect([s.reps, s.interval]).toEqual([0, 1]);
  expect(s.ease).toBeGreaterThanOrEqual(1.3);
});
```

- [ ] **Step 2:** Run `pnpm -F @ielts/core test`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`band.ts`:
```ts
export function roundBand(x: number): number {
  const f = Math.floor(x + 1e-9), frac = x - f + 1e-9;
  return frac < 0.25 ? f : frac < 0.75 ? f + 0.5 : f + 1;
}
export function speakingOverall(c: { fc: number; lr: number; gra: number; p: number }) {
  const raw = (c.fc + c.lr + c.gra + c.p) / 4; return { raw, band: roundBand(raw) };
}
export const taskBand = (c: { ta: number; cc: number; lr: number; gra: number }) => (c.ta + c.cc + c.lr + c.gra) / 4;
export function writingOverall(t1: number | null, t2: number | null) {
  const raw = t1 == null ? t2! : t2 == null ? t1 : (t1 + 2 * t2) / 3; return { raw, band: roundBand(raw) };
}
```
`speech.ts` algorithm (implement exactly):
1. Normalise each word: `norm = w.toLowerCase().replace(/[^a-z']/g, '')`. `endsClause = /[.!?,;:]$/.test(w) || next word norm ∈ {and, but, so, because, which, that, when, if, or}`.
2. Pauses: for i ≥ 1, `gap = start[i] - end[i-1]`. If `gap*1000 >= PAUSE_MS`, push a Pause with `kind = gap*1000 >= LONG_PAUSE_MS ? 'long' : 'short'`, `midClause = !endsClause(i-1)`. `voiced` = energy is given and ≥ 40% of the frames inside the gap are ≥ `voiceThreshold` (default 60).
3. Fillers: lexical, where a single `norm` ∈ FILLERS single-word entries, or a bigram ∈ FILLERS two-word entries (exclude "like" when the next word is a noun-ish word? No: count "like" only when it is followed or preceded by a pause ≥ 250 ms, otherwise skip). Voiced: every voiced pause with `dur*1000 ≥ VOICED_GAP_MS` adds `{ word: '(voiced)', time: pause.start, kind: 'voiced' }`.
4. Repetitions: for n in 3,2,1, if the n-gram at i equals the n-gram at i+n (norms, non-filler), push `{ phrase, time: start[i], wordIdx: i }` and skip ahead by n.
5. Self-corrections (repair pattern `A B … A C`): for i, if norm[i] === norm[j] for some j in i+2..i+4, and norm[i+1] !== norm[j+1], and none of those are fillers → push `{ time: start[j], wordIdx: j }`, skip i to j. Only this pattern counts.
6. `phonation = Σ(end-start)`. `speechRate = wordCount / (durationS/60)`. `articulationRate = wordCount / (phonation/60)`. `phonationRatio = phonation/durationS`. `pauseRatio = Σ pause.dur / durationS`. `mlr = wordCount / (pauses.length + 1)`.
7. `wpmSeries`: for `t = 0; t + WPM_WINDOW_S <= max(durationS, WPM_WINDOW_S); t += WPM_HOP_S`, count words with `start ∈ [t, t+10)`, `wpm = count*6`. `wpmStdDev` is over the series.
8. `unclear`: `conf < 0.6`; tier 3 if `< 0.4`, tier 2 if `< 0.5`, else 1.
9. `fillersPerMin = fillers.length / (durationS/60)`.
10. Guard: if `durationS <= 0` use 1 to avoid division by zero. Empty words return zeros and empty arrays.


`text.ts`: `tokenize = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []`. Paragraphs split on `/\n\s*\n/`, non-empty. Sentences are matches of `/[^.!?]+[.!?]+|[^.!?]+$/g`, trimmed and non-empty. MTLD (McCarthy & Jarvis): factor count forward plus backward, averaged, with TTR threshold 0.72. The partial factor is `(1 - ttr)/(1 - 0.72)`. Return `tokens.length / factors`, and 0 when there are no tokens. Linkers: count each LINKERS phrase with word-boundary regex over lowercased text; `overused = count >= 3 || count/words*100 > 1.5`. Only return linkers with count > 0. `repeated`: content words (length > 3, not in a 60-word stoplist) with count ≥ 4, sorted desc, top 10.

`srs.ts` (SM-2):
```ts
export function review(s: CardState, g: 0|1|2|3|4|5, now = new Date()): CardState {
  const ease = Math.max(1.3, s.ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)));
  if (g < 3) return { ease, reps: 0, interval: 1, due: new Date(now.getTime() + 864e5) };
  const reps = s.reps + 1;
  const interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(s.interval * ease);
  return { ease, reps, interval, due: new Date(now.getTime() + interval * 864e5) };
}
```
(Test expects the 3rd interval to be 15: `6 * 2.5 = 15` with ease unchanged at grade 4, since ease delta = 0.1 - 1*(0.08+0.02) = 0. ✔)

- [ ] **Step 4:** Run `pnpm -F @ielts/core test`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(core): band maths, speech/text metrics, SM-2`.

---

### Task 3: Server skeleton, env, DB schema, docker-compose Postgres, OpenAPI docs

**Files:**
- Create: `apps/server/package.json`, `tsconfig.json`, `drizzle.config.ts`, `src/{env.ts,app.ts,index.ts,db/schema.ts,db/client.ts}`, `src/app.test.ts`, `docker-compose.yml` (postgres service only for now)

**Interfaces (Produces):**
```ts
// env.ts
export const env: { DATABASE_URL: string; BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string; OPENROUTER_API_KEY: string;
  OPENAI_API_KEY?: string; R2_ACCOUNT_ID: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string; R2_BUCKET: string;
  RESEND_API_KEY?: string; EMAIL_FROM: string; CAMBRIDGE_ALLOWED_EMAILS: string[]; PORT: number; WEB_ORIGIN: string; NODE_ENV: string };
// db/client.ts
export const db: PostgresJsDatabase<typeof schema>;
// app.ts
export type AppEnv = { Variables: { user: { id: string; email: string; name: string } | null } };
export function createApp(): OpenAPIHono<AppEnv>;
```
Schema tables exactly as spec §3: `userSettings`, `prompts`, `attempts`, `analyses`, `mistakes`, `cards`. Better Auth tables are generated in Task 4. Use `pgEnum` for `skill`, `attempt_status`, `mode`, `prompt_source`. `prompts` has indexes `(skill, part)` and a unique index on `slug` (a normalised title, for idempotent seeding). `attempts` has an index `(userId, createdAt desc)`. IDs are `text` default `crypto.randomUUID()`.

- [ ] **Step 1: Failing test** `app.test.ts`:
```ts
import { it, expect } from 'vitest';
import { createApp } from './app';
it('health and openapi', async () => {
  const app = createApp();
  expect((await app.request('/api/health')).status).toBe(200);
  const spec = await (await app.request('/openapi.json')).json();
  expect(spec.openapi).toMatch(/^3\./);
  expect(spec.paths['/api/health']).toBeDefined();
});
```
- [ ] **Step 2:** Run `pnpm -F @ielts/server test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `app.ts` uses `new OpenAPIHono<AppEnv>()`, CORS for `WEB_ORIGIN` with credentials, and `app.doc31('/openapi.json', { openapi: '3.1.0', info: { title: 'IELTS Practice API', version: '1.0.0' } })`. Register the bearer security scheme `app.openAPIRegistry.registerComponent('securitySchemes','bearer',{type:'http',scheme:'bearer'})`. Mount `app.get('/docs', Scalar({ url: '/openapi.json' }))`. Add the `/api/health` route via `createRoute` returning `{ ok: true }`. Add a JSON error handler (`app.onError` → `{ error: message }`, status from HTTPException or 500). `env.ts` parses `process.env` with zod. In test mode (`NODE_ENV=test`), defaults are allowed for all secrets so tests run without `.env`. `docker-compose.yml` has the `db` service `postgres:17`, env `POSTGRES_PASSWORD=ielts POSTGRES_DB=ielts`, port `5432:5432`, and a named volume. Scripts: `dev: tsx watch src/index.ts`, `build: tsc -p .`, `test: vitest run`, `db:generate: drizzle-kit generate`, `db:migrate: drizzle-kit migrate`.
- [ ] **Step 4:** Tests PASS. `docker compose up -d db && pnpm -F @ielts/server db:generate && db:migrate` succeeds.
- [ ] **Step 5:** Commit `feat(server): hono openapi skeleton, env, drizzle schema`.

---

### Task 4: Auth (Better Auth + Resend + bearer), `/api/me`, settings

**Files:**
- Create: `src/auth.ts`, `src/email.ts`, `src/settings.ts`, `src/routes/me.ts`, `src/routes/settings.ts`, `src/test/helpers.ts`, `src/routes/settings.test.ts`
- Modify: `src/app.ts`, `src/db/schema.ts` (Better Auth tables via `npx @better-auth/cli generate` output pasted in)

**Interfaces (Produces):**
```ts
// auth.ts
export const auth: ReturnType<typeof betterAuth>; // emailAndPassword { enabled, requireEmailVerification: true in prod }, emailVerification.sendVerificationEmail, sendResetPassword, plugins: [bearer()], trustedOrigins: [WEB_ORIGIN]
export const sessionMiddleware: MiddlewareHandler<AppEnv>; // sets c.var.user (or null) via auth.api.getSession({ headers })
export const requireUser: MiddlewareHandler<AppEnv>;       // 401 JSON if no user
export const isCambridgeAllowed: (email: string) => boolean;
// settings.ts
export type Settings = { models: { analysis: string; examiner: string; stt: string; tts: string; ttsVoice: string; audioPron: string };
  audioPronEnabled: boolean; liveProvider: 'turn' | 'openai-realtime'; targetBand: number; writingAutoSubmit: boolean; blockPaste: boolean };
export const DEFAULT_SETTINGS: Settings; // analysis 'openai/gpt-5-mini', examiner 'openai/gpt-5-mini', stt 'openai/whisper-large-v3', tts 'openai/gpt-4o-mini-tts', ttsVoice 'alloy', audioPron 'google/gemini-2.5-flash', audioPronEnabled false, liveProvider 'turn', targetBand 7, writingAutoSubmit true, blockPaste true
export async function getSettings(userId: string): Promise<Settings>; // deep-merge row over defaults
export const SettingsSchema: z.ZodType<Settings>;
// test/helpers.ts
export async function testUser(email?: string): Promise<{ headers: Headers; user: { id: string; email: string } }>; // signs up via auth.api.signUpEmail with verification disabled in test, returns bearer header
```
Mount: `app.on(['GET','POST'], '/api/auth/*', c => auth.handler(c.req.raw))`, and `app.use('/api/*', sessionMiddleware)`. `GET /api/me` returns `{ user, settings, cambridgeAccess, realtimeAvailable: !!env.OPENAI_API_KEY }`. `GET/PUT /api/settings` (PUT takes a partial and validates model ids as `/^[\w.-]+\/[\w.:-]+$/`). `email.ts` has `sendEmail({to, subject, html})` via Resend; if the key is absent it logs to the console (dev). Default model ids must be checked against the live `/api/v1/models` list during implementation. If an id doesn't exist, pick the closest current equivalent and update `DEFAULT_SETTINGS`.

Tests need a real Postgres: `DATABASE_URL` points to `ielts_test`, and `vitest.setup.ts` runs migrations once and truncates tables between files. CI `check` gets a `services: postgres:17` container.

- [ ] **Step 1: Failing test** `settings.test.ts`: unauthenticated `GET /api/settings` → 401. With `testUser()` it returns `DEFAULT_SETTINGS`. `PUT {liveProvider:'openai-realtime', models:{analysis:'anthropic/claude-sonnet-5'}}` then GET reflects the change, and the other model defaults are preserved. `PUT {models:{analysis:'bad id!'}}` → 400.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement per the interfaces.
- [ ] **Step 4:** PASS. Update CI with the postgres service and `DATABASE_URL`.
- [ ] **Step 5:** Commit `feat(server): better-auth, settings, me`.

---

### Task 5: R2 storage + attempts routes

**Files:**
- Create: `src/storage.ts`, `src/routes/attempts.ts`, `src/jobs.ts` (stub `runAnalysis` that the next tasks fill), `src/routes/attempts.test.ts`

**Interfaces (Produces):**
```ts
// storage.ts
export const storage: { presignPut(key: string, contentType: string): Promise<string>; presignGet(key: string, expiresS?: number): Promise<string>;
  exists(key: string): Promise<boolean>; put(key: string, body: Uint8Array, contentType: string): Promise<void>; get(key: string): Promise<Uint8Array> };
export function setStorage(s: typeof storage): void; // test injection
// jobs.ts
export async function runAnalysis(attemptId: string): Promise<void>; // sets status analyzing→done|failed
export async function recoverStale(): Promise<void>;
export function setAnalyzer(fn: (attemptId: string) => Promise<void>): void; // test injection
```
Routes (all `requireUser`, security bearer):
- `POST /api/attempts` body `{ promptId, skill, part, mode, sessionId?, parentAttemptId?, text?, audioContentType? }`.
  - For speaking, it creates the attempt with `audioKey = audio/{userId}/{attemptId}.{ext}` (ext from content type: `audio/webm`→webm, `audio/mp4`→m4a, `audio/m4a`→m4a, `audio/wav`→wav) and returns `{ id, uploadUrl }`.
  - For writing it stores `text`.
  - It must verify the prompt is visible to the user (reuse `visiblePromptWhere` from Task 9; until then, put a local helper in `prompts.ts` and have Task 9 own it).
- `POST /api/attempts/:id/submit` body `{ durationMs, energy?: number[] (≤ 20k entries, 0-255), marks?: number[] (question-start offsets ms), text?, plan? }`. Add columns `attempts.energy jsonb`, `attempts.marks jsonb`, `attempts.plan text`.
  - Owner check. Speaking needs `storage.exists(audioKey)`, else 400 "Upload missing".
  - Sets status `analyzing`, fires `runAnalysis(id)` without awaiting, and returns `{ status: 'analyzing' }`.
  - The energy timeline is stored in `attempts.energy` (add a jsonb column).
- `GET /api/attempts/:id`: owner only (404 otherwise). Returns the attempt, the analysis or null, `audioUrl` (presigned GET) and `prompt`.
- `GET /api/attempts?skill&page`: 20 per page with overall band, newest first.

- [ ] **Step 1: Failing tests:** create speaking attempt → uploadUrl returned. Submit before upload → 400 (fake storage `exists` false). Submit after upload → `analyzing`, and the injected analyzer was called with the id. Another user's GET → 404. Writing attempt stores text.
- [ ] **Step 2:** FAIL. **Step 3:** Implement using `@aws-sdk/client-s3` endpoint `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region `auto`. **Step 4:** PASS. **Step 5:** Commit `feat(server): r2 storage and attempts API`.

---

### Task 6: OpenRouter client

**Files:**
- Create: `src/ai/openrouter.ts`, `src/ai/openrouter.test.ts`, `src/routes/models.ts`

**Interfaces (Produces):**
```ts
export type Fetch = typeof fetch;
export function setFetch(f: Fetch): void;
export async function chatJson<T>(o: { model: string; system: string; user: string | ContentPart[]; schema: z.ZodType<T>; schemaName: string; temperature?: number; timeoutMs?: number }): Promise<T>;
export async function chatText(o: { model: string; messages: { role: 'system'|'user'|'assistant'; content: string }[]; temperature?: number; maxTokens?: number }): Promise<string>;
export type SttWord = { w: string; start: number; end: number; conf?: number };
export async function transcribe(o: { model: string; audio: Uint8Array; format: 'webm'|'m4a'|'wav'|'mp3'|'ogg' }): Promise<{ text: string; words: SttWord[]; duration: number }>;
export async function speak(o: { model: string; voice: string; text: string }): Promise<{ audio: Uint8Array; contentType: string }>;
export async function listModels(): Promise<{ id: string; name: string; input: string[]; output: string[]; pricing: { prompt: string; completion: string } }[]>; // cached 1h
export type ContentPart = { type: 'text'; text: string } | { type: 'input_audio'; input_audio: { data: string; format: string } };
```
Behaviour:
- **Common:** header `Authorization: Bearer OPENROUTER_API_KEY`, `HTTP-Referer: BETTER_AUTH_URL`, `X-Title: IELTS Practice`. Timeout via AbortSignal.timeout (default 90 s). Retry once on 429/5xx after 1.5 s.
- **`chatJson`:** `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: z.toJSONSchema(schema) } }`. Parse `choices[0].message.content`, stripping ```json fences if present. Validate with zod. On failure, re-ask once, appending the assistant output and a user message `Your JSON failed validation: <issues>. Return corrected JSON only.` A second failure throws `AiError('invalid_json')`.
- **`transcribe`:** POST `/audio/transcriptions` JSON `{ model, input_audio: { data: base64, format }, language: 'en', response_format: 'verbose_json', timestamp_granularities: ['word','segment'] }`. Map `words[]` (`word`/`start`/`end`/`confidence` → `w`/`start`/`end`/`conf`). If per-word confidence is missing but segments have `avg_logprob`, set each word's `conf = exp(avg_logprob)` of its segment.
- **`speak`:** POST `/audio/speech` `{ model, input, voice, response_format: 'mp3' }` → bytes.
- **`/api/models?capability=`** (requireUser) filters `listModels()`:
  - `text`: output includes text
  - `audio-in`: input includes audio
  - `stt`: output includes transcription, or the id matches /whisper|transcribe/
  - `tts`: output includes audio/speech

  Use the `/models?output_modalities=all` endpoint.

- [ ] **Step 1: Failing tests** (fake fetch): `chatJson` happy path; `chatJson` gets invalid JSON first and then valid JSON, returning parsed (2 calls made; the 2nd request's messages contain "failed validation"); two invalid → throws; `transcribe` maps words/conf and the segment fallback; retry on 503 then success.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(server): openrouter client`.

---

### Task 7: Speaking analysis pipeline

**Files:**
- Create: `src/ai/descriptors.ts`, `src/ai/schemas.ts`, `src/ai/speaking.ts`, `src/ai/speaking.test.ts`
- Modify: `src/jobs.ts`

**Interfaces:**
- Consumes: `computeSpeechMetrics`, `speakingOverall`, `roundBand` (core); `transcribe`, `chatJson` (Task 6); `storage` (Task 5); `getSettings` (Task 4).
- Produces:
```ts
// schemas.ts
export const MISTAKE_CATEGORIES = ['grammar.article','grammar.tense','grammar.agreement','grammar.preposition','grammar.word-order','grammar.plural','grammar.sentence-structure','grammar.other','lexis.collocation','lexis.word-choice','lexis.word-form','lexis.spelling','lexis.repetition','cohesion.overuse','cohesion.missing','cohesion.reference','task.relevance','task.overview','task.position','pronunciation.word','fluency.hesitation'] as const;
export const CriterionSchema = z.object({ band: z.number().int().min(0).max(9), range: z.tuple([z.number(), z.number()]), descriptor: z.string(), evidence: z.array(z.string()).max(4), summary: z.string() });
export const ErrorSchema = z.object({ category: z.enum(MISTAKE_CATEGORIES), severity: z.enum(['minor','major']), start: z.number().int(), end: z.number().int(), original: z.string(), correction: z.string(), explanation: z.string() });
export const FixSchema = z.object({ title: z.string(), why: z.string(), before: z.string(), after: z.string() });
export const SpeakingLlmSchema = z.object({ criteria: z.object({ fc: CriterionSchema, lr: CriterionSchema, gra: CriterionSchema, p: CriterionSchema }), topFixes: z.array(FixSchema).length(3), errors: z.array(ErrorSchema).max(40), relevance: z.array(z.object({ questionIdx: z.number().int(), onTopic: z.boolean(), note: z.string() })), vocabUpgrades: z.array(z.object({ original: z.string(), better: z.array(z.string()).max(3), note: z.string() })).max(8), rewrite: z.string() });
export const PronLlmSchema = z.object({ words: z.array(z.object({ word: z.string(), time: z.number(), issue: z.enum(['sound','stress','intonation','unclear']), tip: z.string() })).max(20), prosody: z.string(), band: z.number().int().min(0).max(9) });
export type AnalysisResult = { v: 1; skill: 'speaking'|'writing'; overall: number; overallRaw: number; range: [number, number];
  criteria: Record<string, z.infer<typeof CriterionSchema>>; topFixes: z.infer<typeof FixSchema>[];
  errors: (z.infer<typeof ErrorSchema> & { id: string; time?: number })[];
  words?: SttWord[]; metrics?: SpeechMetrics; pronunciation?: { unclear: SpeechMetrics['unclear']; llm?: z.infer<typeof PronLlmSchema> };
  relevance?: z.infer<typeof SpeakingLlmSchema>['relevance']; vocabUpgrades?: z.infer<typeof SpeakingLlmSchema>['vocabUpgrades'];
  structure?: WritingStructure; cohesion?: TextMetrics['linkers']; textMetrics?: TextMetrics;
  rewrite: { text: string; note: string }; noSpeech?: boolean; comparison?: { parentAttemptId: string; parentOverall: number; deltas: Record<string, number> } };
// speaking.ts
export async function analyzeSpeaking(i: { audio: Uint8Array; format: string; durationMs: number; energy?: number[]; questions: string[]; part: 1|2|3; settings: Settings }): Promise<AnalysisResult>;
```
`descriptors.ts` exports `SPEAKING_DESCRIPTORS` and `WRITING_DESCRIPTORS`: condensed band 4–9 text per criterion, copied from `docs/research.md` §1 and extended for bands 4 and 9 from the official PDFs.

Pipeline:
1. `transcribe`. Zero words → return `{ noSpeech: true, overall: 0, … }` with empty criteria/errors and the rewrite note "No speech detected". Do not call chat.
2. `metrics = computeSpeechMetrics(words, { durationS: durationMs/1000, energy, frameMs: 50 })`.
3. If `settings.audioPronEnabled`: `chatJson` with `settings.models.audioPron`, content `[text: instructions + transcript, input_audio: base64]`, schema `PronLlmSchema`. On failure, continue without it (log).
4. Build the rubric prompt:
   - The system prompt is a strict senior IELTS examiner. Rules: a band is awarded only if ALL its positive features are met (else lower); cite the matching descriptor phrase verbatim in `descriptor`; the `range` is ±0.5 honest uncertainty; never inflate; transcript-only judgments of pronunciation must rely on the given evidence.
   - The user message is JSON with the part, questions, and `transcript` as `"[0]I [1]like [2]the …"` (word indices), the metrics summary (rounded numbers only, no arrays except the long pause positions), unclear words, the pron LLM result, and `SPEAKING_DESCRIPTORS`.
   - Ask for `errors` with word-index `start/end` (inclusive) and exactly 3 `topFixes` targeting the most band-limiting patterns. The `rewrite` is a band+1 version of THEIR answer in their voice, keeping their ideas.
5. Assemble: `errors[i].time = words[start].start`, `id = e{i}`. `overall = speakingOverall(...)`. `range = [roundBand(Σ range lo /4), roundBand(Σ hi /4)]`. `pronunciation.unclear = metrics.unclear`. `rewrite = { text, note: "Study the upgrades, don't memorise — examiners penalise rehearsed answers." }`.

`jobs.ts` `runAnalysis`:
- Load the attempt, prompt and settings; get the audio from storage.
- Question list: P1/P3 → `prompt.followUps` or `[prompt.body]`; P2 → cue card title + bullets.
- Call `analyzeSpeaking` or `analyzeWriting`.
- If `parentAttemptId`: compute `comparison.deltas` per criterion vs the parent analysis.
- Insert `analyses`, and insert `mistakes` rows from errors (category, original, correction, explanation).
- Set status `done`. On catch: `failed` + `error` message (`AiError` message is user-readable).

`recoverStale`: `update attempts set status='failed', error='Interrupted, retry' where status='analyzing' and updated_at < now()-10min`.

- [ ] **Step 1: Failing tests** (fake fetch routing by URL: `/audio/transcriptions` returns 6 words with timestamps; `/chat/completions` returns fixture JSON matching `SpeakingLlmSchema` with criteria fc 7, lr 6, gra 6, p 6):
  - The result has `overall` 6.5 and `overallRaw` 6.25, `errors[0].time === words[errors[0].start].start`, and exactly 3 topFixes.
  - Empty transcription → `noSpeech: true` and the chat fetch is never called.
  - With `audioPronEnabled: true`, the chat is called twice and the first request body contains `input_audio`.
  - When pron chat fails (500 twice), the analysis still succeeds without `pronunciation.llm`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(server): speaking analysis pipeline`.

---

### Task 8: Writing analysis pipeline

**Files:**
- Create: `src/ai/writing.ts`, `src/ai/writing.test.ts`
- Modify: `src/ai/schemas.ts` (add `WritingLlmSchema`, `WritingStructure`), `src/jobs.ts` (writing branch)

**Interfaces (Produces):**
```ts
export const WritingLlmSchema = z.object({ criteria: z.object({ ta: CriterionSchema, cc: CriterionSchema, lr: CriterionSchema, gra: CriterionSchema }),
  topFixes: z.array(FixSchema).length(3), errors: z.array(ErrorSchema.omit({ start: true, end: true }).extend({ quote: z.string() })).max(40),
  structure: z.object({ paragraphs: z.array(z.object({ role: z.enum(['intro','overview','body','conclusion','greeting','closing','other']), topicSentence: z.string(), ok: z.boolean(), note: z.string() })),
    overview: z.object({ present: z.boolean(), mainTrends: z.boolean(), noData: z.boolean(), note: z.string() }).nullable(),
    position: z.object({ clear: z.boolean(), consistent: z.boolean(), note: z.string() }).nullable(),
    planFollowed: z.object({ followed: z.boolean(), note: z.string() }).nullable() }),
  vocabUpgrades: SpeakingLlmSchema.shape.vocabUpgrades, rewrite: z.string() });
export type WritingStructure = z.infer<typeof WritingLlmSchema>['structure'];
export async function analyzeWriting(i: { text: string; task: 1|2; variant: 'academic'|'general'; prompt: { title: string; body: string; bullets?: string[]; chart?: unknown }; plan?: string; settings: Settings }): Promise<AnalysisResult>;
```
Rules:
- `wordCount ≤ 20` → return Band 1 on all criteria with the descriptor "Responses of 20 words or fewer are rated at Band 1". No LLM call.
- Under the minimum words, tell the LLM the count and that TA/TR must be penalised.
- The LLM returns `quote` (an exact substring). The server maps each to char `start/end` via `text.indexOf(quote, cursor)`, searching from the previous match and falling back to the start. Unmatched errors are kept with `start: -1` (shown in the list, not inline).
- `overall` = `roundBand(taskBand(criteria))`, and `overallRaw` is the raw mean.
- Add `textMetrics = computeTextMetrics(text)` and `cohesion = textMetrics.linkers`.
- The chart JSON (T1 generated) is included so the LLM can check data accuracy.
- The plan comes from `attempts.plan` (Task 5).

- [ ] **Step 1: Failing tests:** a 15-word essay → Band 1 and zero fetch calls. A normal essay with the fixture returning a quote → correct `start/end` slice equality `text.slice(start,end) === quote`. `overall` rounding: ta 6, cc 7, lr 6, gra 6 → raw 6.25 → 6.5.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(server): writing analysis pipeline`.

---

### Task 9: Prompt bank — routes, gating, generation + seed

**Files:**
- Create: `src/routes/prompts.ts`, `src/routes/prompts.test.ts`, `scripts/gen-bank.ts`, `scripts/seed-bank.ts`, `data/bank/speaking.json`, `data/bank/writing.json`

**Interfaces (Produces):**
```ts
export function visiblePromptWhere(user: { email: string }): SQL; // or(eq(prompts.restricted,false), inArray-check via isCambridgeAllowed ? sql`true` : ...)
export type BankSpeaking = { p1: { topic: string; questions: string[] }[]; p2: { slug: string; topic: string; title: string; bullets: string[]; explain: string; followUps: string[]; p3: string[] }[]; p3: { topic: string; questions: string[] }[] };
export type BankWriting = { t2: { slug: string; topic: string; type: 'opinion'|'discussion'|'problem-solution'|'adv-disadv'|'two-part'; body: string }[];
  t1Academic: { slug: string; topic: string; type: 'line'|'bar'|'pie'|'table'|'mixed'|'process'|'map'; body: string; chart: ChartSpec }[];
  t1General: { slug: string; topic: string; type: 'letter-formal'|'letter-semi'|'letter-informal'; body: string; bullets: string[] }[] };
export type ChartSpec =
  | { kind: 'line'|'bar'; title: string; xLabel: string; yLabel: string; unit: string; categories: string[]; series: { name: string; values: number[] }[] }
  | { kind: 'pie'; title: string; unit: string; pies: { name: string; slices: { label: string; value: number }[] }[] }
  | { kind: 'table'; title: string; columns: string[]; rows: (string|number)[][] }
  | { kind: 'process'; title: string; steps: string[] }
  | { kind: 'map'; title: string; before: { label: string; features: string[] }; after: { label: string; features: string[] } };
```
Routes:
- `GET /api/prompts?skill&part&variant&type&topic&source&q&page`: 30/page. `done` = exists attempt by user. `q` = `ilike` on title/body. `source=cambridge` for a non-allowed user → empty.
- `GET /api/prompts/:id`: 404 when not visible. `imageUrl` is presigned when `imageKey`.
- `GET /api/prompts/meta`: distinct topics and types per skill/part (for filters).
- `GET /api/speaking/test?source=generated|cambridge|any`: picks a random P1 group with 3 topics × 4 questions (3 random P1 rows), plus a random P2 card and its linked P3 (`groupId`), and returns `{ part1: Prompt[], part2: Prompt, part3: Prompt }`. It prefers prompts the user hasn't done.

Seeding maps the bank into rows:
- Speaking P1: one row per topic, `body` = the first question, `followUps` = all questions.
- P2: row with `bullets` and `followUps`, `groupId = slug`.
- P3 linked: row `part 3`, `groupId = slug`, `followUps = p3`.
- Standalone P3: rows.
- `slug` is the unique key, and `onConflictDoUpdate` makes the seed idempotent.

`gen-bank.ts`:
- Calls OpenRouter (`anthropic/claude-sonnet-4.5` or current best text model) in batches of 10 with topic lists covering the common IELTS themes: education, technology, environment, health, work, family, cities, travel, media, crime, government, culture, sport, food, science, space, advertising, transport, housing, tourism, globalisation, ageing, animals, art, history, languages, money, shopping, fashion, friends, hometown, weather, music, reading, childhood, festivals, and more.
- Schema-validated with zod and deduped by slug. It writes JSON files that are committed.
- Target counts are from spec §8.
- Chart values must be internally consistent (pie slices sum to 100).
- **The implementer runs this once with the real key** and commits the JSON. Seeding runs at container start (`node dist/scripts/seed-bank.js` in the entrypoint, idempotent).

- [ ] **Step 1: Failing tests:** seed 2 generated rows + 1 restricted row. User `a@x.com` list → 2, `GET` restricted id → 404, `source=cambridge` → []. User `soyebjim@gmail.com` → 3 and GET → 200. `/api/speaking/test` returns a linked part3 whose `groupId` equals part2's.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Run `pnpm tsx scripts/gen-bank.ts` (real key), then check the counts with `jq '.p2|length' data/bank/speaking.json` etc. against the targets. Commit `feat: prompt bank, gating, generator + data`.

---

### Task 10: Live examiner (turn-based + OpenAI Realtime token + finish)

**Files:**
- Create: `src/ai/examiner.ts`, `src/ai/examiner.test.ts`, `src/routes/live.ts`

**Interfaces (Produces):**
```ts
export type LiveState = { sessionId: string; phase: 'intro'|'p1'|'p2-prep'|'p2-talk'|'p2-follow'|'p3'|'closing'|'done';
  phaseStartedAt: number; p1Topics: string[]; p1Asked: number; p2PromptId: string; p3Asked: number;
  history: { role: 'examiner'|'candidate'; text: string; at: number; audioKey?: string; phase: LiveState['phase'] }[] };
export function nextPhase(s: LiveState, now: number): LiveState['phase']; // pure timing rules
export const EXAMINER_SYSTEM: (s: LiveState, test: { part1: Prompt[]; part2: Prompt; part3: Prompt }) => string;
export function realtimeInstructions(test: …): string;
```
Timing rules (pure, tested):
- intro → p1 after the candidate answers the name question.
- p1 lasts until 4.5 min elapsed in p1 or 3 topics × ~4 questions asked.
- p2-prep: exactly 60 s (the client shows the countdown; the server sets `phaseStartedAt`).
- p2-talk: until the candidate stops (the VAD turn ends) or 120 s. At ≥ 120 s the examiner says "Thank you, that's the end of your time" (the client hard-stops the mic at 120 s).
- p2-follow: 1 question.
- p3: until 4.5 min or 6 questions.
- closing: "That is the end of the speaking test".

Routes:
- `POST /api/live/start` `{ source? }`: builds the test via the same picker as `/speaking/test`, creates state (stored in the `live_sessions` table: `id`, `userId`, `state` jsonb, `createdAt`; add to schema), and returns the examiner's first line + TTS audio URL.
- `POST /api/live/turn` `{ sessionId, audioKey?, skipped?: boolean }`: transcribes the candidate audio (if any) and appends it to history. It computes the phase with `nextPhase`, calls `chatText(models.examiner, EXAMINER_SYSTEM + history)` → examiner line (≤ 2 sentences, never feedback), runs TTS → R2 `live/{sessionId}/{n}.mp3`, and returns `{ examinerText, audioUrl, phase, prepSeconds?: 60, cueCard?: Prompt }` (cueCard at the p2-prep transition).
- Upload URL: `POST /api/live/upload-url { sessionId }` → `{ key, uploadUrl }`.
- `POST /api/live/realtime-token { sessionId }`: 400 if there is no `OPENAI_API_KEY`. POST `https://api.openai.com/v1/realtime/client_secrets` with `{ session: { type: 'realtime', model: 'gpt-realtime', instructions: realtimeInstructions(test), audio: { output: { voice: 'marin' } } } }` and returns `{ value, expiresAt, model }`. (Verify the endpoint and shape with context7/OpenAI docs during implementation; adjust to the current API.)
- `POST /api/live/finish` `{ sessionId, parts: { part: 1|2|3, audioKey: string, durationMs: number, energy?: number[], questions: string[] }[] }`: creates one attempt per part (mode `live`, shared `sessionId`, `promptId` = that part's prompt) and fires `runAnalysis` each. Returns the attempt ids. The client records locally and uploads one file per part (web: restart MediaRecorder at part changes).

- [ ] **Step 1: Failing tests** for `nextPhase`: intro→p1 after 1 candidate turn; p1→p2-prep after 12 asked; p2-prep→p2-talk at +60 s; p2-talk→p2-follow at 120 s; p3→closing after 6 asked. Route test with fake fetch: start → turn → phase advances, and the history grows by 2.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(server): live examiner`.

---

### Task 11: Progress, mistakes, cards routes

**Files:** Create `src/routes/{progress,mistakes,cards}.ts`, `src/routes/progress.test.ts`

**Interfaces (Produces):**
- `GET /api/progress?skill` → `{ trend: { date, overall, criteria }[] (last 30 done attempts), streak: number (consecutive days with ≥1 done attempt ending today or yesterday), minutesThisWeek, attempts: number, weakest: { key, avg } | null, topMistakes: { category, count }[] (top 5, last 30 days), predicted: { speaking: number|null, writing: number|null } (roundBand of the mean of the last 5 overalls) }`.
- `GET /api/mistakes?category&page` → grouped counts + list with attempt links.
- `POST /api/cards { front, back, source }`, `GET /api/cards/due` (due ≤ now, limit 50), `POST /api/cards/:id/review { grade }` → `srs.review` persisted.
- `POST /api/mistakes/:id/card` → creates a card with front `original`, back `correction — explanation`.

- [ ] **Step 1: Failing tests:** streak across 3 consecutive days = 3 and a gap resets it. weakest = the lowest average criterion. A card review of grade 4 twice → interval 6.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(server): progress, mistakes, SRS cards`.

---

### Task 12: Web scaffold — Vite, router, auth, API client, layout, design tokens

**Files:** Create `apps/web/{package.json,vite.config.ts,index.html,tsconfig.json}`, `src/{main.tsx,router.tsx,api.ts,auth.ts,styles.css}`, `src/components/{Layout,Empty}.tsx`, `src/routes/{login,signup,index}.tsx`, `scripts/export-openapi.ts`

**Interfaces (Produces):**
```ts
// api.ts
import createClient from 'openapi-fetch'; import type { paths } from './schema';
export const api = createClient<paths>({ baseUrl: '', credentials: 'include' });
export function useMe(): UseQueryResult<MeResponse>;
// auth.ts
export const authClient = createAuthClient({ baseURL: window.location.origin }); // better-auth/react
```
- `scripts/export-openapi.ts` imports `createApp`, writes `apps/web/src/openapi.json` and `apps/ios/IELTS/API/openapi.json`. Then `openapi-typescript apps/web/src/openapi.json -o apps/web/src/schema.d.ts`. Add root script `pnpm gen:api`. CI runs it and fails if the git diff is non-empty.
- The Vite dev proxy sends `/api` → `http://localhost:8787`.
- **Design tokens** in `styles.css` (`@theme`):
  - Font: Inter variable for UI plus a serif (Source Serif 4) for the reading passages and essays.
  - Colours: warm neutrals (`--color-bg #FAF9F7`, `--color-surface #FFFFFF`, `--color-ink #1C1B19`, `--color-muted #6B6660`, `--color-line #E8E4DE`), accent `#3B5BDB`, good `#2F9E44`, warn `#E8890C`, bad `#E03131`.
  - Dark variants under `.dark` and `prefers-color-scheme`.
  - Radius 14px, shadows subtle.
- **Layout:** desktop left sidebar (Dashboard, Speaking, Writing, Prompt bank, Mistakes, Review, History, Settings) plus theme toggle; mobile bottom tab bar (Home, Speak, Write, Review, More). An `ExamShell` variant hides navigation.
- Auth pages: email/password sign in and up, forgot password, and a "check your email" state. Route guard redirects to `/login`.

- [ ] **Step 1:** `pnpm -F @ielts/web build` and `typecheck` pass. Manual: `pnpm dev`, sign up, see the empty dashboard.
- [ ] **Step 2:** Commit `feat(web): scaffold, auth, layout, tokens`.

---

### Task 13: Web speaking practice — recorder, VAD energy, session flow

**Files:** Create `src/hooks/{useRecorder.ts,useCountdown.ts}`, `src/hooks/useRecorder.test.ts`, `src/components/{MicButton,Timer,Waveform}.tsx`, `src/routes/{speaking.tsx,speaking.session.tsx}`

**Interfaces (Produces):**
```ts
export type RecorderState = 'idle'|'requesting'|'denied'|'unsupported'|'recording'|'stopped';
export function useRecorder(): { state: RecorderState; error?: string; start(): Promise<void>; stop(): Promise<{ blob: Blob; mime: string; durationMs: number; energy: number[] }>;
  level: number /*0..1 live*/; elapsedMs: number; liveWpm: number; silenceMs: number };
export function pickMime(): string; // first supported of audio/webm;codecs=opus, audio/mp4, audio/webm
export function useCountdown(seconds: number, opts?: { onEnd?: () => void }): { left: number; running: boolean; start(): void; stop(): void; reset(): void };
```
- **Recorder:**
  - `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`.
  - AudioContext AnalyserNode, sampled every 50 ms → RMS → byte 0–255 pushed to `energy` and `level`.
  - `liveWpm` is estimated from syllable-like energy peaks over the last 10 s (peaks/1.5 × 6). *ponytail:* rough, it is just a pacing hint.
  - `NotAllowedError` → `denied` with the message "Microphone blocked — allow it in the browser's site settings and retry". No mediaDevices → `unsupported`.
- **Session flow** `/speaking/session/$id?mode=full|p1|p2|p3`:
  - Fetch `/api/speaking/test` (full) or a random prompt of that part.
  - For each question: show the question card; press the mic → record; the timer ring shows zone colours from `SPEAKING_ZONES`; a silence ≥ 3 s shows a gentle "Keep going…" chip.
  - Press "Next": `POST /attempts` → PUT the blob to `uploadUrl` → submit (P1/P3: all questions of a part go into ONE recording with "Next question" markers sent as `marks` in submit (Task 5); `runAnalysis` passes question boundaries to the LLM by splitting transcript words at marks).
  - P2: prep screen with a 60 s countdown and a notes textarea, then auto-start recording with a hard stop at 120 s.
  - After the last part, go to the session result `/speaking/result/$attemptId?session=…` showing an analyzing state (poll every 2 s) with a progress list of steps (Transcribing, Measuring fluency, Scoring).
- Use `@ielts/core` constants directly (workspace import).

- [ ] **Step 1: Failing test** (vitest + jsdom with `navigator.mediaDevices.getUserMedia` rejecting `NotAllowedError`): `start()` → state `denied` with a message; no fetch is made.
- [ ] **Step 2–4:** FAIL → implement → PASS. Manual: record a real 20 s answer and the attempt reaches `done` (needs keys).
- [ ] **Step 5:** Commit `feat(web): speaking practice flow`.

---

### Task 14: Web results page (speaking + writing shared shell)

**Files:** Create `src/components/{BandGauge,Tabs,Transcript,WpmChart,ErrorCard,FixCard}.tsx`, `src/routes/speaking.result.tsx`, `src/lib/result.ts`, `src/lib/result.test.ts`

**Interfaces (Produces):**
```ts
// lib/result.ts
export type Token = { i: number; w: string; start: number; end: number; conf?: number; errorIds: string[]; filler?: boolean; pauseAfter?: Pause };
export function buildTokens(r: AnalysisResult): Token[]; // merges words, errors spans, pauses (pause attached to preceding word), fillers
export function criterionLabel(k: string): string; // fc→"Fluency & Coherence", lr→"Lexical Resource", gra→"Grammar", p→"Pronunciation", ta→"Task Achievement/Response", cc→"Coherence & Cohesion"
export function bandColor(b: number, target: number): 'good'|'warn'|'bad';
```
- **Overview tab:**
  - A big overall band with a range chip "likely 6–7" and the raw value.
  - 4 `BandGauge` cards (semi-circle), each with the descriptor quote in italics and a short summary.
  - "3 things to fix next" `FixCard`s showing before → after.
  - For a retry, a comparison strip with the delta arrows.
- **Transcript tab:**
  - Audio player (sticky). Tokens are rendered inline; unclear words are tinted by tier (amber/red underline dotted); errors are underlined red/amber by severity; pause chips `⏸ 1.4s` (long ones red); fillers greyed with a strikethrough style.
  - Clicking a token seeks `audio.currentTime = start - 0.3` and plays.
  - Clicking an error opens a popover/sheet with the original → correction, explanation, "Play this bit" and "Add to review deck".
  - The currently spoken word is highlighted during playback (timeupdate).
  - Filter chips: All · Grammar · Vocabulary · Pauses · Fillers · Unclear.
- **Fluency tab:**
  - `WpmChart` (Recharts `AreaChart` of `wpmSeries`, with a shaded reference band of 120–160 labelled "band-7 zone (heuristic)").
  - A pause timeline strip (the full duration bar with pause marks coloured by length; click to seek).
  - A stat grid: speech rate, articulation rate, MLR, pause ratio, long pauses, mid-clause pauses, fillers/min, repetitions, self-corrections, WPM variability (std dev with the note "big swings = uneven pace").
  - Each stat has an ⓘ explanation and a green/amber/red indicator vs the band-7 heuristic.
- **Language tab:**
  - Errors grouped by category with counts (bar list), each expandable.
  - Vocabulary upgrades.
  - Lexical diversity (MTLD) with a gauge.
  - Overused words.
  - Relevance per question (✓ on-topic / ⚠ off-topic + note).
  - Pronunciation: unclear words list with play buttons, plus the LLM prosody note if present. The label reads "Pronunciation hints are estimates from speech recognition, not a phoneme-level assessment."
- **Improve tab:**
  - The band+1 rewrite with a "don't memorise" note.
  - "Retry this question" → a new attempt with `parentAttemptId`.
  - "Add all top fixes to review deck".
- **Session view** (`?session=`): a part switcher (P1/P2/P3) and a session-level overall.
- Failed state: the message plus a "Retry analysis" button (POST submit again).

- [ ] **Step 1: Failing test** `result.test.ts`: `buildTokens` attaches error ids to the spanned words, the pause to the preceding word, and flags fillers.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(web): interactive results`.

---

### Task 15: Web writing — home, editor, results

**Files:** Create `src/routes/{writing.tsx,writing.task.tsx,writing.result.tsx}`, `src/components/{ChartRenderer,WritingEditor}.tsx`, `src/components/WritingEditor.test.tsx`

- **Writing home:** start "Full test (60 min)", "Task 1 Academic", "Task 1 General", "Task 2", or pick from the bank. Filters by type and topic, with a "done" badge.
- **Editor screen (ExamShell):**
  - Left: the prompt (chart via `ChartRenderer`, or the Cambridge image).
  - Right: `WritingEditor`, a textarea with all the no-autocorrect attributes from the global constraints. `onPaste` → `preventDefault()` when `settings.blockPaste`, showing a toast "Pasting is disabled in exam mode". Autosaves to localStorage every 5 s (key `draft:{promptId}`, try/catch).
  - Top bar: countdown (amber ≤ 300 s, red ≤ 60 s), live word count (red under the minimum), and a "Submit" button with a confirm.
  - At 0 with `writingAutoSubmit` → submit. Otherwise the time turns red, counts up as "overtime", and the result is flagged overtime.
  - T2: an optional collapsible "Plan (5 min)" pad sent as `plan`.
  - Full test: T1 then T2 in tabs sharing the 60-minute timer, submitted as 2 attempts with the same `sessionId`.
- **`ChartRenderer`:** line/bar (Recharts), pie (multiple pies side by side), table (HTML), process (numbered step flow with arrows), map (two side-by-side feature lists with labels).
- **Results:** the same shell as Task 14. Tabs: Overview · Essay (text with inline highlights by char span; click → explanation card; unmatched errors listed below) · Structure (paragraph map cards with role, topic sentence and ok/note; overview/position/plan checks as ✓/✗ rows) · Language (linkers bar list with overused flags, MTLD, repeated words, vocab upgrades, sentence length) · Improve (the rewrite with a word-level diff vs the original essay using `diffWords` from the `diff` package, plus Retry).

- [ ] **Step 1: Failing test** `WritingEditor.test.tsx`: the rendered textarea has `spellcheck="false"`, `autocorrect="off"`, `autocapitalize="off"`, `data-gramm="false"`; a paste event is prevented when blockPaste; the word count updates.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(web): writing practice and results`.

---

### Task 16: Web live examiner

**Files:** Create `src/routes/speaking.live.tsx`, `src/hooks/useVad.ts`, `src/live/{turn.ts,realtime.ts}`

- **Pre-screen:** shows the chosen provider (from settings, and whether realtime is available per `/me`), a mic check (level meter) and a "Start test" button.
- **`useVad`:** built on the recorder level. A speech start is level > threshold for 150 ms; a turn ends after 1.2 s below the threshold following speech. A "I'm done" button forces the end of the turn.
- **Turn-based (`turn.ts`):** loop:
  1. Play the examiner audio (captions shown).
  2. Record the candidate.
  3. On turn end, upload via `/live/upload-url` and POST `/live/turn`.
  4. Repeat until the phase is `done`.

  At `p2-prep`, show the cue card with a 60 s countdown and a notes pad, then the examiner says "please begin". The mic hard-stops at 120 s.

  The whole-part recording: a separate `MediaRecorder` per part (started when the phase enters p1, p2-talk and p3; stopped at the part change) is uploaded at the end via `/live/finish`. A "thinking…" indicator shows while waiting.
- **Realtime (`realtime.ts`):** fetch `/live/realtime-token`. `RTCPeerConnection` with the mic track, remote audio into an `<audio autoplay>`, and a data channel `oai-events`. POST the SDP offer to `https://api.openai.com/v1/realtime/calls` with `Authorization: Bearer <ephemeral>`, content-type `application/sdp`. (Verify the current URL in the docs.) Transcript captions come from the `response.output_audio_transcript.delta` events. Part changes are driven by the client timers (4.5 min P1, 60 s prep + 2 min P2, 4.5 min P3), sending `session.update`/`conversation.item.create` system nudges ("Move to Part 2 now; cue card: …"). Local per-part recordings are made the same way as turn-based and go to `/live/finish`.
- **UI:** a large examiner avatar circle pulsing while speaking, the phase label ("Part 1 · Introduction and interview"), an elapsed timer, captions (toggleable, off by default for realism), and an "End test" button.

- [ ] **Step 1:** Unit test `useVad` with a synthetic level sequence: speech 0.3 s, silence 1.3 s → one `onTurnEnd`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Manual: a full turn-based run with real keys reaches results.
- [ ] **Step 5:** Commit `feat(web): live examiner (turn + realtime)`.

---

### Task 17: Web dashboard, bank, mistakes, review, history, settings

**Files:** Create `src/routes/{index,bank,mistakes,review,history,settings}.tsx`, `src/components/ModelPicker.tsx`

- **Dashboard:**
  - A greeting with the streak flame count and minutes this week.
  - Two "predicted band" cards (Speaking, Writing) with a sparkline trend.
  - A per-criterion trend chart (tabs Speaking/Writing).
  - "Your weakest area: Grammar (5.5) → Practice: Part 3 discussion" CTA.
  - Top recurring mistakes (with a link to the error log).
  - Quick start buttons: Full speaking test · Live examiner · Task 2 essay.
  - Review due count.
  - Empty state for new users: a 3-step onboarding (set target band → try Part 1 → try Task 2).
- **Bank:** search, filter chips (skill, part/task, type, topic, source; the Cambridge chip only when `cambridgeAccess`), a list with done badges, and a "Practice" button.
- **Mistakes:** category chips with counts; each item shows original → correction, explanation, a link to the attempt at that time/offset, and "Add to deck".
- **Review:** flashcard (front → tap reveal → grade buttons Again(1)/Hard(3)/Good(4)/Easy(5)) and a due count; empty state "All caught up".
- **History:** list of attempts (skill icon, prompt title, date, band chip, status), infinite scroll.
- **Settings:**
  - Target band slider.
  - Writing: auto-submit toggle and block-paste toggle.
  - Live provider radio ("Turn-based (OpenRouter)" / "OpenAI Realtime", disabled with a hint if not available).
  - "AI models" section: one `ModelPicker` per role (analysis/examiner: capability text; stt; tts + voice select; audio pronunciation toggle + picker with capability audio-in). `ModelPicker` is a searchable combobox listing id, name and price per 1M tokens, with a "Reset to default" option.
  - Account: email, sign out, delete account (Better Auth `deleteUser`, with a confirm dialog).

- [ ] **Step 1:** Typecheck/build pass. Playwright smoke test (`apps/web/e2e/smoke.spec.ts`): sign up → dashboard empty state visible → settings change of target band persists after reload → bank lists prompts.
- [ ] **Step 2:** Commit `feat(web): dashboard, bank, mistakes, review, history, settings`.

---

### Task 18: Docker image, compose, backups, CI docker job

**Files:** Create `Dockerfile`, `docker/entrypoint.sh`, `docker/backup.sh`. Modify `docker-compose.yml`, `.github/workflows/ci.yml`, `apps/server/src/index.ts` (serve static)

- `Dockerfile`: multi-stage node:22-alpine. Stage `build`: pnpm install, build core/server/web. Stage `run`: copy `apps/server/dist`, `apps/web/dist`, `data/bank`, `drizzle/`, prod node_modules (`pnpm deploy --prod`), then `ENTRYPOINT entrypoint.sh`.
- `entrypoint.sh`: run migrations (drizzle-orm `migrate()` in `dist/migrate.js`), then the seed, then the server.
- `index.ts`: `serveStatic({ root: WEB_DIST })` for non-`/api` paths, with an SPA fallback to `index.html`. Calls `recoverStale()` on boot.
- `compose`: `app` (image `ghcr.io/soyeb-jim285/ielts-practice:latest`, `env_file .env`, port 8787, depends_on db healthy), `db` (postgres:17 healthcheck `pg_isready`), and `backup` (postgres:17 image with `aws` cli; loop: daily `pg_dump | gzip` → `aws s3 cp` to R2 `backups/YYYY-MM-DD.sql.gz` with `--endpoint-url`).
- CI job `docker` (needs check, only on main): docker/login-action to ghcr with GITHUB_TOKEN, build-push-action tags `latest` + `sha`, and `permissions: packages: write`.

- [ ] **Step 1:** `docker compose build && docker compose up -d`, then `curl localhost:8787/api/health` returns `{"ok":true}` and `/docs` renders.
- [ ] **Step 2:** Commit `feat: docker image, compose, backups, CI publish`, push, and watch CI go green.

---

### Task 19: iOS app (SwiftUI)

**Files:** Create `apps/ios/project.yml`, `apps/ios/IELTS/{IELTSApp.swift, API/openapi.json (generated), API/openapi-generator-config.yaml, Core/{APIClient.swift,AuthStore.swift,Settings.swift,Band.swift}, Audio/{Recorder.swift,Player.swift,VAD.swift,RealtimeSocket.swift}, Views/{RootView,LoginView,DashboardView,SpeakingHomeView,SpeakingSessionView,LiveExamView,ResultView,TranscriptView,FluencyView,WritingHomeView,WritingEditorView,ChartView,ReviewView,SettingsView,BankView}.swift}`, `apps/ios/IELTSTests/BandTests.swift`. Modify `.github/workflows/ci.yml` (ios job)

- XcodeGen `project.yml`: iOS 17 target `IELTS`, bundle id `com.soyeb.ieltspractice`, SPM packages `apple/swift-openapi-generator` (plugin), `apple/swift-openapi-runtime`, `apple/swift-openapi-urlsession`. Info.plist `NSMicrophoneUsageDescription`: "Record your speaking answers for scoring." Build setting `API_BASE_URL` in the Info.plist (default `https://ielts.example.com`, overridable in the app settings screen for self-hosting).
- **Auth:** Better Auth email sign-in via `POST /api/auth/sign-in/email`, reading the `set-auth-token` response header (bearer plugin). The token is stored in the Keychain and sent via a `ClientMiddleware` `Authorization: Bearer`.
- **Recorder:** `AVAudioSession` `.playAndRecord`, `AVAudioRecorder` AAC 16 kHz mono m4a with metering enabled, sampling `averagePower` every 50 ms → 0–255 energy. Mic denied → alert with a Settings deep link.
- **Screens mirror the web:**
  - Tab bar: Home / Speaking / Writing / Review / Settings.
  - Results use segmented tabs (Overview, Transcript, Fluency, Language, Improve).
  - Transcript uses flow layout text with tappable words → `AVAudioPlayer.currentTime` seek.
  - WPM uses Swift Charts `AreaMark` + `RectangleMark` for the band-7 zone.
- **Writing editor:** `UIViewRepresentable` `UITextView` with all autocorrection/spell/smart/inline-prediction types `.no`, and paste blocked by overriding `canPerformAction(paste)` in a subclass.
- **Live:** turn-based uses the same endpoints. Realtime uses `URLSessionWebSocketTask` to `wss://api.openai.com/v1/realtime?model=…` with the ephemeral token, `AVAudioEngine` input tap → PCM16 24 kHz → `input_audio_buffer.append`, and plays `response.output_audio.delta` via `AVAudioPlayerNode`. (Verify the event names with the docs.)
- **`Band.swift`:** a port of `roundBand` with a unit test mirroring the TS table.
- **CI job `ios`** (`macos-15`): `brew install xcodegen`, `cd apps/ios && xcodegen`, then `xcodebuild -scheme IELTS -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO` and `xcodebuild test -scheme IELTS -destination 'platform=iOS Simulator,name=iPhone 16'`. Zip `IELTS.app` from DerivedData and upload the artifact.

- [ ] **Step 1:** `BandTests.swift` with the same table as the TS test (fails without `Band.swift`).
- [ ] **Step 2:** Implement all files. Push and iterate on the CI `ios` job until green (no local Xcode; CI is the build machine).
- [ ] **Step 3:** Commit `feat(ios): SwiftUI app` (each CI fix is its own commit).

---

### Task 20: Cambridge extractor (private data)

**Files:** Create `scripts/cambridge-extract.py`, `scripts/cambridge-import.ts`, `scripts/README-cambridge.md`

- The Python script (uv run, deps `pymupdf`, `httpx`) walks `~/Downloads/Cambridge IELTS (1-19) With Audio (FULL)`, preferring `.pdf` (skipping answer-key-only files).
- Per page it gets `get_text()`. If it has < 40 chars (scanned), it renders the page to PNG at 150 dpi and sends it to an OpenRouter vision model for transcription.
- It finds pages containing "WRITING TASK 1", "WRITING TASK 2" and "SPEAKING" (plus "PART 1/2/3").
- For each test, the LLM segments the text into a JSON `{ book, test, writing: { t1: { body, hasFigure, figurePage, figureBBox? }, t2: { body } }, speaking: { p1: { topic, questions[] }[], p2: { title, bullets[], explain }, p3: { topic, questions[] }[] } }`.
- For the T1 figure, it renders the page region: the largest image block bbox via `page.get_images`/`get_image_rects`, or the full page minus the text blocks. It writes PNGs to `data/cambridge/img/C{b}T{t}.png` and JSON to `data/cambridge/C{b}.json` (gitignored).
- `cambridge-import.ts` uploads the images to R2 `cambridge/…` and upserts rows with `restricted=true`, `source='cambridge'`, `sourceRef='C{b} T{t}'`, and slugs `cam-{b}-{t}-{kind}`. P2/P3 are linked via `groupId`.
- It prints a per-book summary count. The implementer spot-checks 3 books visually.

- [ ] **Step 1:** Run on book 17 only; verify 4 tests × (T1, T2, P1–P3) extracted.
- [ ] **Step 2:** Run all books and import. Log failures per book and fix the worst.
- [ ] **Step 3:** Commit the scripts only: `feat: cambridge extractor (private data, not committed)`.

---

### Task 21: Self-evaluation loop

- Start the full stack (`docker compose up`) with real keys.
- Drive it with Playwright MCP at desktop 1440×900 and mobile 390×844, in light and dark. Screenshot every screen.
- Run Lighthouse on the dashboard and editor.
- Accuracy check: submit 3 public band-sample essays (known bands 5.5, 7, 8 from the British Council/IDP sample scripts, typed in) and 2 speaking recordings (generated with TTS reading a band-6 and a band-8 sample transcript). Record the predicted vs known band.
- Score /10: Performance, Ease of use, UI/UX, Features vs spec, Accuracy (|Δ| ≤ 0.5 = 10, ≤ 1 = 7).
- Write `docs/evaluation.md` with the scores, evidence and the fix list. Fix the lowest items and re-score. Repeat until every score is ≥ 8. Commit each round `chore: eval round N`.
