# /// script
# requires-python = ">=3.11"
# dependencies = ["pymupdf", "httpx", "rapidocr", "onnxruntime"]
# ///
"""Cambridge IELTS Listening + Reading extractor (PRIVATE: copyrighted, output in gitignored data/cambridge-lr/).

Usage: uv run scripts/cambridge-lr-extract.py [BOOK ...] [--stage ocr|struct|audio|figs|all] [--books-dir DIR]
See scripts/README-cambridge-lr.md. Stages are cached and resumable.
"""
import argparse, json, os, re, sys, time
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cambridge-lr"
CACHE = OUT / "cache"
BOOKS_DIR = Path.home() / "Downloads" / "Cambridge IELTS (1-19) With Audio (FULL)"
WATERMARK = re.compile(r"https?:|www\.|\.com\b|\.vn\b|ielts-?share|ieltsxpress|edit by|[一-鿿]|微信", re.I)
_ocr = None
COST_LOCK = __import__("threading").Lock()
VLM_OCR = os.environ.get("LR_VLM", "qwen/qwen3.7-flash")


def book_dir(b: int) -> Path:
    return BOOKS_DIR / f"Cambridge IELTS {b}"


def book_pdfs(b: int) -> list[Path]:
    """Test/book PDFs of a book (answer-key-only, notice and transcript PDFs excluded; those are `aux_pdfs`)."""
    return [p for p in sorted(book_dir(b).glob("*.pdf")) if not aux_kind(p)]


def aux_kind(p: Path) -> str | None:
    n = p.name.lower()
    if "notice" in n: return "notice"
    if "transcript" in n: return "transcript"
    if re.search(r"\bans\b|answers\.pdf|ans key", n) and "with answers" not in n: return "key"
    return None


def ocr_page(page: pymupdf.Page, dpi=150) -> list[list]:
    """-> [[x0,y0,x1,y1,text]] in PDF points of the displayed page."""
    global _ocr
    if _ocr is None:
        from rapidocr import LangRec, RapidOCR
        _ocr = RapidOCR(params={"Rec.lang_type": LangRec.EN, "Global.log_level": "error", "EngineConfig.onnxruntime.intra_op_num_threads": 2})
    r = _ocr(page.get_pixmap(dpi=dpi).tobytes("png"))
    k = 72 / dpi
    out = []
    for box, txt in zip(r.boxes if r.boxes is not None else [], r.txts or []):
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        out.append([round(float(min(xs)) * k, 1), round(float(min(ys)) * k, 1), round(float(max(xs)) * k, 1), round(float(max(ys)) * k, 1), str(txt)])
    return out


def layer_lines(page: pymupdf.Page) -> list[list]:
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).strip()
            if t:
                r = pymupdf.Rect(l["bbox"]) * page.rotation_matrix
                out.append([round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1), t])
    return out


def lines_to_text(boxes: list[list], width: float) -> str:
    """Group boxes into visual rows (left-to-right, wide gaps -> TAB), rows top-to-bottom; left/right page of a spread separately."""
    boxes = [b for b in boxes if b[4].strip() and not WATERMARK.search(b[4])]
    halves = [boxes]
    if width > 700:  # landscape spread
        halves = [[b for b in boxes if b[0] < width / 2], [b for b in boxes if b[0] >= width / 2]]
    out = []
    for h in halves:
        rows = []
        for b in sorted(h, key=lambda b: (b[1] + b[3]) / 2):
            yc = (b[1] + b[3]) / 2
            if rows and abs(rows[-1][0] - yc) < (b[3] - b[1]) * 0.5:
                rows[-1][1].append(b)
            else:
                rows.append([yc, [b]])
        pitch = sorted(b[0] - a[0] for a, b in zip(rows, rows[1:]) if b[0] > a[0])
        med = pitch[len(pitch) // 2] if pitch else 0
        for ri, (yc, bs) in enumerate(rows):
            if ri and med and yc - rows[ri - 1][0] > 1.45 * med: out.append("")  # paragraph gap
            bs.sort(key=lambda b: b[0])
            s = bs[0][4]
            for p, q in zip(bs, bs[1:]):
                s += ("\t" if q[0] - p[2] > 25 else " ") + q[4]
            out.append(s.strip())
        out.append("\f")
    return "\n".join(out)


def vlm_text(key: str, png: bytes, spread: bool) -> str:
    """Transcribe one scanned page with a cheap VLM (cached). RapidOCR was too slow on the shared laptop (~30 s/page under load) and drops blanks."""
    import base64, httpx
    cf = CACHE / "vlm" / f"{key}.txt"
    if cf.exists(): return cf.read_text()
    prompt = ("Transcribe this scanned test page exactly as text, top to bottom" + (" (it is a two-page spread: left page first, then right page, separated by a line '---')" if spread else "") +
              ". Keep the visible structure: one line per printed line for lists/forms, tables with | between columns, option letters (A, B, C), paragraph letters, headings, bullets. "
              "Mark every answer blank (dotted line, underline or box) as [___] right after its printed question number if it has one. For a figure (map, plan, diagram, picture) write [FIGURE: one-line description] and transcribe the labels and letters inside it. "
              "Ignore watermarks (Chinese text, website names), page numbers and footers. No commentary.")
    body = {"model": VLM_OCR, "usage": {"include": True}, "max_tokens": 4000, "temperature": 0, "reasoning": {"effort": "none"},
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}}]}]}
    for attempt in range(4):
        try:
            if spent() > BUDGET - 0.15: sys.exit("BUDGET nearly exhausted")
            r = httpx.post("https://openrouter.ai/api/v1/chat/completions", headers={"Authorization": "Bearer " + env_key()}, json=body, timeout=240)
            r.raise_for_status()
            d = r.json()
            txt = d["choices"][0]["message"]["content"] or ""
            if len(txt) < 20 and attempt < 2: raise ValueError("empty")
            break
        except Exception as e:
            print("  vlm retry", key, e, flush=True); time.sleep(4 * (attempt + 1))
    else:
        raise RuntimeError("vlm failed " + key)
    u = d.get("usage", {})
    with COST_LOCK:
        total = spent() + float(u.get("cost") or 0)
        with open(OUT / "cost.log", "a") as f: f.write(f"{time.strftime('%F %T')} ocr {key} in={u.get('prompt_tokens')} out={u.get('completion_tokens')} cost={u.get('cost')} total {total:.4f}\n")
    cf.parent.mkdir(parents=True, exist_ok=True)
    cf.write_text(txt)
    return txt


