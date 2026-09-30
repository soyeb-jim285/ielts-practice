# /// script
# dependencies = ["pymupdf"]
# ///
"""Builds the PRIVATE scoring gold set (docs/scoring-research.md §4): examiner-marked Cambridge + ielts.org writing
scripts, controlled variants / ceiling / floor probes, and ielts.org speaking samples.

  uv run scripts/gold-build.py            # transcribe pages not yet cached (OpenRouter VLM), then build
  uv run scripts/gold-build.py --no-ocr   # build from the cache only

Writes (gitignored) data/scoring-gold/scripts.json and (committed, no text) data/scoring-gold-manifest.json.
Load into the DB with `pnpm -F @ielts/server exec tsx ../../scripts/gold-import.ts`. See scripts/README-scoring-gold.md.
"""
import base64, hashlib, html, json, os, random, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
BOOKS = Path(os.environ.get("CAMBRIDGE_DIR", "/home/jim/Downloads/Cambridge IELTS (1-19) With Audio (FULL)"))
GOLD = ROOT / "data" / "scoring-gold"
SRC, CACHE = GOLD / "src", GOLD / "ocr"
MODEL = os.environ.get("OCR_MODEL", "google/gemini-3.7-flash")  # beat gemini-2.5-pro on crossed-out words (C19 p134) at ~1/10 the cost
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36"

# ---------------- sources ----------------
# tag: (pdf, 0-based pages of the "Model and sample answers" section). Books 4, 6, 14 (our copies) have no such section.
CAM = {
    "1": ("Cambridge IELTS 1/IELTS1.pdf", range(154, 158)),
    "2": ("Cambridge IELTS 2/ielts2.pdf", range(74, 80)),
    "3": ("Cambridge IELTS 3/Cambridge IELTS 3.pdf", range(163, 175)),
    "5": ("Cambridge IELTS 5/Cambridge IELTS 5 with Answers.pdf", range(162, 174)),
    "7": ("Cambridge IELTS 7/Cambridge IELTS 7 (Book).pdf", range(162, 174)),
    "8": ("Cambridge IELTS 8/Cambridge IELTS 8.pdf", range(160, 172)),
    "9": ("Cambridge IELTS 9/Cambridge IELTS 9.pdf", range(153, 165)),
    "10": ("Cambridge IELTS 10/Cambridge IELTS 10.pdf", range(161, 173)),
    "11": ("Cambridge IELTS 11/Cambridge IELTS 11 - Clear PDF Version.pdf", range(131, 139)),
    "12": ("Cambridge IELTS 12/Cambridge IELTS 12 PDF.pdf", range(123, 131)),
    "13": ("Cambridge IELTS 13/IELTS Cambridge 13- pdf.pdf", range(123, 133)),
    "15": ("Cambridge IELTS 15/cambridge_ielts_15.pdf", range(128, 139)),
    "15g": ("Cambridge IELTS 15/Cambridge IELTS 15 Gen .pdf", range(129, 137)),
    "16": ("Cambridge IELTS 16/Cambridge IELTS 16 (Academic).pdf", range(129, 139)),
    "17": ("Cambridge IELTS 17/Cambridge IELTS 17 (Academic).pdf", range(119, 131)),
    "18": ("Cambridge IELTS 18/Cambridge IELTS 18.pdf", range(128, 139)),
    "19": ("Cambridge IELTS 19/Cambridge IELTS 19 Academic.pdf", range(128, 139)),
}
# User decision (overrides doc §4.2): anchors 10/11/14, calibration 12-19, frozen test 1-9.
def cam_split(tag: str) -> str:
    b = int(re.match(r"\d+", tag)[0])
    return "anchor" if b in (10, 11, 14) else "calibration" if b >= 12 else "test"

# Book 15's prompts are mis-grouped in data/cambridge/C15.json (two PDFs), so they are read from these pages instead.
C15_PROMPT_PAGES = {"15": [29, 30, 50, 51, 72, 73, 94, 95], "15g": [29, 30, 51, 52, 73, 74, 95, 96]}
# existing gemini-2.5-pro transcriptions (strikethrough-aware) from iteration 3: reused, not re-billed
REUSE = {"12": ".eval/3/scoring/ocr12.json", "13": ".eval/3/scoring/ocr13.json", "19": ".eval/3/scoring/ocr19.json"}

