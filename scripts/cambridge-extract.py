# /// script
# requires-python = ">=3.11"
# dependencies = ["pymupdf", "httpx", "rapidocr", "onnxruntime"]
# ///
"""Extracts Writing T1/T2 + Speaking P1-P3 per test from the Cambridge IELTS PDFs (PRIVATE, output is gitignored).

Usage: uv run scripts/cambridge-extract.py [BOOK ...] [--books-dir DIR] [--no-llm]
Output: data/cambridge/C{b}.json + data/cambridge/img/C{b}T{t}.png. See scripts/README-cambridge.md.
"""
import argparse, base64, json, os, re, sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cambridge"
CACHE = OUT / "cache"
BOOKS_DIR = Path.home() / "Downloads" / "Cambridge IELTS (1-19) With Audio (FULL)"
SKIP_FILE = re.compile(r"\bans\b|key|notice|transcript|\d\s*answers", re.I)  # answer-key-only files; "with Answers" books are kept
LLM_MODEL = "google/gemini-2.5-flash"
# watermarks, page numbers, running heads, "→ p. 127" answer pointers
NOISE = re.compile(r"https?:|www\.|\.com|\.vn|ielts-?share|edit by|[一-鿿]|^\W*\d{1,3}\W*$|^\W*p\.\s*\d+|^\W*(test \d|writing|speaking)\W*$", re.I)
BULLET = re.compile(r"^[\s•●◦·°*o\-–—]+(?=[A-Z\[])|^[\s•●◦·°*\-–—]+")
# The P2 sidebar sits beside the cue card, so its fragments interleave with the card lines; drop any fragment of it.
SIDEBAR = re.sub(r"\W+", "", "you will have to talk about the topic for one to two minutes you have one minute to think about what you are going to say you can make some notes to help you if you wish talk about the topic for 1 to 2 minutes what youre going to say".lower())

norm = lambda s: re.sub(r"[^A-Z0-9]", "", s.upper())
_ocr = None


def ocr(page: pymupdf.Page, clip=None, dpi=150) -> list[tuple[str, pymupdf.Rect]]:
    global _ocr
    if _ocr is None:
        from rapidocr import LangRec, RapidOCR
        _ocr = RapidOCR(params={"Rec.lang_type": LangRec.EN, "Global.log_level": "error", "EngineConfig.onnxruntime.intra_op_num_threads": 2})
    pix = page.get_pixmap(dpi=dpi, clip=clip)  # clip is in displayed (rotated) coords
    r = _ocr(pix.tobytes("png"))
    k, ox, oy = 72 / dpi, (clip or page.rect).x0, (clip or page.rect).y0
    out = []
    for box, txt in zip(r.boxes if r.boxes is not None else [], r.txts or []):
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        out.append((txt, pymupdf.Rect(ox + min(xs) * k, oy + min(ys) * k, ox + max(xs) * k, oy + max(ys) * k)))
    return out


def cached(key: str, fn) -> list[tuple[str, pymupdf.Rect]]:
    f = CACHE / f"{key}.json"
    if f.exists():
        return [(t, pymupdf.Rect(r)) for t, r in json.loads(f.read_text())]
    v = fn()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps([(t, list(r)) for t, r in v]))
    return v


def text_lines(page: pymupdf.Page) -> list[tuple[str, pymupdf.Rect]]:
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).strip()
            if t:
                out.append((t, pymupdf.Rect(l["bbox"]) * page.rotation_matrix))  # displayed (rotated) coords, like OCR
    return out


def clean(lines, page: pymupdf.Page):
    lines = [(t.strip(), r) for t, r in lines if t.strip() and not NOISE.search(t.strip())]
    # reading order: left/right half first on two-page spreads, then rows top-to-bottom (4pt tolerance), then left-to-right
    return sorted(lines, key=lambda x: (half(page, x[1]), round(x[1].y0 / 4), x[1].x0))