def stage_ocr(b: int):
    """pages/C{b}.json: [{file, page, text, ocr}] for every PDF page: the text layer when real, else VLM transcription (cached)."""
    from concurrent.futures import ThreadPoolExecutor
    pages = []
    files = book_pdfs(b) + [p for p in sorted(book_dir(b).glob("*.pdf")) if aux_kind(p) in ("key", "transcript")]
    for pdf in files:
        doc = pymupdf.open(pdf)
        jobs = []
        for i, pg in enumerate(doc):
            lines = layer_lines(pg)
            n_chars = sum(len(l[4]) for l in lines if not WATERMARK.search(l[4]))
            rec = {"file": pdf.name, "page": i, "ocr": n_chars < 150, "w": round(pg.rect.width), "h": round(pg.rect.height)}
            if rec["ocr"]:
                spread = pg.rect.width > pg.rect.height * 1.2
                jobs.append((rec, f"C{b}-{re.sub(r'[^A-Za-z0-9]+', '_', pdf.stem)}-{i}", pg.get_pixmap(dpi=130 if spread else 110).tobytes("png"), spread))
            else:
                rec["text"] = lines_to_text(lines, pg.rect.width)
            pages.append(rec)
        with ThreadPoolExecutor(10) as ex:
            for rec, txt in zip([j[0] for j in jobs], ex.map(lambda j: vlm_text(j[1], j[2], j[3]), jobs)):
                rec["text"] = txt
        print(f"C{b} {pdf.name}: {len(doc)} pages, {len(jobs)} transcribed", flush=True)
    (OUT / "pages" / f"C{b}.json").write_text(json.dumps(pages))
    print(f"C{b}: {len(pages)} pages, {sum(p['ocr'] for p in pages)} via VLM", flush=True)


# ---------------------------------------------------------------- LLM (OpenRouter), cached, cost-tracked
MODEL = os.environ.get("LR_MODEL", "openai/gpt-6-luna")
BUDGET = 3.00


def env_key() -> str:
    k = os.environ.get("OPENROUTER_API_KEY")
    if not k:
        for line in (ROOT / ".env").read_text().splitlines():
            if line.startswith("OPENROUTER_API_KEY="): k = line.split("=", 1)[1].strip().strip("\"'")
    return k or sys.exit("OPENROUTER_API_KEY missing")


def spent() -> float:
    f = OUT / "cost.log"
    if not f.exists(): return 0.0
    last = f.read_text().strip().splitlines()[-1:]
    return float(last[0].split()[-1]) if last else 0.0