ORG = {  # ielts.org documents (IELTS Partners; personal non-commercial use with credit)
    "2023": "https://ielts.org/cdn/Sample-tests/ielts-academic-writing-sample-tasks-2023.pdf",
    "cda": "https://ielts.org/cdn/computer-delivered-sample-tests-academic-writing/ielts-academic-writing-example-responses-to-parts-1-and-2-with-band-scores-and-examiner-comments.pdf",
    "cdg": "https://ielts.org/cdn/computer-delivered-sample-tests-general-training-writing/ielts-general-training-writing-example-responses-to-parts-1-and-2-with-band-scores-and-examiner-comments.pdf",
    "old": "https://assets.ctfassets.net/unrdeg6se4ke/7psERw70IzWShx61vqpBM8/232a251bfe8224e45abe7e51af904f81/ieltsacademicwritingsamplescript.pdf",
    "speaking": "https://ielts.org/organisations/ielts-for-organisations/understanding-ielts-scoring/resources-for-setting-your-ielts-scores",
}
ORG_SCAN_PAGES = {"2023": range(8, 26), "old": range(5, 12)}  # handwritten; old 1A/1B (pages 1-4) duplicate 2023 1A/1B
# Split per ielts.org task prompt (whole prompt groups only): anchors fill the band 4 / 8.5 tails.
ORG_SPLIT = {"2023-2A": "anchor", "2023-1C": "anchor", "cda-1": "anchor",
             "2023-1A": "calibration", "2023-1B": "calibration", "cdg-1": "calibration", "cdg-2": "calibration",
             "2023-2B": "test", "cda-2": "test", "old-2A": "test", "old-2B": "test"}
# The computer-delivered and old PDFs do not print their task prompts; these are reconstructed from the scripts and
# examiner comments and flagged `reconstructed` (TR/TA on them is less reliable).
RECON = {
    "cda-1": ("t1a", "The chart below shows the number of trips made by children in one country in 1990 and 2010 to travel to and from school using different modes of transport. Summarise the information by selecting and reporting the main features, and make comparisons where relevant."),
    "cda-2": ("t2", "Some people say that in the future people will be less healthy than they are now. To what extent do you agree or disagree? Give reasons for your answer and include any relevant examples from your own knowledge or experience."),
    "cdg-1": ("t1g", "You share a room in a student residence with another student and you are not happy with this arrangement. Write a letter to the accommodation officer. In your letter: explain the situation; describe the problems you are having; say what you would like the accommodation officer to do."),
    "cdg-2": ("t2", "As people live longer, the number of old people in many countries is increasing. Who should be responsible for looking after old people: their families, their former employers or the government? Give reasons for your answer and include any relevant examples from your own knowledge or experience."),
    "old-2B": ("t2", "Nuclear power provides a cheap and clean source of energy. Do the advantages of nuclear power outweigh the disadvantages? Give reasons for your answer and include any relevant examples from your own knowledge or experience."),
    "old-2A": ("t2", "The number of cars on the roads is increasing and traffic congestion is becoming a serious problem. What measures could be taken to reduce the problem? Give reasons for your answer and include any relevant examples from your own knowledge or experience."),
}

# ---------------- OpenRouter VLM ----------------
def api_key() -> str:
    if k := os.environ.get("OPENROUTER_API_KEY"):
        return k
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("OPENROUTER_API_KEY missing")

COST = [0.0]
def vlm(prompt: str, png: bytes) -> dict:
    body = {"model": MODEL, "temperature": 0, "response_format": {"type": "json_object"}, "usage": {"include": True},
            "reasoning": {"max_tokens": 2048}, "provider": {"data_collection": "deny"},
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}}]}]}
    err = None
    for _ in range(3):
        try:
            req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", json.dumps(body).encode(), {"Authorization": "Bearer " + api_key(), "Content-Type": "application/json"})
            r = json.load(urllib.request.urlopen(req, timeout=300))
            COST[0] += r.get("usage", {}).get("cost", 0) or 0
            j = json.loads(re.sub(r"^```(?:json)?|```$", "", r["choices"][0]["message"]["content"].strip(), flags=re.M))
            return j[0] if isinstance(j, list) else j
        except Exception as e:  # noqa: BLE001 - network / JSON flakiness: retry
            err = e
    raise RuntimeError(f"{MODEL}: {err}")