def half(page: pymupdf.Page, r: pymupdf.Rect) -> int:
    """0 for portrait pages; 0/1 for the left/right page of a landscape two-page spread."""
    return int(page.rect.width > page.rect.height and r.x0 >= page.rect.width / 2)


class Doc:
    """Page lines for one PDF: the text layer when it has real text, else local OCR (cached)."""

    def __init__(self, path: Path, key: str):
        self.doc, self.key, self.scanned = pymupdf.open(path), key, set()

    def lines(self, i: int):
        page = self.doc[i]
        tl = clean(text_lines(page), page)
        if sum(len(re.sub(r"\W", "", t)) for t, _ in tl) >= 40:
            return tl
        self.scanned.add(i)
        return clean(cached(f"{self.key}-p{i}", lambda: ocr(page)), page)

    def candidate(self, i: int) -> bool:
        """Cheap test: does the top of the page carry a Writing/Speaking heading?"""
        page = self.doc[i]
        tl = text_lines(page)
        if sum(len(re.sub(r"\W", "", t)) for t, _ in clean(tl, page)) < 40:
            r = page.rect
            tl = cached(f"{self.key}-p{i}-top", lambda: ocr(page, pymupdf.Rect(r.x0, r.y0, r.x1, r.y0 + r.height * 0.45), dpi=90))
        n = norm(" ".join(t for t, _ in tl))
        return "WRITINGTASK" in n or "PART1" in n or "PART2" in n or "PART3" in n or "SPEAKING" in n


def join(lines: list[str]) -> str:
    out = ""
    for t in lines:
        b = bool(BULLET.match(t)) and not t.startswith("o")
        t = BULLET.sub("", t).strip()
        if not t:
            continue
        brk = b or re.match(r"(Summari[sz]e|Write|You should|Begin|Dear|You do NOT|In your letter|Give reasons|Use your own|Present a written|To what extent)", t)
        out += ("\n" if out and (brk or out[-1] in ".?!:") else " " if out else "") + ("• " if b else "") + t
    return out.strip()


def span(lines, start_pat, end_pat, after=0):
    s = next((i for i, (t, _) in enumerate(lines) if i >= after and re.search(start_pat, t, re.I)), None)
    if s is None:
        return None, None
    e = next((i for i in range(s + 1, len(lines)) if re.search(end_pat, lines[i][0], re.I)), None)
    return s, e


def parse_t1(lines, page: pymupdf.Page):
    s, e = span(lines, r"20\s*minutes", r"at\s*least\s*150\s*words")
    if s is None or e is None:
        return None
    end = e
    for j in range(e + 1, min(e + 6, len(lines))):  # GT letters: "You do NOT need to write any addresses. Begin your letter as follows: Dear ...,"
        if re.search(r"addresses|begin your letter|^dear\b", lines[j][0], re.I):
            end = j
    raw = [t for t, _ in lines[s + 1:end + 1]]
    k = next((j for j, t in enumerate(raw) if re.match(r"in your letter", t, re.I)), None)
    if k is not None:  # ponytail: OCR drops the bullet glyphs, so every line after "In your letter" is a point; a wrapped point splits in two
        raw = raw[:k + 1] + [t if BULLET.match(t) or re.match(r"(write|you do not|begin|dear)", t, re.I) else "• " + t for t in raw[k + 1:]]
    body = join(raw)
    letter = bool(re.search(r"\bletter\b", body, re.I))
    t1 = {"body": body, "hasFigure": not letter, "figurePage": page.number}
    if not letter:
        top = lines[e][1].y1 + 2
        boxes = [r for _, r in lines[end + 1:] if r.y0 >= top]
        rot, area = page.rotation_matrix, page.rect.get_area()
        boxes += [r for d in page.get_drawings() if (r := d["rect"] * rot).y0 >= top]
        boxes += [r for x in page.get_images() for r0 in page.get_image_rects(x[0]) if (r := r0 * rot).y0 >= top - 20 and r.get_area() < area * 0.8]
        bottom = page.rect.y1 - page.rect.height * 0.06
        side = half(page, lines[e][1])
        boxes = [r & pymupdf.Rect(page.rect.x0, top, page.rect.x1, bottom) for r in boxes if r.y0 < bottom and r.width < page.rect.width and half(page, r) == side]
        boxes = [r for r in boxes if not r.is_empty]
        if boxes:  # union of everything drawn below the instructions, padded
            bb = pymupdf.Rect(boxes[0])
            for r in boxes[1:]:
                bb |= r
            bb = pymupdf.Rect(bb.x0 - 12, bb.y0 - 6, bb.x1 + 12, bb.y1 + 12) & page.rect
        else:  # fallback: full page minus the instructions and footer
            w = page.rect.width / (2 if page.rect.width > page.rect.height else 1)
            bb = pymupdf.Rect(page.rect.x0 + side * w, top, page.rect.x0 + (side + 1) * w, bottom)
        t1["figureBBox"] = [round(v, 1) for v in bb]
    return t1


