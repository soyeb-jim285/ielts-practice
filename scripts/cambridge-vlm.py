# /// script
# dependencies = ["pymupdf", "httpx"]
# ///
"""Cambridge IELTS Writing + Speaking extractor using vision LLMs via OpenRouter (PRIVATE output, gitignored).

Pass 1 (locate): page thumbnails tiled into labelled contact sheets → cheap VLM returns which pages are
                 Writing Task 1/2 or Speaking pages (skipping sample answers / examiner comments).
Pass 2 (extract): only those pages at full resolution → strong VLM returns structured JSON per test,
                 incl. Task 1 figure bounding box, which we crop to PNG.

Output: data/cambridge/C{book}.json (same shape cambridge-import.ts reads) + data/cambridge/img/C{b}T{t}.png

Usage: uv run scripts/cambridge-vlm.py [book ...]        (default: all 1-19)
Env/.env: OPENROUTER_API_KEY. Models overridable: LOCATE_MODEL, EXTRACT_MODEL.
"""
import base64, json, os, re, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
BOOKS = Path(os.environ.get("CAMBRIDGE_DIR", "/home/jim/Downloads/Cambridge IELTS (1-19) With Audio (FULL)"))
OUT = Path(os.environ.get("CAMBRIDGE_OUT", ROOT / "data" / "cambridge"))
LOCATE_MODEL = os.environ.get("LOCATE_MODEL", "qwen/qwen3-vl-8b-instruct")
EXTRACT_MODEL = os.environ.get("EXTRACT_MODEL", "qwen/qwen3-vl-235b-a22b-instruct")
SKIP = re.compile(r"key|notice|transcript|ielts ?\d+ answers\.pdf$", re.I)  # answer keys only, not "with Answers" books
THUMB_W, COLS, ROWS = 380, 4, 3  # 12 legible pages per contact sheet


def api_key() -> str:
    if k := os.environ.get("OPENROUTER_API_KEY"):
        return k
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    sys.exit("OPENROUTER_API_KEY missing (env or .env)")


KEY = api_key()
http = httpx.Client(timeout=httpx.Timeout(90, connect=15))


def png_b64(pix: pymupdf.Pixmap) -> str:  # JPEG: ~5x smaller uploads on slow links
    return base64.b64encode(pix.tobytes("jpg", jpg_quality=80)).decode()


def chat_json(model: str, text: str, images: list[str], retries: int = 8) -> dict:
    content = [{"type": "text", "text": text}] + [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b}"}} for b in images]
    for attempt in range(retries):
        try:
            r = http.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {KEY}", "X-Title": "IELTS Practice extractor"},
                json={"model": model, "temperature": 0, "response_format": {"type": "json_object"}, "messages": [{"role": "user", "content": content}]},
            )
            r.raise_for_status()
            out = r.json()["choices"][0]["message"]["content"]
            out = re.sub(r"^```(?:json)?|```$", "", out.strip(), flags=re.M).strip()
            return json.loads(out)
        except Exception as e:  # noqa: BLE001 — network/JSON flakiness: retry with backoff
            err = e
            time.sleep(min(60, 4 * 2 ** attempt))  # rides out DNS/network drops
    raise RuntimeError(f"{model} failed: {err}")


# ---------------- pass 1: locate ----------------
LOCATE_PROMPT = """These are thumbnails of pages from a Cambridge IELTS practice book. Each thumbnail has its page number printed above it in red.
Identify pages that contain the ACTUAL EXAM QUESTIONS for:
- WRITING (a page headed "WRITING" with "WRITING TASK 1" and/or "WRITING TASK 2" instructions/prompt, or a Task 1 chart/diagram/map/letter prompt page)
- SPEAKING (a page headed "SPEAKING" with PART 1 / PART 2 (cue card) / PART 3 questions)
EXCLUDE: sample/model answers, examiner comments, answer keys, listening transcripts, reading passages, introduction pages, tables of contents.
Return JSON: {"writing": [page numbers], "speaking": [page numbers]}. Empty lists if none."""