PAGE_PROMPT = """This page is from the sample/model answers section of an IELTS practice book, or from an official IELTS document of sample candidate scripts. Transcribe it as JSON:
{"sections":[{"heading": the task heading exactly as printed (e.g. "TEST 1, WRITING TASK 2" or "Academic Writing Sample Task 2A Sample Script B"), or null if the section continues from the previous page,
 "kind": "sample" (an answer written by a candidate), "model" (prepared by an examiner) or null if the page does not say,
 "band": the band number from "achieved a Band X score" / "Band X", or null,
 "answer": the answer text,
 "comment": the examiner's comment on this page, verbatim ("" if none)}]}
Rules for "answer": transcribe EXACTLY as written; keep every spelling, grammar and punctuation error (never correct anything); OMIT any words or letters that are crossed out with a line (the writer deleted them); keep paragraph breaks as \\n\\n and join the lines of a paragraph with spaces; never include headings, running heads, page numbers or the examiner comment. If the page only continues an answer or a comment, return one section with heading null. Output only JSON."""

PROMPT_PROMPT = """This page is from an IELTS practice book. Return JSON {"tasks":[{"task": 1 or 2, "body": the task prompt text exactly as printed (the situation / statement / question and any bullet points, each bullet on its own line starting with "• "), without the boilerplate lines "You should spend about N minutes on this task", "Write at least N words", "Write about the following topic:", "Give reasons for your answer..." and "You do NOT need to write any addresses", "Begin your letter as follows"}]}. Output only JSON."""

def cached(key: str, pdf: Path, page: int, prompt: str, dpi: int, ocr: bool):
    f = CACHE / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    if not ocr:
        print("  not cached:", key)
        return None
    out = vlm(prompt, pymupdf.open(pdf)[page].get_pixmap(dpi=dpi).tobytes("png"))
    f.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    return out

# ---------------- helpers ----------------
words = lambda s: len(re.findall(r"[A-Za-z0-9’']+", s or ""))
band = lambda b: float(re.search(r"\d(?:\.5)?", str(b))[0])
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()

def short(comment: str, n: int = 3) -> str:
    s = re.sub(r"\s+", " ", comment or "").strip()
    s = re.sub(r"^((Here is the examiner[’']?s comment:|Examiner comment:?|Band \d(\.5)?)\s*)+", "", s, flags=re.I)
    return " ".join(re.split(r"(?<=[.!?])\s+", s)[:n])[:500]

def clean(ans: str) -> str:
    ans = re.sub(r"^This model has been prepared.*?\n+", "", ans or "")
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", ans)).strip()

def merge(pages: list) -> list:
    """Page sections in reading order → one item per heading (continuations appended)."""
    items = []
    for sec in (s for p in pages if p for s in p.get("sections", [])):
        if sec.get("heading") or not items:
            items.append({"heading": sec.get("heading") or "", "kind": sec.get("kind"), "band": sec.get("band"), "answer": sec.get("answer") or "", "comment": sec.get("comment") or ""})
            continue
        it = items[-1]
        if sec.get("answer"):
            it["answer"] = (it["answer"] + "\n\n" + sec["answer"]).strip()
        if sec.get("comment"):
            it["comment"] = (it["comment"] + " " + sec["comment"]).strip()
        it["band"] = it["band"] or sec.get("band")
        it["kind"] = it["kind"] or sec.get("kind")
    return items

def cam_prompts(tag: str, ocr: bool) -> dict:
    """{(test, task): prompt dict} for a Cambridge book."""
    if tag in C15_PROMPT_PAGES:
        pdf = BOOKS / CAM[tag][0]
        out, t = {}, 0
        for i, pg in enumerate(C15_PROMPT_PAGES[tag]):
            j = cached(f"C{tag}-prompt-p{pg}", pdf, pg, PROMPT_PROMPT, 130, ocr) or {}
            for task in j.get("tasks", []):
                test = i // 2 + 1
                body = task["body"].strip()
                p = {"slug": None, "title": body.split("\n")[0][:120], "body": body}
                if tag == "15" and task["task"] == 1:
                    p["figure"] = f"Cambridge IELTS 15 Academic, PDF page {pg + 1}"
                out[(test, task["task"])] = p
        return out
    book = int(tag)
    d = json.loads((ROOT / "data" / "cambridge" / f"C{book}.json").read_text())
    out = {}
    for t in d["tests"]:
        for task in (1, 2):
            w = t["writing"].get(f"t{task}")
            if not w or not w.get("body") or (int(t["test"]), task) in out or int(t["test"]) > 6:  # tests 7+ are extraction noise
                continue
            body = w["body"]
            p = {"slug": f"cam-{book}-{t['test']}-w{task}", "title": re.split(r"(?<=[.?!])\s|\n", body)[0][:120], "body": body}
            bullets = [l[2:] for l in body.split("\n") if l.startswith("• ")]
            if bullets:
                p["bullets"] = bullets
            if task == 1 and w.get("hasFigure") and t.get("image"):
                p["imageKey"] = f"cambridge/C{book}T{t['test']}.png"
            out[(int(t["test"]), task)] = p
    return out

