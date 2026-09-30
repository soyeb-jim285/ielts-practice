# scripts

Run from the repo root.

| Command | What it does |
|---|---|
| `pnpm seed [bankDir]` | `seed-bank.ts`: idempotent upsert of the committed prompt bank (`data/bank/*.json`) into the DB |
| `pnpm gen:bank <file> [count] [model]` | `gen-bank.ts`: generates new bank entries with OpenRouter (e.g. `writing-t2-b.json 10`), validated and deduped by slug; review the diff, then `pnpm seed` |
| `pnpm gen:api` | `export-openapi.ts` + openapi-typescript: refreshes `apps/web/src/openapi.json` and `lib/schema.d.ts` |
| `pnpm eval:scoring` | writing scoring harness (see `README-scoring-gold.md`, `docs/scoring-validation.md`) |

Private Cambridge tooling: `README-cambridge.md`, `README-scoring-gold.md`.
