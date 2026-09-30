# Cambridge IELTS import (private)

Cambridge IELTS 1–19 prompts are copyrighted. They are imported as `restricted` prompts that only
`CAMBRIDGE_ALLOWED_EMAILS` can see. Nothing extracted goes into git: `data/cambridge/` is gitignored.

## 1. Extract

```sh
uv run scripts/cambridge-extract.py            # all books
uv run scripts/cambridge-extract.py 17 18      # some books
uv run scripts/cambridge-extract.py --no-llm   # deterministic only
# --books-dir DIR  (default: ~/Downloads/Cambridge IELTS (1-19) With Audio (FULL))
```

What it does for each book folder (answer-key, transcript and notice PDFs are skipped):

1. It reads each page's text layer. If a page has no real text (a scan), it OCRs the page locally
   with RapidOCR. A cheap pass OCRs the top of every page to find headings, and a full pass OCRs only
   the Writing/Speaking pages. OCR results are cached in `data/cambridge/cache/`.
2. It finds Writing Task 1 ("20 minutes"), Writing Task 2 ("40 minutes") and Speaking (Part 2
   "You should say") pages. It groups them into tests in page order, and each Task 1 starts a new
   test. Letter tasks, and files named `*Gen*`, become General Training tests (`g1`, `g2`, …).
3. It segments them with regexes: task bodies, the P1 topic and questions, the P2 cue card (the
   sidebar instructions are removed) and the P3 topics with their questions.
4. It crops the Task 1 figure: the union of the text, drawings and images below "Write at least
   150 words", with the page footer excluded. It is written to `data/cambridge/img/C{b}T{t}.png`.
5. If `OPENROUTER_API_KEY` is set (in the environment or `.env`), any test that is still missing a
   part is sent to `google/gemini-2.5-flash` with its page images and OCR text. The model fills only
   the missing parts, and those tests are marked `"llm": true`. Without a key, the summary lists
   them as `NEEDS LLM`.

It prints one summary line per book:

```
C17  tests=4  t1=4 t2=4 p1=4 p2=4 p3=4 img=4 ocr=4
```

Output shape of `data/cambridge/C{b}.json`:

```jsonc
{ "book": 17, "tests": [{
  "book": 17, "test": "1", "variant": "academic", "file": "…pdf", "pages": [20, 21, 22],
  "writing": { "t1": { "body": "…", "hasFigure": true, "figurePage": 20, "figureBBox": [x0, y0, x1, y1] }, "t2": { "body": "…" } },
  "speaking": { "p1": [{ "topic": "History", "questions": ["…"] }], "p2": { "title": "Describe …", "bullets": ["…"], "explain": "and explain …" }, "p3": [{ "topic": "…", "questions": ["…"] }] },
  "scanned": true, "image": "img/C17T1.png"
}]}
```

Books 1–2 use the pre-2001 speaking format (role-play cue cards), so speaking is not extracted
from them.

## 2. Review

Spot-check the JSON and some PNGs before importing. OCR can merge words (`between2011`) or drop a
question. Fix the JSON by hand, because the importer reads it exactly as it is.

## 3. Import

It needs `DATABASE_URL` and `R2_*` in `.env`.

```sh
pnpm tsx scripts/cambridge-import.ts --dry   # print the rows, touch nothing
pnpm tsx scripts/cambridge-import.ts         # upload PNGs to R2 cambridge/C{b}T{t}.png + upsert prompts
```

It upserts one row per item, keyed by slug, so re-running is safe. Every row gets
`source='cambridge'`, `restricted=true` and `sourceRef='C{b} T{t}'`:

| slug | row |
|---|---|
| `cam-{b}-{t}-w1` | Writing Task 1 (academic: `imageKey`; general: letter `bullets`) |
| `cam-{b}-{t}-w2` | Writing Task 2 (type guessed: opinion / discussion / adv-disadv / problem-solution / two-part) |
| `cam-{b}-{t}-p1`, `-p1-2`… | Speaking Part 1, one row per topic |
| `cam-{b}-{t}-p2` | cue card, `groupId = cam-{b}-{t}-p2` |
| `cam-{b}-{t}-p3` | all Part 3 questions of the test, the same `groupId` (`p3-linked`) |