CONTENT_STOP = set("the a an and or of to in on for is are be that this with as by it its which what how why do does can should your you their there these those people some many more most other than from at about have has not will would".split())
def overlap(prompt: str, text: str) -> float:
    pw = {w for w in re.findall(r"[a-z]{4,}", prompt.lower()) if w not in CONTENT_STOP}
    tw = set(re.findall(r"[a-z]{4,}", text.lower()))
    return len(pw & tw) / max(1, len(pw))

# ---------------- Cambridge ----------------
HEAD = re.compile(r"TEST\s*([1-8AB])\W*WRITING\s*TA\S*K\s*([12Il])", re.I)

def cambridge(ocr: bool) -> list:
    rows = []
    for tag, (rel, pages) in CAM.items():
        pdf = BOOKS / rel
        if tag in REUSE:  # seed the cache from iteration-3 transcriptions (no comments in those)
            for pg, v in json.loads((ROOT / REUSE[tag]).read_text()).items():
                f = CACHE / f"C{tag}-p{pg}.json"
                if not f.exists():
                    f.write_text(json.dumps(v, ensure_ascii=False, indent=1))
        with ThreadPoolExecutor(6) as ex:
            got = list(ex.map(lambda pg: cached(f"C{tag}-p{pg}", pdf, pg, PAGE_PROMPT, 160, ocr), pages))
        prompts = cam_prompts(tag, ocr)
        book = int(re.match(r"\d+", tag)[0])
        for it in merge(got):
            m = HEAD.search(it["heading"]) or (tag == "1" and re.search(r"^(A) .*?Writing Task\s*([12])", "A " + it["heading"], re.S | re.I))
            if not m:  # book 1 prints its General Training module (test 5 in C1.json) without a test number
                print(f"  C{tag}: unparsed heading {it['heading']!r}")
                continue
            t = {"A": 5, "B": 6}.get(m[1].upper()) or int(m[1])
            if book == 12:
                t -= 4  # book 12 numbers its tests 5-8
            task = 1 if m[2] in "1Il" else 2
            text = clean(it["answer"])
            gt = tag == "15g" or t >= 5 or "GENERAL" in it["heading"].upper()
            model = it["kind"] == "model" or it["band"] is None
            if words(text) < 60:
                print(f"  C{tag} T{t} W{task}: skipped, {words(text)} words")
                continue
            p = prompts.get((t, task))
            base = f"cam-{tag}-{t}-w{task}"
            fam = "t2" if task == 2 else "t1g" if gt else "t1a"
            split = cam_split(tag)
            row = {"id": base + ("-model" if model else ""), "skill": "writing", "taskFamily": fam, "split": split,
                   "role": "probe" if model else {"anchor": "anchor", "calibration": "calib", "test": "test"}[split],
                   "band": 9.0 if model else band(it["band"]), "groupId": base, "prompt": p, "text": text,
                   "note": short(it["comment"]), "source": f"Cambridge IELTS {tag}, PDF p{pages[0] + 1}-{pages[-1] + 1}"}
            if model:  # examiner model answer: the ceiling probe (nominal band 9, not an official band)
                row["expect"] = {"kind": "ceiling", "minBand": 8.5, "criterionMin": 8}
            best = max(prompts, key=lambda k: overlap(prompts[k]["body"], text) if k[1] == task else -1, default=None)
            if p and best != (t, task) and overlap(prompts[best]["body"], text) > overlap(p["body"], text) + 0.1:
                print(f"  check prompt match {row['id']}: test {best[0]} fits better")
            if not p:
                print(f"  no prompt for {row['id']}")
            rows.append(row)
    return rows

# ---------------- ielts.org writing ----------------
def fetch(url: str, name: str) -> Path:
    f = SRC / name
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120).read())
    return f