def parse_t2(lines):
    s, e = span(lines, r"40\s*minutes", r"at\s*least\s*250\s*words")
    if s is None or e is None:
        return None
    for j in range(e + 1, min(e + 4, len(lines))):  # older books put "Use your own ideas ... evidence." after the word count
        if re.search(r"experience\.|evidence\.", lines[j][0]):
            e = j
    body = [t for t, _ in lines[s + 1:e + 1] if not re.match(r"write about the following topic", t, re.I)]
    return {"body": join(body)}


def questions(lines: list[str]) -> list[str]:
    qs, buf = [], ""
    for t in lines:
        t = re.sub(r"\?\[", "? [", BULLET.sub("", t).strip())
        words = t.split()
        if len(re.sub(r"\W", "", t)) < 2 or sum(map(len, words)) / len(words) < 2.2:  # OCR confetti
            continue
        if not buf and t.startswith("[") and qs:  # "[Why/Why not?]" wrapped onto its own line
            qs[-1] += " " + t
            continue
        buf = f"{buf} {t}".strip()
        if buf.endswith(("?", "]")):
            qs.append(buf)
            buf = ""
    return qs


def parse_speaking(lines):
    ln = [t for t, _ in lines if not (len(norm(t)) > 3 and norm(t).lower() in SIDEBAR)]
    idx = lambda pat, after=0: next((i for i, t in enumerate(ln) if i >= after and re.fullmatch(pat, norm(t))), None)
    p2i = idx("PART2")
    if p2i is None:
        return None
    # cue card: title lines up to "You should say:", bullets up to "and explain ...", explain up to the full stop
    ts = next((i for i in range(p2i + 1, len(ln)) if re.match(r"(describe|talk about|tell me)\b", ln[i], re.I)), None)
    if ts is None:
        return None
    say = next((i for i in range(ts, len(ln)) if re.match(r"you should say", ln[i], re.I)), None)
    if say is None:  # OCR sometimes drops "You should say:"; the title then ends at its full stop
        say = next((i + 1 for i in range(ts, len(ln)) if ln[i].rstrip().endswith(".")), None)
        if say is None:
            return None
        ln.insert(say, "You should say:")
    ae = None
    for i in range(say + 1, len(ln)):  # "and explain" may start a line, trail a bullet ("... and" / "explain ...") or sit mid-line
        if re.match(r"(and\b|explain\b)", ln[i], re.I):
            ae = i
        elif m := re.search(r"\s(and\s+explain\b.*)", ln[i], re.I):
            ln[i:i + 1] = [ln[i][:m.start()], m.group(1)]
            ae = i + 1
        else:
            continue
        if not ln[ae].lower().startswith("and"):
            ln[ae - 1], ln[ae] = re.sub(r"\s+and$", "", ln[ae - 1]), "and " + ln[ae]
        break
    if ae is None:
        return None
    ee = next((i for i in range(ae, len(ln)) if ln[i].rstrip().endswith(".")), ae)
    card = set(range(ts, ee + 1))
    bullets: list[str] = []
    for t in ln[say + 1:ae]:
        t = BULLET.sub("", t).strip()
        # ponytail: a line not opening with a wh-word continues the previous bullet (narrow card column); fails on rare noun-led bullets
        if bullets and not re.match(r"(what|who|when|where|why|how|which|whether|if|whose)\b", t, re.I):
            bullets[-1] += " " + t
        else:
            bullets.append(t)
    p2 = {"title": join(ln[ts:say]), "bullets": bullets, "explain": join(ln[ae:ee + 1])}
    p1, p3 = idx("PART1?"), idx("PART3")  # after the edits to ln above; OCR sometimes loses the "1"
    sp = {"p1": [], "p2": p2, "p3": []}
    if p1 is not None:
        body = [t for i, t in enumerate(ln[p1 + 1:p2i], p1 + 1) if i not in card]
        ex = next((i for i, t in enumerate(body) if norm(t) == "EXAMPLE"), None)
        if ex is not None and ex + 1 < len(body):
            sp["p1"] = [{"topic": body[ex + 1].strip(), "questions": questions(body[ex + 2:])}]
    if p3 is not None:
        body = [t for i, t in enumerate(ln[p3 + 1:], p3 + 1) if i not in card and norm(t) not in ("DISCUSSIONTOPICS", "PART2")]
        cur = None
        for j, t in enumerate(body):
            if norm(t) == "EXAMPLEQUESTIONS":
                continue
            if j + 1 < len(body) and norm(body[j + 1]) == "EXAMPLEQUESTIONS":
                cur = {"topic": t.strip(), "lines": []}
                sp["p3"].append(cur)
            elif cur:
                cur["lines"].append(t)
        sp["p3"] = [{"topic": c["topic"], "questions": questions(c["lines"])} for c in sp["p3"]]
    return sp