def llm(tag: str, system: str, user: str, model: str = None, images: list[bytes] | None = None, max_tokens=16000) -> dict:
    """JSON-mode chat call. Cached by content hash so reruns are free. Aborts when the budget is nearly spent."""
    import base64, hashlib, httpx
    model = model or MODEL
    key = hashlib.sha256(json.dumps([model, system, user, len(images or [])]).encode() + b"".join(images or [])).hexdigest()[:20]
    cf = CACHE / "llm" / f"{tag}-{key}.json"
    if cf.exists(): return json.loads(cf.read_text())
    if spent() > BUDGET - 0.15: sys.exit(f"BUDGET nearly exhausted: ${spent():.3f}")
    content = [{"type": "text", "text": user}] + [{"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(i).decode()}} for i in images or []]
    body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": content if images else user}],
            "response_format": {"type": "json_object"}, "max_tokens": max_tokens, "temperature": 0, "usage": {"include": True}, "reasoning": {"effort": "minimal"}}
    for attempt in range(4):
        try:
            r = httpx.post("https://openrouter.ai/api/v1/chat/completions", headers={"Authorization": "Bearer " + env_key()}, json=body, timeout=300)
            if r.status_code >= 400: raise RuntimeError(f"{r.status_code} {r.text[:300]}")
            d = r.json()
            break
        except Exception as e:
            print("  llm retry", tag, str(e)[:300], flush=True); time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError("llm failed " + tag)
    u = d.get("usage", {})
    with COST_LOCK:
        total = spent() + float(u.get("cost") or 0)
        with open(OUT / "cost.log", "a") as f: f.write(f"{time.strftime('%F %T')} {tag} {model} in={u.get('prompt_tokens')} out={u.get('completion_tokens')} cost={u.get('cost')} total {total:.4f}\n")
    txt = d["choices"][0]["message"]["content"]
    txt = re.sub(r"^```(?:json)?\s*|\s*```$", "", txt.strip())
    out = json.loads(txt)
    cf.parent.mkdir(parents=True, exist_ok=True)
    cf.write_text(json.dumps(out))
    return out


# ---------------------------------------------------------------- structuring (text -> LrTest JSON)
HEAD = re.compile(r"^\W*(test\s*\d|listening|reading|writing|speaking|section\s*\d|part\s*\d|reading passage\s*\d|questions?\s*\d+|audioscripts?|answer keys?|listening and reading|general training|academic|sample|transcript|recording)", re.I)

SYS_COMMON = """You convert OCR text of Cambridge IELTS practice-test pages into strict JSON. Text comes from OCR: fix obvious OCR errors (merged words, stray symbols, watermarks, page numbers, arrows like '-> p. 122', Chinese text, 'IELTSXpress.com'), but never invent or paraphrase content. Blanks in the source (dotted lines/underscores) are usually lost by OCR; they sit where a bare question number, '.', '..' or a gap appears.
Output ONE JSON object only.

Question group schema (LrGroup):
{"from":int,"to":int,"type":"gap|mcq|mcq-multi|tfng|ynng|match","instructions":"Questions 1-10. Complete the form below. (plus the rubric line(s) such as 'Choose ONE WORD ONLY from the passage for each answer.'; omit 'Write your answers in boxes' boilerplate)","wordLimit":"ONE WORD AND/OR A NUMBER" (gap only, e.g. 'ONE WORD ONLY','NO MORE THAN TWO WORDS','TWO WORDS AND/OR A NUMBER'; omit if none, e.g. word-box summaries),"title":"optional heading of the form/notes/table","content":"markdown, gap groups only","options":[{"key":"A","text":"..."}],"reusable":bool,"image":true|omitted,"figure_page":page index (the '=== PAGE n ===' number) of the figure when image is true,"questions":[{"n":int,"text":"...","options":[{"key":"A","text":"..."}]}]}
Rules per type:
- gap: completion of any kind (form, notes, table, flow-chart, sentence, summary, short-answer questions, diagram/map labels typed as words). Put the whole form/notes/table/flow-chart into group.content as markdown (GFM tables with | allowed, headings, bullets) keeping its visible structure and wording, with {{n}} exactly where blank n is (e.g. 'Name: {{1}}'). Then questions are just [{"n":1},{"n":2}...] with no text. For separate sentences or short-answer questions instead leave content out and give each question text containing {{n}} (for a short-answer question append ' {{n}}' to the question, e.g. 'Which day is the trip? {{3}}'). Summary completion with a word box (letters A-L): type 'gap', put the summary in content with {{n}}, the box in group.options (key letter, text word), questions [{"n"}].
- mcq: one answer per question from its own options (A-C/D): questions have text and options.
- mcq-multi: 'Choose TWO/THREE letters': ONE stem; put the stem into instructions, shared options in group.options, one question entry per question number covering it ({"n":21},{"n":22}), no text.
- tfng: TRUE/FALSE/NOT GIVEN; ynng: YES/NO/NOT GIVEN; questions have statement text.
- match: items matched to a shared option list (headings i-ix, paragraph letters, people, features, sentence endings, map/plan letters A-H): group.options = the shared list (key = letter or lowercase roman numeral), questions have text = the item to match (for map/plan label questions text = the place name, options keys = the letters on the map, text = same letter). 'reusable' true when instructions say any letter may be used more than once. Matching paragraph information ('Which paragraph contains...') has options A-G with text = same letter.
- Diagram/map/plan figures that are pictures: set "image": true and "figure_page". Labels typed as words on a diagram: type 'gap', questions [{"n":..,"text":"Label name {{n}}"}]. Do not put flow-charts/tables that OCR read as text into images; use content.
Question numbers must be contiguous across the whole test; use the numbers printed in the source. Do not include answers (they come from the key separately).
"""

SYS_LISTEN = SYS_COMMON + """
Task: structure ONE listening section. Input: page texts (pages may also contain neighbouring sections; use only the requested section's questions). Output: {"title":"short description if the book gives one else omitted","groups":[LrGroup...]}"""

SYS_READ = SYS_COMMON + """
Task: structure ONE reading passage/section with its questions. Output: {"passage":{"title":"","subtitle":"(the italic standing line under the title, if any)","paragraphs":[{"label":"A","text":"..."}]},"groups":[LrGroup...]}
Passage rules: reproduce the full passage text faithfully; join OCR line breaks into flowing paragraphs, fix hyphenation across lines, keep footnotes (lines starting with *) as their own final paragraph without label. If paragraphs carry letters A, B, C... put the letter in label and not in text; otherwise no label. For General Training sections that contain several short texts (adverts, notices, articles) put each text's heading as its own paragraph with no label whose text starts with '### ', followed by the text's paragraphs. Never put the questions inside the passage. A passage may continue over several pages; page numbers/running heads are noise."""

SYS_KEY = """You read OCR text of the Listening and Reading answer-key pages of a Cambridge IELTS book and return the answers as JSON. Output: {"tests":{"1":{"listening":{"1":["answer", ...]},"reading":{"1":["..."]}}}} where the inner key is the question number as a string (1-40 for the whole test, listening 1-40, reading 1-40) and the value is the list of ACCEPTED alternatives for that question. Rules: split alternatives written with '/' or 'OR' into separate array entries (e.g. 'colour/color' -> ["colour","color"]); keep optional words in parentheses exactly as printed '(the) river'; keep letters/roman numerals as printed (letters uppercase A-H, roman numerals lowercase 'iv'); TRUE/FALSE/NOT GIVEN/YES/NO uppercase; for 'in either order' pairs (e.g. '21&22 (in either order) A, C') give each question the printed letters of its own line as listed; fix OCR errors. Remove explanatory page references. Use the test numbers as printed in the book. If the book has both an Academic and a General Training reading key, return the General Training one under the key "reading_gt" with its own sections, and the academic under "reading"."""

SYS_LOC = """You get, for each page of a Cambridge IELTS book (global page index, source file name and the heading-like lines on the page), and must locate the Listening and Reading test content. Output JSON: {"tests":[{"test":1,"variant":"academic"|"general","listening":{"1":[first_page,last_page],"2":[..],"3":[..],"4":[..]},"reading":{"1":[..],"2":[..],"3":[..]},"audioscript":{"1":[..],...},"key":[first_page,last_page]}]} Page numbers are the global indices given. Ranges are inclusive and include every page holding that section's questions (listening: question pages of that section only; reading: passage pages and its question pages). Use the test number printed in the book (some books number tests 5-8). Omit what the book does not contain (e.g. 'listening' for a General Training reading book that repeats the listening). 'audioscript' ranges are the transcript pages of each listening section (it may start/end mid page: include those pages). 'key' is the page range of the Listening and Reading answer key for that test (usually the same range for all tests). Writing/speaking pages and sample answers are not needed. Reading in a General Training book is 3 sections (Section 1-3) that you map to 1-3."""


def load_pages(b: int) -> list[dict]:
    f = OUT / "pages" / f"C{b}.json"
    return json.loads(f.read_text()) if f.exists() else []


def digest(pages: list[dict]) -> str:
    out = []
    for i, p in enumerate(pages):
        hs = [l.strip()[:70] for l in p["text"].splitlines() if HEAD.match(l.strip())][:7]
        first = " ".join(p["text"].split())[:90]
        out.append(f"[{i}] {p['file'][:28]} | {' / '.join(hs)} || {first}")
    return "\n".join(out)


def locate(b: int, pages: list[dict]) -> dict:
    return llm(f"C{b}-loc", SYS_LOC, f"Book: Cambridge IELTS {b}\n\n" + digest(pages))


def span(pages, a, z) -> str:
    return "\n".join(f"=== PAGE {i} ===\n{pages[i]['text'].replace(chr(12), '')}" for i in range(max(a, 0), min(z, len(pages) - 1) + 1))


def section_check(groups: list[dict]) -> list[str]:
    errs = []
    for g in groups:
        qs = g.get("questions") or []
        if not qs: errs.append(f"group {g.get('from')} has no questions")
        elif [q["n"] for q in qs] != list(range(g["from"], g["to"] + 1)): errs.append(f"group {g['from']}-{g['to']}: questions {[q['n'] for q in qs]} do not cover its range")
        if g.get("type") == "gap" and not g.get("image"):
            body = (g.get("content") or "") + " ".join(q.get("text") or "" for q in qs)
            miss = [q["n"] for q in qs if "{{%d}}" % q["n"] not in body and not g.get("options")]
            if miss: errs.append(f"group {g['from']}-{g['to']}: missing placeholders {miss}")
    return errs


def structure_section(tag: str, system: str, user: str, expect: tuple[int, int], key=None) -> dict:
    """LLM call + retry with the error list when the question numbers do not match `expect` (first, last)."""
    last = None
    msg = user
    for attempt in range(3):
        out = llm(f"{tag}-a{attempt}", system, msg)
        errs = section_check(out.get("groups", []))
        nums = [q["n"] for g in out.get("groups", []) for q in g.get("questions", [])]
        if nums != list(range(expect[0], expect[1] + 1)): errs.append(f"questions found {nums[:1]}..{nums[-1:]} (count {len(nums)}), expected {expect[0]}-{expect[1]}")
        if not errs: return out
        last = out
        msg = user + "\n\nYour previous output had these problems, fix them:\n- " + "\n- ".join(errs)
    out = dict(last); out["_errors"] = errs
    return out

SYS_TRANS = """You extract ONE section's recording transcript from OCR text of a Cambridge IELTS audioscript. Output a JSON object {"transcript":"..."}: plain text, one line per speaker turn, speaker label kept as printed in capitals/names (e.g. 'MAN:', 'WOMAN:', 'Tutor:', 'NARRATOR:' lines are kept) followed by the words. Fix OCR errors and join broken lines, remove page numbers, running heads, watermarks and the headings of other sections; cut everything after this section ends (the next 'SECTION n'/'PART n' heading, or the next test). Do not summarise or invent text."""


def stage_struct(b: int, only_tests: set[int] | None = None):
    pages = load_pages(b)
    if not pages: return print(f"C{b}: no pages (run ocr stage)")
    loc = locate(b, pages)
    # one key call per source file (a book can ship an Academic and a General Training key with the same test numbers)
    by_file: dict[str, list[int]] = {}
    for t in loc["tests"]:
        if t.get("key"):
            for i in range(t["key"][0], t["key"][1] + 1): by_file.setdefault(pages[i]["file"], []).append(i)
    keys = {f: llm(f"C{b}-key-{n}", SYS_KEY, f"Book: Cambridge IELTS {b}\n\n" + "\n".join(f"=== PAGE {i} ===\n{pages[i]['text']}" for i in sorted(set(ix))))
            for n, (f, ix) in enumerate(by_file.items())}
    for n, (f, ix) in enumerate(list(by_file.items())):
        if key_gaps(keys[f], [t for t in loc["tests"] if t.get("key") and pages[t["key"][0]]["file"] == f]):
            print(f"C{b}: key text incomplete ({key_gaps(keys[f], [t for t in loc['tests'] if t.get('key') and pages[t['key'][0]]['file'] == f])}); re-reading key pages as images", flush=True)
            doc = pymupdf.open(book_dir(b) / f)
            txt = [vlm_text(f"C{b}-keyimg-{re.sub(r'[^A-Za-z0-9]+', '_', f)}-{pages[i]['page']}", doc[pages[i]["page"]].get_pixmap(dpi=130).tobytes("png"), doc[pages[i]["page"]].rect.width > doc[pages[i]["page"]].rect.height * 1.2) for i in sorted(set(ix))]
            keys[f] = llm(f"C{b}-key-{n}v", SYS_KEY, f"Book: Cambridge IELTS {b}\n\n" + "\n".join(f"=== PAGE {k} ===\n{x}" for k, x in zip(sorted(set(ix)), txt)))
            print(f"   after image re-read: {key_gaps(keys[f], [t for t in loc['tests'] if t.get('key') and pages[t['key'][0]]['file'] == f])}", flush=True)
    key = {"files": keys}
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(lambda t: do_test(b, t, pages, key), [t for t in loc["tests"] if not only_tests or int(t["test"]) in only_tests]))