def org_prompts_2023(pdf: Path) -> dict:
    d, out = pymupdf.open(pdf), {}
    for pg in range(2, 7):
        t = d[pg].get_text()
        key = re.search(r"Task\W*([12][A-C])", t)[1]
        lines = [l.strip() for l in t.split("\n") if l.strip() and not re.search(r"^Page \d|IELTS\.org|Sample Task|WRITING TASK|You should spend|Write at least|Write about the following|^Give reasons", l)]
        body = re.sub(r"\s+", " ", " ".join(lines)).strip()
        body = re.sub(r"^.*?own knowledge or experience\.\s*", "", body)  # the wrapped "Give reasons ..." boilerplate
        out[key] = {"title": body[:120], "body": body, **({"figure": f"ielts-academic-writing-sample-tasks-2023.pdf page {pg + 1}"} if key[0] == "1" else {})}
    return out

def org_typed(doc: str, pdf: Path) -> list:
    """Computer-delivered PDFs: typed scripts, one per page, paragraphs = text blocks."""
    rows, d = [], pymupdf.open(pdf)
    for pg in range(1, d.page_count):
        blocks = [re.sub(r"\s+", " ", b[4]).strip() for b in d[pg].get_text("blocks")]
        blocks = [b for b in blocks if b]
        i = next(k for k, b in enumerate(blocks) if b.startswith("Examiner comment"))
        head = " ".join(blocks[:2])
        task = 1 if re.search(r"Part 1|Task 1", head) else 2
        n = re.search(r"(?:Response|Script) (\w)", head)[1]
        body = [re.sub(r"^WRITING TASK \d\s*", "", b) for b in blocks[:i] if not re.match(r"(Sample |General Training Writing|Candidate Response)", b)]
        body = [b for b in body if b]
        band = float(re.search(r"Band (\d(?:\.5)?)", blocks[i + 1])[1])
        g = f"{doc}-{task}"
        fam, pbody = RECON[g]
        rows.append(org_row(f"ieltsorg-{doc}-{task}{n.lower()}", g, fam, band, "\n\n".join(body), " ".join(blocks[i + 2:]),
                            {"title": pbody[:120], "body": pbody, "reconstructed": True}, ORG[doc]))
    return rows

def org_row(id_, group, fam, band, text, comment, prompt, source):
    split = ORG_SPLIT[group]
    return {"id": id_, "skill": "writing", "taskFamily": fam, "split": split, "role": {"anchor": "anchor", "calibration": "calib", "test": "test"}[split],
            "band": band, "groupId": f"ieltsorg-{group}", "prompt": prompt, "text": clean(text), "note": short(comment), "source": source}

def ielts_org(ocr: bool) -> list:
    rows = []
    pdfs = {k: fetch(u, Path(u).name) for k, u in ORG.items() if u.endswith(".pdf")}
    rows += org_typed("cda", pdfs["cda"]) + org_typed("cdg", pdfs["cdg"])
    p2023 = org_prompts_2023(pdfs["2023"])
    for doc, pages in ORG_SCAN_PAGES.items():
        with ThreadPoolExecutor(6) as ex:
            got = list(ex.map(lambda pg: cached(f"org-{doc}-p{pg}", pdfs[doc], pg, PAGE_PROMPT, 200, ocr), pages))
        for it in merge(got):
            m = re.search(r"Task\W*([12][A-C])\W*(?:Sample\s*)?Script\W*([A-C])", it["heading"], re.I)
            if not m:
                print(f"  {doc}: unparsed heading {it['heading']!r}")
                continue
            key, n = m[1].upper(), m[2].lower()
            g = f"{doc}-{key}"
            if doc == "2023":
                prompt = p2023[key]
            else:
                prompt = {"title": RECON[g][1][:120], "body": RECON[g][1], "reconstructed": True}
            rows.append(org_row(f"ieltsorg-{doc}-{key.lower()}{n}", g, "t2" if key[0] == "2" else "t1a", band(it["band"]), it["answer"], it["comment"], prompt, ORG[doc]))
    return rows

# ---------------- speaking (ielts.org sample tests, transcripts on the page) ----------------
SPEAK_ANCHORS = {5: 1, 6: 1, 7: 1, 8: 1}  # first candidate at each whole band → anchor; the rest → test

