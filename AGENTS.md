# Agent notes (Codex / Claude)

Start with `docs/HANDOFF.md`: it lists the uncommitted work in the tree and the next tasks, with the exact commands for each.

## Project rules (from the owner)
- **Cost:** never use Anthropic/Claude models for app or eval calls. Use cheap OpenRouter models: `openai/gpt-6-luna` (default), `deepseek/deepseek-v4.1-flash`. Don't use Qwen (too slow). State the estimated cost before any paid run. The OpenAI key is only for Realtime.
- **Content** (questions, passages, scripts, chart descriptions) is written by coding agents themselves, not by OpenRouter calls. OpenRouter is for app runtime only.
- **Android/Gradle builds** run on GitHub CI only. The laptop is too slow.
- **Design:** decide UI details yourself and keep WCAG AA; don't ask the owner palette or font questions.
- Commit or push only when the owner asks.

## How to run things
- Monorepo: pnpm. Packages: `packages/core` (shared logic), `apps/server` (Hono API), `apps/web` (Vite/React), `apps/android`, `apps/ios`.
- Local DB: `docker start ielts-prtactice-db-1` (Postgres on port 5433). Query it with `docker exec ielts-prtactice-db-1 sh -c 'psql -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-postgres} -c "..."'`.
- Dev: `pnpm dev`. Web runs at http://localhost:5173 and the API at :8787. Local email sign-up returns 403; use guest sign-in (`POST /api/auth/sign-in/anonymous`).
- Tests: `npx vitest run` inside each package. The whole web suite can time out under load; rerun the failing file alone.
- After changing API schemas: `pnpm gen:api` (regenerates `apps/web/src/openapi.json` and `apps/web/src/lib/schema.d.ts`).
- One-off TS scripts go in `apps/server/.eval/` (gitignored) as `.mts`, so bare imports resolve. Run them with `cd apps/server && npx tsx --env-file-if-exists=../../.env .eval/x.mts`.
- `source .env` fails (line 14 has a parse error). Read keys with `grep -E '^OPENROUTER_API_KEY=' .env | cut -d= -f2-`.