def key_gaps(k: dict, tests: list[dict]) -> list[str]:
    """Question numbers without an answer in the parsed key, as 'T1L31' / 'T1R31'."""
    out = []
    for t in tests:
        kt = k.get("tests", {}).get(str(t["test"]), {})
        for skill, tag in (("listening", "L"), ("reading_gt" if t.get("variant") == "general" else "reading", "R")):
            if skill == "listening" and (t.get("variant") == "general" or not t.get("listening")): continue
            if skill != "listening" and not t.get("reading"): continue
            d = kt.get(skill) or (kt.get("reading") if skill == "reading_gt" else {}) or {}
            out += [f"T{t['test']}{tag}{n}" for n in range(1, 41) if not [x for x in d.get(str(n), []) if str(x).strip()]]
    return out


def do_test(b, t, pages, key):
    if True:
        tn, variant = int(t["test"]), t.get("variant", "academic")
        kf = pages[t["key"][0]]["file"] if t.get("key") else None
        kt = key["files"].get(kf, {}).get("tests", {}).get(str(tn), {})
        # ---- listening (General Training books repeat the Academic recordings: skip)
        if t.get("listening") and len(t["listening"]) == 4 and variant != "general":
            f = OUT / f"C{b}-T{tn}-listening.json"
            secs, bad, n0 = [], [], 1
            for part in "1234":
                a, z = t["listening"][part]
                st = structure_section(f"C{b}T{tn}-L{part}", SYS_LISTEN, f"Book {b}, Test {tn}, LISTENING SECTION {part}. Structure the questions of Section {part} only.\n\n" + span(pages, a, z), (n0, n0 + 9))
                n0 += 10
                tr = None
                if t.get("audioscript", {}).get(part):
                    # sections start/end mid-page and the locator's ranges are tight: give the whole test's audioscript (+1 page each side)
                    rng = list(t["audioscript"].values())
                    ta, tz = min(r[0] for r in rng) - 1, max(r[1] for r in rng) + 1
                    tr = llm(f"C{b}T{tn}-S{part}-tr", SYS_TRANS, f"Book {b}, Test {tn}, Section {part}. Extract only this section's transcript (pages hold several sections and tests: take exactly Test {tn} Section {part}).\n\n" + span(pages, ta, tz))["transcript"]
                secs.append({"part": int(part), "title": st.get("title") or f"Section {part}", "transcript": tr, "groups": st["groups"], "_err": st.get("_errors")})
            write_test(b, tn, "listening", "academic", secs, kt.get("listening", {}), f)
        # ---- reading
        if t.get("reading") and len(t["reading"]) == 3:
            gt = variant == "general"
            f = OUT / f"C{b}-T{tn}-reading{'-gt' if gt else ''}.json"
            secs = []
            bounds = [(1, 14), (15, 26), (27, 40)] if gt else [(1, 13), (14, 26), (27, 40)]
            for part, (lo, hi) in zip("123", bounds):
                a, z = t["reading"][part]
                st = structure_reading(b, tn, part, gt, pages, a, z, bounds)
                secs.append({"part": int(part), "passage": st["passage"], "groups": st["groups"], "_err": st.get("_errors")})
            write_test(b, tn, "reading", "general" if gt else "academic", secs, kt.get("reading_gt" if gt else "reading", kt.get("reading", {})), f)


