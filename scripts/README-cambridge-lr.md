# Cambridge IELTS Listening and Reading import (private)

Cambridge IELTS 1-19 Listening and Reading tests are copyrighted. They are extracted from the owner's own books and shown only to
allow-listed emails. Nothing extracted goes into git: `data/cambridge-lr/` is gitignored, and the scripts here carry no content.

## Run

```sh
uv run scripts/cambridge-lr-extract.py 17 18            # all stages for some books (default: all 19)
uv run scripts/cambridge-lr-extract.py 17 --stage ocr   # ocr | struct | audio | figs | all
pnpm tsx scripts/cambridge-lr-validate.ts [C17 ...]     # validateLrTest + extra checks, exit 1 on failure
uv run scripts/cambridge-lr-verify-audio.py [C17 ...]   # local STT spot check: is each mp3 the right section?
```

Every stage is cached and resumable. `OPENROUTER_API_KEY` comes from the environment or `.env`.
Budget guard: the script stops when the total in `data/cambridge-lr/cost.log` nears $3 (`BUDGET`).
`--books-dir DIR` overrides `~/Downloads/Cambridge IELTS (1-19) With Audio (FULL)`.

## Stages

1. `ocr` writes `data/cambridge-lr/pages/C{b}.json` (one record per PDF page). It uses the PDF text layer where there is one
   (books 1-3, 18, part of 13/19). For scanned pages it asks a cheap vision model (`qwen/qwen3.7-flash`, about $0.0001 per page,
   fallbacks in `vlm_text`) to transcribe the page. RapidOCR was tried first but was far too slow on the shared laptop and loses the
   answer blanks; the VLM marks them as `[___]` and also describes figures. Pages whose transcription came back truncated
   (zero-cost / `finish_reason != stop`) are retried on other models. EPUBs were not used (their text is the same OCR, flattened).
2. `struct` (LLM `openai/gpt-6-luna`, JSON mode, text only):
   - one call per book locates every test's listening sections, reading passages, audioscript pages and answer key
     (`locate`), from a digest of page headings;
   - one call per answer key source file (`SYS_KEY`); if the key text has any missing answer, the key pages are re-read as images;
   - one call per listening section / reading passage / transcript, with a retry that feeds the error list back
     (`section_check`, `reading_errs`: contiguous question numbers, expected counts);
   - `write_test` merges key and questions, snaps answers to option keys, decides TFNG vs YNNG from the key's words,
     converts map/plan labelling into `match`, gives every question of a "choose TWO" group the full answer set, and writes
     `data/cambridge-lr/C{b}-T{t}-{listening|reading}[-gt].json`.
3. `audio` re-encodes to mono 64 kbps 44.1 kHz mp3 (`nice -n 19`) at `assets/lr/cambridge/C{b}T{t}P{part}.mp3`.
   Book specifics are in `audio_sources` (see below).
4. `figs` crops maps/plans/diagrams: the page is rendered, a cheap VLM returns a bounding box, and the crop (170 dpi) is written to
   `assets/lr/cambridge/img/C{b}T{t}-q{from}.png`; the group's `image` is set to that key.

## Output

`data/cambridge-lr/C{b}-T{t}-listening.json`, `C{b}-T{t}-reading.json`, `C{b}-T{t}-reading-gt.json` (shape: `packages/core/src/lr.ts`),
slugs `cam-{b}-{t}-l`, `cam-{b}-{t}-r`, `cam-{b}-{t}-rg`, `ref` `C{b} T{t}`. Test numbers are the numbers printed in the book
(Cambridge 12 has tests 5-8). Assets live under `data/cambridge-lr/assets/` with the keys written in the JSON.

Choices worth knowing:

- Gap questions keep their form/notes/table as markdown `group.content` with `{{n}}`; short-answer questions get `{{n}}` appended to their text.
- Word-box summaries are `gap` + `group.options` with letter answers; older books key them by word, which is mapped to the letter.
- Map/plan labelling is `match` with options A..N (same letter as text) plus an `image`. Diagrams labelled with words are `gap` + `image`.
- General Training sections that hold several short texts: each text's heading is a paragraph without label starting with `### `, followed by its paragraphs.
  GT section title is `Section n` (the model gives no overall title).
- Listening transcripts keep speaker labels, one line per turn. Books 4 and 6 ship no audioscripts, so those tests have no transcript.
- Questions that are `mcq-multi` ("in either order") carry the full correct letter set on every question of the group.
- Listening and reading answers keep the key's alternatives as separate array entries and the key's optional words in parentheses.