def missing(t) -> list[str]:
    need = ["t1", "t2"] + ([] if t["variant"] == "general" or t["book"] <= 2 else ["p1", "p2", "p3"])  # C1-2 use the pre-2001 speaking format
    have = {"t1": t["writing"].get("t1"), "t2": t["writing"].get("t2"), "p1": (t["speaking"] or {}).get("p1"), "p2": (t["speaking"] or {}).get("p2"), "p3": (t["speaking"] or {}).get("p3")}
    return [k for k in need if not have[k]]


def api_key() -> str | None:
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"]
    env = ROOT / ".env"
    if env.exists():
        m = re.search(r"^OPENROUTER_API_KEY=[ \t]*['\"]?([^'\"\s]*)", env.read_text(), re.M)
        return (m and m.group(1)) or None
    return None


LLM_PROMPT = """These are pages of one Cambridge IELTS practice test (page images plus their OCR text). Extract the exam prompts VERBATIM.
Return ONLY JSON: {"writing":{"t1":{"body":str}|null,"t2":{"body":str}|null},"speaking":{"p1":[{"topic":str,"questions":[str]}],"p2":{"title":str,"bullets":[str],"explain":str}|null,"p3":[{"topic":str,"questions":[str]}]}|null}
t1/t2 body = the task text between "You should spend about N minutes on this task." and the word count line (inclusive).
p2.explain = the final "and explain ..." line; bullets = only the lines between "You should say:" and it. Leave out the Part 2 sidebar ("You will have to talk about the topic ...")."""