def structure_reading(b, tn, part, gt, pages, a, z, bounds):
    """Reading sections do not always split 13/13/14: take the expected first number from the previous section when known."""
    lo, hi = bounds[int(part) - 1]
    # try the standard split first, then accept any contiguous range that starts at lo
    user = f"Book {b}, Test {tn}, {'GENERAL TRAINING READING SECTION' if gt else 'READING PASSAGE'} {part}. Passage and its questions only. Question numbers use the printed numbers (the section starts at {lo}).\n\n" + span(pages, a, z)
    out = llm(f"C{b}T{tn}-R{part}{'g' if gt else ''}", SYS_READ, user)
    errs = section_check(out.get("groups", []))
    nums = [q["n"] for g in out.get("groups", []) for q in g.get("questions", [])]
    if nums[:1] != [lo] or nums != list(range(nums[0], nums[-1] + 1)) if nums else True: errs.append(f"questions must be contiguous starting at {lo}, got {nums}")
    if errs:
        out = llm(f"C{b}T{tn}-R{part}{'g' if gt else ''}-retry", SYS_READ, user + "\n\nYour previous output had these problems, fix them:\n- " + "\n- ".join(errs))
        errs = section_check(out.get("groups", []))
        out["_errors"] = errs or None
    return out


def write_test(b, tn, skill, variant, secs, ans: dict, f: Path):
    gt = variant == "general"
    qn = {}
    for s in secs:
        for g in s["groups"]:
            for q in g["questions"]: qn[q["n"]] = (g, q)
    problems = []
    for s in secs:
        for g in s["groups"]:
            ga = []
            if g.get("image") and g["type"] == "gap" and not g.get("options") and all(re.fullmatch(r"[A-Z]", str(x).strip(), re.I) for q in g["questions"] for x in ans.get(str(q["n"]), [])):
                top = max(ord(str(x).strip().upper()) for q in g["questions"] for x in ans.get(str(q["n"]), []))  # map/plan labelling by letter -> match
                m = re.search(r"\b[A-Z]\s*[-–]\s*([A-Z])\b", g.get("instructions", ""))
                top = max(top, ord(m.group(1)) if m else 0)
                g["type"], g["options"] = "match", [{"key": chr(c), "text": chr(c)} for c in range(65, top + 1)]
                for q in g["questions"]: q["text"] = re.sub(r"\s*\{\{\d+\}\}", "", q.get("text") or "").strip()
            for q in g["questions"]:
                a = [str(x).strip() for x in ans.get(str(q["n"]), []) if str(x).strip()]
                if g["type"] in ("tfng", "ynng"): a = [x.upper() for x in a]
                if g["type"] in ("mcq", "match") or (g["type"] == "gap" and g.get("options")): a = [x.upper() if not re.fullmatch(r"[ivx]+", x, re.I) else x.lower() for x in a]
                if g["type"] == "mcq-multi": a = [x.upper() for x in a]
                q["answer"] = a
                ga += a
            if g["type"] in ("tfng", "ynng"):  # the model confuses the two: the key's words decide
                g["type"] = "ynng" if {"YES", "NO"} & set(ga) else "tfng"
            if g["type"] == "mcq-multi":
                full = sorted(set(ga))
                for q in g["questions"]: q["answer"] = full
            for k in [k for k in ("wordLimit", "title", "content", "options", "reusable", "image") if g.get(k) in (None, "", False, [])]: g.pop(k, None)
            for q in g["questions"]:
                for k in [k for k in ("text", "options") if not q.get(k)]: q.pop(k, None)
        if s.get("_err"): problems.append(f"part {s['part']}: {s['_err']}")
    slug = f"cam-{b}-{tn}-" + ("l" if skill == "listening" else "rg" if gt else "r")
    test = {"slug": slug, "skill": skill, "variant": variant, "source": "cambridge", "ref": f"C{b} T{tn}",
            "title": f"Cambridge {b} · Test {tn} · {'Listening' if skill == 'listening' else 'General Training Reading' if gt else 'Reading'}", "sections": []}
    for s in secs:
        sec = {"part": s["part"]}
        if skill == "listening":
            sec["title"] = s.get("title"); sec["audio"] = f"lr/cambridge/C{b}T{tn}P{s['part']}.mp3"
            if s.get("transcript"): sec["transcript"] = s["transcript"]
        else:
            sec["passage"] = s["passage"]
        sec["groups"] = s["groups"]
        test["sections"].append(sec)
    if problems: test["_problems"] = problems  # stripped by the validator report; remove after review
    f.write_text(json.dumps(test, ensure_ascii=False, indent=1))
    print(f"  wrote {f.name} ({len(qn)} questions){' PROBLEMS: ' + str(problems) if problems else ''}", flush=True)