def contact_sheets(doc: pymupdf.Document):
    n = doc.page_count
    per = COLS * ROWS
    for s in range(0, n, per):
        pages = list(range(s, min(n, s + per)))
        th = int(THUMB_W * 1.42)
        sheet = pymupdf.open()
        sp = sheet.new_page(width=COLS * THUMB_W, height=ROWS * (th + 18))
        for k, i in enumerate(pages):
            r, c = divmod(k, COLS)
            x, y = c * THUMB_W, r * (th + 18)
            rect = pymupdf.Rect(x + 4, y + 18, x + THUMB_W - 4, y + 18 + th)
            sp.show_pdf_page(rect, doc, i)
            sp.insert_text((x + 8, y + 14), f"{i}", fontsize=14, color=(0.85, 0, 0))
        yield pages, png_b64(sp.get_pixmap(dpi=72))


def locate(doc: pymupdf.Document) -> tuple[set[int], set[int]]:
    W, S = set(), set()
    sheets = list(contact_sheets(doc))
    with ThreadPoolExecutor(4) as ex:
        for pages, res in zip([p for p, _ in sheets], ex.map(lambda sh: chat_json(LOCATE_MODEL, LOCATE_PROMPT, [sh[1]]), sheets)):
            ok = set(pages)
            W |= {int(p) for p in res.get("writing", []) if int(p) in ok}
            S |= {int(p) for p in res.get("speaking", []) if int(p) in ok}
    return W, S


def group_tests(W: set[int], S: set[int]) -> list[list[int]]:
    """A test = run of writing pages followed by speaking pages; a writing page after speaking starts a new test."""
    tests, cur, seen_s = [], [], False
    for p in sorted(W | S):
        is_w = p in W and p not in S
        if cur and (p - cur[-1] > 3 or (is_w and seen_s)):
            tests.append(cur)
            cur, seen_s = [], False
        cur.append(p)
        seen_s |= p in S
    if cur:
        tests.append(cur)
    # a test must have writing or speaking content; pad one page after the last speaking page (Part 3 often spills over)
    return [list(range(t[0], t[-1] + 2)) for t in tests if t]  # fill gaps (missed pages) + 1 spill-over page


# ---------------- pass 2: extract ----------------
EXTRACT_PROMPT = """You are transcribing one test's WRITING and SPEAKING question pages from a Cambridge IELTS book (images below, in order; image index 0,1,2…).
Transcribe EXACTLY (fix only OCR-style artefacts, keep original wording, British spelling). Ignore anything that is not Writing/Speaking questions (e.g. reading passages, sample answers).
Return JSON:
{
 "test": <test number printed in the page header, e.g. 1, or null>,
 "variant": "academic" | "general",   // general if Task 1 is a letter
 "writing": {
   "t1": {"body": "<full Task 1 prompt text incl. 'You should spend about 20 minutes…' is NOT needed — start from the task description; include 'Summarise the information…' / letter bullets and 'Write at least 150 words.'>",
          "hasFigure": true|false, "figureImage": <image index of the figure or null>, "figureBox": [x0,y0,x1,y1] // figure (chart/diagram/map/table incl. its title) as FRACTIONS 0-1 of that image, or null
         } | null,
   "t2": {"body": "<full Task 2 prompt incl. instruction lines and 'Write at least 250 words.'>"} | null
 },
 "speaking": {
   "p1": [{"topic": "...", "questions": ["..."]}],
   "p2": {"title": "Describe …", "bullets": ["You should say: items without the lead-in"], "explain": "and explain …"} | null,
   "p3": [{"topic": "...", "questions": ["..."]}]
 } | null
}
Keep bracketed prompts like "[Why?]" as written. Use null for missing sections."""


def extract_test(doc: pymupdf.Document, pages: list[int]) -> dict:
    imgs = [png_b64(doc[i].get_pixmap(dpi=120)) for i in pages if i < doc.page_count]
    return chat_json(EXTRACT_MODEL, EXTRACT_PROMPT, imgs)


