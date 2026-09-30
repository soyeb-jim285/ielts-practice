# Scoring gold set (private)

The examiner-marked scripts that anchor, calibrate and test the scorers (`docs/scoring-research.md` §2.2, §4).
Cambridge and ielts.org texts are copyrighted: they live only in the DB table `scoring_scripts` and in the gitignored
`data/scoring-gold/`. Git holds only `data/scoring-gold-manifest.json` (id, source, band, split, group, sha256, word
count, probe expectations; no text).

## Build

```sh
uv run scripts/gold-build.py            # transcribe missing pages via OpenRouter, then build
uv run scripts/gold-build.py --no-ocr   # rebuild from the page cache only (free)
pnpm -F @ielts/server exec tsx ../../scripts/gold-import.ts [--dry] [--prune]   # upsert into scoring_scripts
```

`gold-build.py` needs `OPENROUTER_API_KEY` (env or `.env`) and the books at `CAMBRIDGE_DIR`
(default `~/Downloads/Cambridge IELTS (1-19) With Audio (FULL)`). Each page is transcribed once by `OCR_MODEL`
(default `google/gemini-3.7-flash`: it dropped crossed-out words better than `gemini-2.5-pro` on C19 p134, at about
$0.003 a page) and cached in `data/scoring-gold/ocr/`. Books 12, 13 and 19 reuse the iteration-3 gemini-2.5-pro
transcriptions from `.eval/3/scoring/` (these have no examiner comments). The ielts.org PDFs and speaking page are
downloaded to `data/scoring-gold/src/`.

## Sources and splits

| Split | Sources | Role |
|---|---|---|
| `anchor` | Cambridge 10, 11 (14's copy has no sample answers); ielts.org 2023 tasks 1C and 2A, CD Academic Part 1 (the band 4 and 8.5 tails) | `anchor`: benchmark scripts, never scored |
| `calibration` | Cambridge 12, 13, 15 (Academic and GT), 16, 17, 18, 19; ielts.org 2023 1A and 1B, CD General Training | `calib`: per-model fits with grouped CV |
| `test` | Cambridge 1, 2, 3, 5, 7, 8, 9 (4 and 6 have no sample answers); ielts.org 2023 2B, CD Academic Part 2, older sample-script PDF 2A and 2B | `test`: frozen, release decisions only |

- Splits are by **task prompt** (`groupId`): an anchor never answers the same prompt as a scored script, and
  `gold-build.py` asserts this.
- Cambridge examiner **model answers** are `role: probe`, `expect.kind: ceiling`: nominal band 9, expected overall
  >= 8.5 with every criterion >= 8. They keep their book's split, so the anchor-book models (Cambridge 10) are never scored.
- Speaking: the 12 ielts.org sample-test candidates (transcripts on the ielts.org page, video as `audioKey: youtube:<id>`).
  The first candidate at bands 5, 6, 7 and 8 is an anchor; the rest are test.

## Probes (`role: probe`, `source: variant | authored`)

Controlled variants of frozen-test examiner model answers (2 T2, 1 T1A, 1 T1GT). `expect` holds constraints, not
official bands:

| kind | change | expectation |
|---|---|---|
| `err1..3` | deterministic article / agreement / tense / plural / preposition faults at 2, 5, 10 per 100 words (each level a superset of the one below) | score non-increasing with level; `maxBand` 8 at level 2, 7 at level 3 |
| `offtopic` | an unrelated paragraph inserted | below the base |
| `short` | cut to half the minimum length | below the base, overall <= 6.5, TA/TR <= 5 |
| `copied` | the first paragraph replaced by the task prompt | not above the base (copied rubric is discounted) |
| `nooverview` (T1A) | overview paragraph removed | below the base, TA <= 5 |
| `floor-copy` | the prompt copied back plus one thin sentence | overall <= 3 |
| `floor-degraded` | a frozen-test script of band <= 5.5, 15 faults per 100 words, cut under length | overall <= 4 |
| `floor` (authored) | three very weak scripts written for this set | overall <= 4 |

## Known limits

- The CD Academic, CD General Training and older ielts.org PDFs do not print their task prompts. Those prompts are
  reconstructed from the scripts and comments and flagged `prompt.reconstructed`.
- Task 1 figures: Cambridge rows carry `prompt.imageKey` (the R2/local key used by `cambridge-import.ts`); Cambridge 15
  Academic and ielts.org rows carry only a `prompt.figure` page reference. No verified chart data yet (§2.1).
- Labels are overall task bands only; there are no official criterion bands.
- All of these scripts are public, so contamination is possible (§7.4).

## Fitting with anchors (iteration 5)

`pnpm eval:scoring --split calib --fit --with-anchors` also scores the anchor scripts, each with itself left out of the benchmarks
(`skipAnchor`), so the calibration fit reaches the bands the calibration pool lacks (3.5-4 and 8-8.5). Anchors never enter the
test or probe splits. Fit of 2026-10-01 (promptHash `c2c869d31a9fcf39`, n = 86): slope 1.17, intercept -0.32, CV QWK 0.80, MAE 0.51,
within 0.5 of 71%; gate failed (MAE, band >= 7 bias CI), so the record is stored inactive and `DEFAULT_MAPS` carries the same map.