def llm_fix(key: str, doc: Doc, t: dict):
    import httpx
    pages = sorted(set(t["pages"]) | ({max(t["pages"]) + 1} if not t["speaking"] and max(t["pages"]) + 1 < len(doc.doc) else set()))  # speaking usually follows Task 2
    content = [{"type": "text", "text": LLM_PROMPT}]
    for i in pages:
        png = base64.b64encode(doc.doc[i].get_pixmap(dpi=110).tobytes("png")).decode()
        content += [{"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png}"}}, {"type": "text", "text": f"Page {i} OCR:\n" + "\n".join(x for x, _ in doc.lines(i))}]
    r = httpx.post("https://openrouter.ai/api/v1/chat/completions", headers={"Authorization": f"Bearer {key}"}, timeout=180,
                   json={"model": LLM_MODEL, "messages": [{"role": "user", "content": content}], "response_format": {"type": "json_object"}, "temperature": 0})
    r.raise_for_status()
    txt = r.json()["choices"][0]["message"]["content"]
    got = json.loads(txt[txt.find("{"):txt.rfind("}") + 1])
    for k in ("t1", "t2"):
        if not t["writing"].get(k) and (got.get("writing") or {}).get(k):
            t["writing"][k] = {**got["writing"][k], **({"hasFigure": False} if k == "t1" else {})}
    gs = got.get("speaking") or {}
    t["speaking"] = t["speaking"] or {"p1": [], "p2": None, "p3": []}
    for k in ("p1", "p2", "p3"):
        if not t["speaking"].get(k) and gs.get(k):
            t["speaking"][k] = gs[k]
    p2 = t["speaking"].get("p2")
    if p2 and p2.get("bullets") and p2["bullets"][-1].lower().startswith("and "):  # model put "and explain" in the bullets
        p2["explain"] = p2["bullets"].pop()
    if p2:
        p2["title"] = " ".join(p2["title"].split())
    t["llm"] = True


def extract_file(book: int, path: Path, tests: list, variant_default: str, key: str | None):
    doc = Doc(path, f"C{book}-{re.sub(r'\W+', '_', path.stem)}")
    counters = {"academic": sum(t["variant"] == "academic" for t in tests), "general": sum(t["variant"] == "general" for t in tests)}
    cur, mine = None, []

    def new(variant):
        nonlocal cur
        counters[variant] += 1
        n = counters[variant]
        cur = {"book": book, "test": str(n) if variant == "academic" else f"g{n}", "variant": variant, "file": path.name, "pages": [], "writing": {}, "speaking": None}
        mine.append(cur)

    i = 0
    while i < len(doc.doc):
        if not doc.candidate(i):
            i += 1
            continue
        lines = doc.lines(i)
        n = norm(" ".join(t for t, _ in lines))
        t1s = [j for j, (t, _) in enumerate(lines) if "WRITINGTASK1" in norm(t)]
        t2s = [j for j, (t, _) in enumerate(lines) if "WRITINGTASK2" in norm(t)]
        if t1s and "20MINUTES" in n:
            part = lines[t1s[0]:(t2s[0] if t2s and t2s[0] > t1s[0] else None)]
            t1 = parse_t1(part, doc.doc[i])
            if t1:
                new("general" if not t1["hasFigure"] or variant_default == "general" else "academic")
                cur["writing"]["t1"] = t1
                cur["pages"].append(i)
        if t2s and "40MINUTES" in n:
            t2 = parse_t2(lines[t2s[0]:])
            if t2:
                if not cur or cur["writing"].get("t2"):
                    new(variant_default)
                cur["writing"]["t2"] = t2
                cur["pages"].append(i)
        if "PART2" in n and ("YOUSHOULDSAY" in n or "EXAMPLEQUESTIONS" in n):
            if "PART3" not in n and i + 1 < len(doc.doc):  # Part 3 continues overleaf
                lines = lines + doc.lines(i + 1)
            sp = parse_speaking(lines)
            if sp and cur and not cur["speaking"]:
                cur["speaking"] = sp
                cur["pages"] += [i, i + 1] if "PART3" not in n else [i]
        i += 1

    for t in mine:
        t["scanned"] = any(p in doc.scanned for p in t["pages"])
        if key and missing(t):
            try:
                llm_fix(key, doc, t)
            except Exception as e:  # keep the deterministic result; report it
                print(f"  C{book} T{t['test']}: LLM pass failed: {e}", file=sys.stderr)
        f = t["writing"].get("t1")
        if f and f.get("figureBBox"):
            img = OUT / "img" / f"C{book}T{t['test']}.png"
            img.parent.mkdir(parents=True, exist_ok=True)
            doc.doc[f["figurePage"]].get_pixmap(dpi=150, clip=pymupdf.Rect(f["figureBBox"])).save(img)
            t["image"] = f"img/{img.name}"
    tests += mine