def speaking() -> list:
    raw = fetch(ORG["speaking"], "speaking.html").read_text(encoding="utf8")
    txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)\b.*?</\1>", "", raw, flags=re.S))))
    vids = re.findall(r"youtube\.com/embed/([A-Za-z0-9_-]+)", raw)
    parts = re.split(r"(?=Band \d(?:\.5)? \| )", txt)[1:]
    rows, used = [], {}
    for i, s in enumerate(parts):
        m = re.match(r"Band (\d(?:\.5)?) \| ([^,]+), (.+?) (Part \d[^:]*): (.+?) View transcript (.+?) Examiner comments (.+)", s)
        if not m:
            continue
        band, name, _, part, topic, transcript, comment = m.groups()
        band = float(band)
        comment = re.split(r"(?<=performance\.)|Band \d", comment)[0]
        anchor = band in SPEAK_ANCHORS and used.get(band, 0) < SPEAK_ANCHORS[band]
        used[band] = used.get(band, 0) + anchor
        parts_ = re.findall(r"Part (\d)", part)
        rows.append({"id": f"ieltsorg-speaking-{i + 1:02d}", "skill": "speaking", "taskFamily": "p" + parts_[0] if len(parts_) == 1 else "full",
                     "split": "anchor" if anchor else "test", "role": "anchor" if anchor else "test", "band": band,
                     "groupId": f"ieltsorg-speaking-{name.strip().lower()}", "prompt": {"title": f"{part}: {topic}", "body": topic},
                     "text": transcript.strip(), "audioKey": f"youtube:{vids[i]}" if i < len(vids) else None,
                     "note": short(comment), "source": ORG["speaking"]})
    return rows

# ---------------- probes: controlled variants, ceiling, floor ----------------
AGREE = {"is": "are", "are": "is", "was": "were", "were": "was", "has": "have", "have": "has", "does": "do", "this": "these", "these": "this"}
PREP = {"in": "on", "on": "in", "of": "for", "for": "of", "to": "for", "at": "in"}
PLURAL_CUE = {"many", "several", "these", "those", "two", "three", "four", "five", "both", "various", "few"}

def error_sites(text: str, seed: str) -> tuple:
    toks = re.split(r"([A-Za-z]+)", text)  # odd indices are words
    sites = []
    for i in range(1, len(toks), 2):
        w, lw = toks[i], toks[i].lower()
        prev = toks[i - 2].lower() if i >= 3 else ""
        if lw in ("the", "a", "an"):
            sites.append((i, "article"))
        elif lw in AGREE:
            sites.append((i, "agreement"))
        elif lw.endswith("ed") and len(lw) > 5 and not lw.endswith("eed") and lw not in ("hundred", "kindred"):
            sites.append((i, "tense"))
        elif prev in PLURAL_CUE and lw.endswith("s") and len(lw) > 3:
            sites.append((i, "plural"))
        elif lw in PREP:
            sites.append((i, "preposition"))
    random.Random(seed).shuffle(sites)
    return toks, sites

def bare(w: str) -> str:
    """Past form -> bare verb (a tense fault): carried->carry, stopped->stop, addressed->address, increased->increase, reached->reach."""
    lw = w.lower()
    if lw.endswith("ied"):
        return w[:-3] + "y"
    if lw[-3] == lw[-4]:
        return w[:-2] if lw[-3] in "slfz" else w[:-3]
    if lw[-3] in "cgvz" or (lw[-3] in "std" and lw[-4] in "aeiou"):
        return w[:-1]
    return w[:-2]

def inject(text: str, per100: float, seed: str) -> str:
    """Deterministic grammar faults at `per100` errors per 100 words; a higher density is a superset of a lower one."""
    toks, sites = error_sites(text, seed)
    for i, kind in sites[: round(words(text) * per100 / 100)]:
        w = toks[i]
        cap = lambda s: s[:1].upper() + s[1:] if w[:1].isupper() else s
        if kind == "article":
            toks[i] = ""
            if i + 1 < len(toks) and toks[i + 1] == " ":
                toks[i + 1] = ""
                if w[:1].isupper() and i + 2 < len(toks):
                    toks[i + 2] = toks[i + 2][:1].upper() + toks[i + 2][1:]
        elif kind == "agreement":
            toks[i] = cap(AGREE[w.lower()])
        elif kind == "tense":
            toks[i] = bare(w)
        elif kind == "plural":
            toks[i] = w[:-1]
        else:
            toks[i] = cap(PREP[w.lower()])
    return "".join(toks)

OFF_TOPIC = ("Another thing I would like to mention is my own favourite hobby, which is football. Every weekend I play with my friends "
             "in the park near my house and we usually stay there until it gets dark. Football teaches people teamwork and it is also "
             "a cheap way to keep fit, so I think everyone should try it at least once in their life.")