# ---------------------------------------------------------------- audio
def sh(cmd: list[str]) -> str:
    import subprocess
    return subprocess.run(["nice", "-n", "19"] + cmd, capture_output=True, text=True).stderr


def duration(path) -> float:
    import subprocess
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout.strip() or 0)


def audio_sources(b: int) -> dict[tuple[int, int], tuple[Path, float | None, float | None]]:
    """(test, part) -> (file, start, end); start/end None = whole file."""
    d = book_dir(b)
    mp3 = sorted(d.rglob("*.mp3"), key=lambda p: str(p))
    m = {}
    if b in (7, 8, 10, 13):  # 16 numbered tracks: CD1 tracks 1-8 = tests 1-2, CD2 = tests 3-4 (section order inside a test)
        cds = {1: [], 2: []}
        for p in mp3:
            cd = 2 if re.search(r"CD ?2", str(p.relative_to(d)), re.I) else 1
            cds[cd].append(p)
        for cd, ps in cds.items():
            ps.sort(key=lambda p: int(re.findall(r"(\d+)\.mp3$", p.name)[0]))
            for i, p in enumerate(ps): m[((cd - 1) * 2 + i // 4 + 1, i % 4 + 1)] = (p, None, None)
        return m
    for p in mp3:
        rel = str(p.relative_to(d))
        nums = re.findall(r"(?i)test\s*\.?(\d)", rel)
        sec = re.findall(r"(?i)(?:section|part|audio|-s|\.s)\s*[-.]?\s*(\d)", p.name) or re.findall(r"(?i)s(\d)\.mp3", p.name)
        if b == 15 or b == 17:
            sec = re.findall(r"audio(\d)", p.name.lower())
        if b == 18:
            nums, sec = re.findall(r"section(\d)", p.name)[:1], re.findall(r"part(\d)", p.name)
        if p.suffix.lower() == ".mp3" and nums and sec:
            m[(int(nums[0]), int(sec[0]))] = (p, None, None)
    if b == 14:  # "Test 2 Section 4.mp3" = T2S4 + end-of-test notice + T1S1 (the missing file), found by silence + STT spot checks
        f = d / "Test 2 Section 4.mp3"
        m[(2, 4)], m[(1, 1)] = (f, 0.0, 471.5), (f, 577.5, 1035.5)
    return m


def split_by_silence(p: Path) -> list[tuple[float, float]]:
    """Old books: one file per test with 4 sections separated by ~30 s pauses. -> [(start, end)] x4."""
    out = sh(["ffmpeg", "-hide_banner", "-nostats", "-i", str(p), "-af", "silencedetect=n=-40dB:d=2.5", "-f", "null", "-"])
    st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    sil = [(a, z) for a, z in zip(st, en) if 24 <= z - a <= 36]
    total = duration(p)
    if len(sil) < 3: raise RuntimeError(f"{p.name}: only {len(sil)} section pauses")
    bounds = [(0.0, sil[0][0] + 1.5), (sil[0][1] - 0.5, sil[1][0] + 1.5), (sil[1][1] - 0.5, sil[2][0] + 1.5), (sil[2][1] - 0.5, (sil[3][0] + 1.5) if len(sil) > 3 else total)]
    return bounds


def stage_audio(b: int):
    dst = OUT / "assets" / "lr" / "cambridge"
    dst.mkdir(parents=True, exist_ok=True)
    jobs = []
    if b in (1, 2, 3):
        files = sorted(book_dir(b).glob("*.mp3"))
        for ti, p in enumerate(files):
            for part, (a, z) in enumerate(split_by_silence(p), 1): jobs.append(((ti + 1, part), p, a, z))
    else:
        jobs = [(k, p, a, z) for k, (p, a, z) in sorted(audio_sources(b).items())]
    for (t, part), p, a, z in jobs:
        out = dst / f"C{b}T{t}P{part}.mp3"
        if out.exists() and out.stat().st_size > 10000: continue
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-threads", "2"] + (["-ss", f"{a:.2f}", "-to", f"{z:.2f}"] if a is not None else []) + ["-i", str(p), "-vn", "-ac", "1", "-ar", "44100", "-b:a", "64k", str(out)]
        sh(cmd)
        print(f"  audio {out.name} {duration(out):.0f}s <- {p.name}", flush=True)
    print(f"C{b}: audio {len(jobs)} sections", flush=True)


# ---------------------------------------------------------------- figures (maps / plans / diagrams)
VLM = "qwen/qwen3.8-flash"
SYS_BBOX = 'You locate a figure on a scanned test page. Reply JSON {"bbox":[x0,y0,x1,y1]} with coordinates normalised to 0-1000 (x right, y down) of the tight box around the figure (map, plan or diagram including its letters, numbers and labels, and the box of label words if the questions are about it) that belongs to the given questions. Exclude the instructions, question list text, page number, watermark and footer.'


def stage_figs(b: int):
    pages = load_pages(b)
    docs: dict[str, pymupdf.Document] = {}
    for f in sorted(OUT.glob(f"C{b}-T*-*.json")):
        t = json.loads(f.read_text())
        changed = False
        tn = re.search(r"-T(\d+)-", f.name).group(1)
        for s in t["sections"]:
            for g in s["groups"]:
                if g.get("image") is not True: continue
                pg = pages[g["figure_page"]]
                doc = docs.setdefault(pg["file"], pymupdf.open(book_dir(b) / pg["file"]))
                page = doc[pg["page"]]
                png = page.get_pixmap(dpi=100).tobytes("png")
                bb = llm(f"C{b}T{tn}-bbox{g['from']}", SYS_BBOX, f"Questions {g['from']}-{g['to']}: {g.get('instructions', '')[:200]}", model=VLM, images=[png])["bbox"]
                x0, y0, x1, y1 = [max(0, min(1000, float(v))) / 1000 for v in bb]
                pad = 0.01
                r = pymupdf.Rect(max(0, x0 - pad) * page.rect.width, max(0, y0 - pad) * page.rect.height, min(1, x1 + pad) * page.rect.width, min(1, y1 + pad) * page.rect.height)
                key = f"lr/cambridge/img/C{b}T{tn}-q{g['from']}.png"
                (OUT / "assets" / key).parent.mkdir(parents=True, exist_ok=True)
                page.get_pixmap(dpi=170, clip=r).save(OUT / "assets" / key)
                g["image"] = key; g.pop("figure_page", None); changed = True
                print(f"  figure {key}", flush=True)
        if changed: f.write_text(json.dumps(t, ensure_ascii=False, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("books", nargs="*", type=int)
    ap.add_argument("--stage", default="all")
    ap.add_argument("--books-dir")
    a = ap.parse_args()
    global BOOKS_DIR
    if a.books_dir: BOOKS_DIR = Path(a.books_dir)
    for b in a.books or range(1, 20):
        if a.stage in ("ocr", "all"): stage_ocr(b)
        if a.stage in ("audio", "all"): stage_audio(b)
        if a.stage in ("struct", "all"): stage_struct(b)
        if a.stage in ("figs", "all"): stage_figs(b)


if __name__ == "__main__":
    main()