## Audio mapping

- Books 4-6, 9, 11, 12, 14-19: one file per section, named by test/section (book 12 names are Test 5-8; book 15 flac/wav duplicates ignored).
- Books 7, 8, 10, 13: 16 numbered tracks, CD1 = tests 1-2, CD2 = tests 3-4, four sections each. Checked by transcribing the opening of tracks.
- Book 2: one file per test; the four sections are cut at the ~30 s pauses (`split_by_silence`).
- Books 1 and 3: one file per test without clean pauses; local whisper (tiny.en) finds the spoken "Now turn to Section N" (`split_by_stt`).
  Book 3's files are stereo in antiphase, so the left channel is used (`mono_filter`).
- Book 14: `Test 3 Section 1.mp3` etc. are fine, but `Test 2 Section 4.mp3` also contains a duplicate of T3S1 after T2S4 (cut off);
  Test 1 Section 1 is not on the disc, so C14 Test 1 has no listening file.
- Section audio keeps the CD's announcements (the track-1 intro for the first section of a CD).

## Known gaps / quality notes

See the coverage table below. Everything is machine-extracted from scans: check a few tests before relying on them.
Typical residual issues: an occasional OCR slip in a passage, answer keys with several accepted forms that the key prints in an unusual way
(`(the) architect'(s) (name)`), flow-charts or tables whose visual layout is simplified in markdown, map crops that include a sliver of the
instruction line above them. The validator warns when a reading gap answer is not found in the passage or exceeds the word limit
(some warnings are false positives such as phone numbers and `travel(l)ing`).

## Coverage

| Book | Listening | Academic reading | GT reading | Not importable (in `invalid/`) |
|---|---|---|---|---|
| 1 | 0  | 1 [1] | 0  | T1 listening, T2 listening, T2 reading, T3 listening, T3 reading, T4 listening, T4 reading |
| 2 | 1 [4] | 3 [2, 3, 4] | 0  | T1 listening, T1 reading, T2 listening, T3 listening |
| 3 | 3 [1, 2, 4] | 3 [1, 2, 3] | 0  | T3 listening, T4 reading |
| 4 | 3 [1, 3, 4] | 4 [1, 2, 3, 4] | 0  | T2 listening |
| 5 | 3 [1, 2, 4] | 4 [1, 2, 3, 4] | 0  | T3 listening |
| 6 | 2 [1, 2] | 3 [1, 2, 4] | 0  | T4 listening |
| 7 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| 8 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| 9 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| 10 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| 11 | 4 [1, 2, 3, 4] | 3 [1, 2, 3] | 0  | T4 reading |
| 12 | 4 [5, 6, 7, 8] | 4 [5, 6, 7, 8] | 0  | - |
| 13 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| 14 | 3 [2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| 15 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | - |
| 16 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| 17 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| 18 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| 19 | 4 [1, 2, 3, 4] | 4 [1, 2, 3, 4] | 0  | - |
| total | 63 | 69 | 4 | 17 |

Notes on the table: a test is "importable" when `validateLrTest` passes (files in `data/cambridge-lr/C*-T*.json`). The failing ones were moved to
`data/cambridge-lr/invalid/` so an importer globbing the main folder only sees valid tests; their remaining problems are mostly answer-key slips
in the old compact keys (books 1-6, e.g. `1-11 B C B F ...` lines) or sections whose questions the text did not give completely.

- Book 1 (1996): the printed question numbering does not follow the 10/10/10/10 listening and 13/13/14 reading split, so tests rarely sum to 40; only Test 1 reading passed.
- Book 6: the PDFs hold tests 1, 2 and 4; test 3 is missing from the files (its audio exists but has no questions).
- Book 14: Test 1 Section 1 audio is not on the disc, so no Test 1 listening.
- Books 4 and 6 have no audioscripts in the files: listening sections there have no transcript.
- Audio check (`cambridge-lr-verify-audio.py`, tiny whisper): all sections match their audioscript except some section-4 lectures and C2 T4 (low
  overlap because tiny whisper mishears lectures / old tape); books 4 and 6 cannot be checked (no transcript).
- General Training: only book 15 ships a GT book; GT sections in the old books were not located.
- Questions typed `gap` for a flow-chart or table are markdown; check visually before relying on them.