def run_book(book: int, folder: Path, key: str | None) -> dict:
    tests: list = []
    for pdf in sorted(p for p in folder.rglob("*.pdf") if not SKIP_FILE.search(p.name)):
        print(f"C{book}: {pdf.name}", file=sys.stderr, flush=True)
        extract_file(book, pdf, tests, "general" if re.search(r"\bgen", pdf.name, re.I) else "academic", key)
    out = {"book": book, "tests": tests}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"C{book}.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
    return out


def summary(out: dict) -> str:
    ts = out["tests"]
    gaps = [f"T{t['test']}:{'/'.join(m)}" for t in ts if (m := missing(t))]
    cnt = lambda f: sum(1 for t in ts if f(t))
    return (f"C{out['book']:<3} tests={len(ts):<2} t1={cnt(lambda t: t['writing'].get('t1'))} t2={cnt(lambda t: t['writing'].get('t2'))} "
            f"p1={cnt(lambda t: (t['speaking'] or {}).get('p1'))} p2={cnt(lambda t: (t['speaking'] or {}).get('p2'))} p3={cnt(lambda t: (t['speaking'] or {}).get('p3'))} "
            f"img={cnt(lambda t: t.get('image'))} ocr={cnt(lambda t: t['scanned'])}" + (f"  NEEDS LLM: {' '.join(gaps)}" if gaps else ""))


def selftest():
    assert questions(["• Do you like", "cats?[Why?]", "° Why not?", "[Why?]", "H¿o g s s s i g"]) == ["Do you like cats? [Why?]", "Why not? [Why?]"]
    sp = parse_speaking([(t, pymupdf.Rect()) for t in "PART 1|EXAMPLE|Pets|• Do you have a pet?|PART 2|You will have to talk|Describe a trip|you enjoyed.|about the topic for one|You should say:|where you went|who you went with and|for how long and|explain why|you enjoyed it.|PART 3|Discussion topics:|Travel|Example questions:|Why do people travel?|Is tourism|good? [Why?]".split("|")])
    assert sp["p1"] == [{"topic": "Pets", "questions": ["Do you have a pet?"]}], sp
    assert sp["p2"] == {"title": "Describe a trip you enjoyed.", "bullets": ["where you went", "who you went with and for how long"], "explain": "and explain why you enjoyed it."}, sp
    assert sp["p3"] == [{"topic": "Travel", "questions": ["Why do people travel?", "Is tourism good? [Why?]"]}], sp


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("books", nargs="*", type=int)
    ap.add_argument("--books-dir", type=Path, default=BOOKS_DIR)
    ap.add_argument("--no-llm", action="store_true")
    a = ap.parse_args()
    selftest()
    key = None if a.no_llm else api_key()
    print(f"LLM pass: {'on (' + LLM_MODEL + ')' if key else 'off (no OPENROUTER_API_KEY) - incomplete tests are listed as NEEDS LLM'}", file=sys.stderr)
    folders = {int(m.group(1)): d for d in a.books_dir.iterdir() if (m := re.search(r"IELTS\s*(\d+)$", d.name))}
    for b in sorted(a.books or folders):
        print(summary(run_book(b, folders[b], key)), flush=True)
