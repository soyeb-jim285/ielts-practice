# L/R review enrichment (offline, once)

`scripts/lr-enrich.ts` asks `openai/gpt-6-luna` (OpenRouter) once per section for per-question review notes
(`evidence`, `why`, `wrong`, `paraphrase`) and per-section `vocab`, and writes **sidecars** (data/ is gitignored):

    data/{cambridge-lr,lr-generated}/enrich/{slug}.json
    { "slug": "...", "questions": { "<n>": LrQuestionReview }, "sections": { "<part>": { "vocab": LrVocab[] } } }

Run: `pnpm -F @ielts/server exec tsx ../../scripts/lr-enrich.ts [slug ...]` (use `nice -n 19`). Resumable via
`enrich/.cache/`; concurrency 3; cost logged to `data/lr-enrich-cost.log`, hard stop at $3.

Checks: evidence is an exact substring of the passage/transcript (whitespace-normalised; for gaps it must contain an
accepted answer) else dropped after one retry; `wrong` keys must be real option keys and never the key; `why` <= 45 words,
each `wrong` <= 30; vocab `example` must be verbatim, else omitted. Sections with no transcript/passage get `why`/`wrong` only.
`at` and `timings` are produced elsewhere.