OVERVIEW = re.compile(r"^(overall|in general|generally|in summary|to sum up|to summarise|it is clear|it can be (clearly )?seen|as can be seen|as is (clear|evident))", re.I)

def prompt_statement(p: dict) -> str:
    lines = [l for l in p["body"].split("\n") if l.strip() and not re.match(r"(Summari[sz]e the information|Write a letter|In your letter|•|Give reasons|Begin your letter|Write about the following|You should|Write at least)", l.strip())]
    return " ".join(lines).strip()

def truncate(text: str, n: int) -> str:
    """First sentences up to about n words, keeping paragraph breaks."""
    out = []
    for para in text.split("\n\n"):
        kept = []
        for s in re.split(r"(?<=[.!?])\s+", para):
            if words(" ".join(out + kept)) >= n:
                break
            kept.append(s)
        if kept:
            out.append(" ".join(kept))
        if words(" ".join(out)) >= n:
            break
    return "\n\n".join(out)

def probe(base: dict, kind: str, text: str, expect: dict, band=None) -> dict:
    return {**{k: base[k] for k in ("skill", "taskFamily", "split", "groupId", "prompt")}, "id": f"probe-{base['id']}-{kind}", "role": "probe",
            "band": band, "text": text, "note": None, "expect": {"base": base["id"], "kind": kind, **expect}, "source": "variant"}

def variants(rows: list) -> list:
    """Controlled variants of frozen-test examiner model answers (+ floor items). Expectations are constraints, not bands."""
    out = []
    ceil = [r for r in rows if r["role"] == "probe" and r["split"] == "test" and r["prompt"]]
    ceil.sort(key=lambda r: -int(re.match(r"cam-(\d+)", r["id"])[1]))  # newest frozen books first
    has_overview = lambda r: any(OVERVIEW.search(p.strip()) for p in r["text"].split("\n\n"))
    bases = []
    for fam, n in (("t2", 2), ("t1a", 1), ("t1g", 1)):
        bases += [r for r in ceil if r["taskFamily"] == fam and (fam != "t1a" or has_overview(r))][:n]
    for b in bases:
        t, mn = b["text"], 250 if b["taskFamily"] == "t2" else 150
        for lvl, (d, mx) in enumerate([(2, None), (5, 8), (10, 7)], 1):  # errors / 100 words; higher level must not score higher
            out.append(probe(b, f"err{lvl}", inject(t, d, b["id"]), {"level": lvl, "per100": d, "monotonic": True, **({"maxBand": mx} if mx else {})}))
        paras = t.split("\n\n")
        out.append(probe(b, "offtopic", "\n\n".join(paras[:2] + [OFF_TOPIC] + paras[2:]), {"belowBase": True}))
        cut = truncate(t, int(mn * 0.5))
        out.append(probe(b, "short", cut, {"words": words(cut), "min": mn, "belowBase": True, "maxBand": 6.5, "criterionMax": {"ta": 5}}))
        out.append(probe(b, "copied", "\n\n".join([prompt_statement(b["prompt"])] + paras[1:]), {"notAboveBase": True, "copiedWords": words(prompt_statement(b["prompt"]))}))
        if b["taskFamily"] == "t1a":
            keep = [p for p in paras if not OVERVIEW.search(p.strip())]
            if len(keep) < len(paras):
                out.append(probe(b, "nooverview", "\n\n".join(keep), {"belowBase": True, "criterionMax": {"ta": 5}}))
        # floor: the prompt copied back plus one thin sentence of own words
        out.append(probe(b, "floor-copy", prompt_statement(b["prompt"]) + "\n\nI think this is true because it is good and it is important for people.", {"maxBand": 3}, band=3.0))
    # floor: a weak frozen-test candidate script (band <= 5.5), heavy faults + cut well under length
    for r in [r for r in rows if r["role"] == "test" and r["skill"] == "writing" and r["band"] <= 5.5][:3]:
        mn = 250 if r["taskFamily"] == "t2" else 150
        out.append(probe(r, "floor-degraded", truncate(inject(r["text"], 15, r["id"]), int(mn * 0.45)), {"maxBand": 4}, band=3.5))
    return out