def run_file(book: int, path: Path, start_index: int) -> list[dict]:
    doc = pymupdf.open(path)
    cache = OUT / "locate" / f"C{book}-{re.sub(r'\W+', '_', path.stem)}.json"
    if cache.exists():
        W, S = (set(x) for x in json.loads(cache.read_text()))
    else:
        W, S = locate(doc)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps([sorted(W), sorted(S)]))
    groups = group_tests(W, S)
    # hybrid: OCR run (cambridge-extract.py) page maps are high-recall; prefer them, add non-overlapping VLM groups
    hint_file = ROOT / "data" / "cambridge-ocr" / f"C{book}.json"
    if hint_file.exists() and hint_file.resolve() != (OUT / f"C{book}.json").resolve():
        hints = [list(range(min(t["pages"]), max(t["pages"]) + 2)) for t in json.loads(hint_file.read_text()).get("tests", [])
                 if t.get("file") == path.name and t.get("pages")]
        if hints:
            used = {p for h in hints for p in range(h[0] - 2, h[-1] + 3)}
            groups = sorted(hints + [g for g in groups if not used & set(g)])
    variant_hint = "general" if re.search(r"\bgen", path.name, re.I) else None
    def safe(g):
        try:
            return g, extract_test(doc, g)
        except Exception as e:  # noqa: BLE001 — skip this test, keep the book
            print(f"C{book} pages {g}: ERROR {e}", file=sys.stderr, flush=True)
            return g, {}
    with ThreadPoolExecutor(3) as ex:
        results = list(ex.map(safe, groups))
    tests = []
    for k, (pages, t) in enumerate(results):
        w, sp = t.get("writing") or {}, t.get("speaking") or {}
        body = lambda x: bool(x and (x.get("body") or "").strip())
        sp = {k: v for k, v in sp.items() if v} or None
        if sp and sp.get("p2"):
            sp["p2"]["bullets"] = [b for b in sp["p2"].get("bullets") or [] if not b.lower().startswith("and explain")]
        if not ((body(w.get("t1")) and body(w.get("t2"))) or sp):  # lone fragments = false positives
            continue
        w = {k: v for k, v in w.items() if body(v)}
        tn = str(start_index + len(tests) + 1)  # book order; model-read numbers are unreliable
        variant = variant_hint or t.get("variant") or "academic"
        entry = {"book": book, "test": tn, "variant": variant, "file": path.name, "pages": pages, "writing": {}, "speaking": sp, "source": "vlm"}
        if t1 := w.get("t1"):
            entry["writing"]["t1"] = {"body": t1.get("body", ""), "hasFigure": bool(t1.get("hasFigure"))}
            fi, box = t1.get("figureImage"), t1.get("figureBox")
            if t1.get("hasFigure") and isinstance(fi, int) and 0 <= fi < len(pages) and box and len(box) == 4:
                page = doc[pages[fi]]
                r = page.rect
                x0, y0, x1, y1 = [max(0.0, min(1.0, float(v))) for v in box]
                clip = pymupdf.Rect(r.x0 + x0 * r.width, r.y0 + y0 * r.height, r.x0 + x1 * r.width, r.y0 + y1 * r.height)
                clip = (clip + (-8, -8, 8, 8)) & r  # small margin
                if clip.width > 40 and clip.height > 40:
                    suffix = "G" if variant == "general" and variant_hint else ""
                    rel = f"img/C{book}{suffix}T{tn}.png"
                    page.get_pixmap(dpi=170, clip=clip).save(OUT / rel)
                    entry["image"] = rel
                    entry["writing"]["t1"].update(figurePage=pages[fi], figureBBox=[round(v, 1) for v in clip])
        if t2 := w.get("t2"):
            entry["writing"]["t2"] = {"body": t2.get("body", "")}
        tests.append(entry)
    return tests


def run_book(book: int) -> str:
    folder = BOOKS / f"Cambridge IELTS {book}"
    pdfs = sorted(p for p in folder.glob("*.pdf") if not SKIP.search(p.name))
    tests: list[dict] = []
    for p in pdfs:
        try:
            tests += run_file(book, p, len(tests))
        except Exception as e:  # noqa: BLE001
            print(f"C{book} {p.name}: ERROR {e}", file=sys.stderr, flush=True)
    (OUT / f"C{book}.json").write_text(json.dumps({"book": book, "tests": tests, "extractor": "vlm"}, indent=1, ensure_ascii=False))
    n = lambda f: sum(1 for t in tests if f(t))
    return (f"C{book}: {len(tests)} tests | T1 {n(lambda t: t['writing'].get('t1'))} (img {n(lambda t: t.get('image'))}) "
            f"T2 {n(lambda t: t['writing'].get('t2'))} | P1 {n(lambda t: (t['speaking'] or {}).get('p1'))} "
            f"P2 {n(lambda t: (t['speaking'] or {}).get('p2'))} P3 {n(lambda t: (t['speaking'] or {}).get('p3'))}")


if __name__ == "__main__":
    (OUT / "img").mkdir(parents=True, exist_ok=True)
    books = [int(b) for b in sys.argv[1:]] or list(range(1, 20))
    with ThreadPoolExecutor(6) as ex:
        for line in ex.map(run_book, books):
            print(line, flush=True)