AUTHORED = [  # original very weak scripts written for this set (not from any source), nominal band <= 4
    ("t2", "Some people think that children should learn a foreign language at primary school, others think it is better to start at secondary school. Discuss both views and give your opinion.",
     "In my opinion children is learn language good. Primary school children they play and not study so much. When I was child I not like english because teacher is angry. Secondary school student is more big and they can understanding the grammar. But small children also can learn it the song and game. My brother learn english in primary and he is speak good now. So I think both is good and bad. Language is important for job and travel in the future because many country use english. Government must give more teacher. In conclusion I think children learn foreign language primary or secondary school both is ok it depend on the children."),
    ("t2", "Many people believe that social media has a negative effect on young people. To what extent do you agree or disagree?",
     "Social media is very popular now. young people use it every day. i use facebook and instagram. it is good for talk friend. but some time it is bad. young people use to much time and not sleep. they not study. my friend is use phone all night. also the bad people in internet. I agree social media is negative for young people but also positive. thank you."),
    ("t1g", "You recently stayed at a hotel and left a bag in your room. Write a letter to the hotel manager. In your letter: give details of your stay; describe the bag and what was in it; say what you would like the manager to do.",
     "Dear manager\n\nI am stay in your hotel last week. I forget my bag. The bag is black and have my clothe and book. Please you find it and send me. My room is 205 I think.\n\nthank you\nAli"),
]

def authored() -> list:
    return [{"id": f"probe-authored-floor-{i + 1}", "skill": "writing", "taskFamily": fam, "split": "test", "role": "probe", "band": 3.0,
             "groupId": f"authored-{i + 1}", "prompt": {"title": body[:120], "body": body}, "text": text, "note": None,
             "expect": {"kind": "floor", "maxBand": 4}, "source": "authored"} for i, (fam, body, text) in enumerate(AUTHORED)]

# ---------------- main ----------------
def selftest():
    for past, base in {"carried": "carry", "stopped": "stop", "addressed": "address", "increased": "increase", "reached": "reach", "decided": "decide", "wanted": "want"}.items():
        assert bare(past) == base, (past, bare(past))
    t = "The rates increased in these countries. It is clear that the figures have changed a lot.\n\nOverall, the trend was up."
    lo, hi = inject(t, 10, "s"), inject(t, 30, "s")
    assert lo != t and hi != lo and inject(t, 0, "s") == t
    assert truncate(t, 5).count("\n\n") == 0 and truncate(t, 18).count("\n\n") == 1

def main():
    selftest()
    ocr = "--no-ocr" not in sys.argv
    SRC.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    rows = cambridge(ocr) + ielts_org(ocr)
    rows += variants(rows) + authored() + speaking()
    for r in rows:
        r["sha256"] = sha(r["text"] or r.get("audioKey") or "")
        r.setdefault("expect", None)
        r.setdefault("audioKey", None)
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), [i for i in ids if ids.count(i) > 1]
    # leakage guard: an anchor never shares a task prompt group with a scored script
    anchor_groups = {r["groupId"] for r in rows if r["split"] == "anchor"}
    assert not [r["id"] for r in rows if r["split"] != "anchor" and r["groupId"] in anchor_groups], "anchor group leaks"
    (GOLD / "scripts.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    manifest = [{k: r[k] for k in ("id", "skill", "taskFamily", "role", "split", "band", "groupId", "source", "sha256", "expect")} | {"words": words(r["text"])} for r in rows]
    (ROOT / "data" / "scoring-gold-manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    report(rows)
    print(f"OCR spend this run: ${COST[0]:.3f}")

def report(rows: list):
    bins = [(0, 4.5, "<=4.5"), (5, 5.5, "5-5.5"), (6, 6.5, "6-6.5"), (7, 7.5, "7-7.5"), (8, 9, ">=8")]
    print(f"{'skill/split/role':32} {'n':>4} " + " ".join(f"{b[2]:>6}" for b in bins) + "  families")
    keys = sorted({(r["skill"], r["split"], r["role"]) for r in rows})
    for k in keys:
        rs = [r for r in rows if (r["skill"], r["split"], r["role"]) == k]
        h = [sum(1 for r in rs if r["band"] is not None and lo <= r["band"] <= hi) for lo, hi, _ in bins]
        fam = {f: sum(1 for r in rs if r["taskFamily"] == f) for f in sorted({r["taskFamily"] for r in rs})}
        print(f"{'/'.join(k):32} {len(rs):>4} " + " ".join(f"{x:>6}" for x in h) + f"  {fam}")

if __name__ == "__main__":
    main()
