#!/usr/bin/env python3
"""Render generated IELTS listening scripts to mp3 with Gemini 3.8 Flash TTS (Google Interactions API, Flex tier = half price).

Usage: python3 scripts/gen-lr-gemini.py <slug ...> [--dry] [--max-usd N] [--jobs N] [--batch]
  --batch: one Batch API job instead of Flex calls (separate quota from the 100 requests/day Tier 1 cap; same half price)
Needs GEMINI_API_KEY in .env and ffmpeg on PATH. Python stdlib only.
Same input and output layout as scripts/gen-lr-elevenlabs.py (scripts/<slug>.json -> assets/lr/gen/<slug>-p<N>.mp3) and the same
structure gate. Gemini returns no word timings, so every part also gets an alignment bundle in data/lr-generated/.align-queue/<slug>-p<N>/
(manifest.json + one flac per speech block); scripts/lr-align-kaggle.py aligns the queue on a Kaggle GPU and writes timings/<slug>.json.

Voices: narrator NARRATOR_VOICE; characters come from CAST by part.roles, the gender of their ElevenLabs voice and the accent shares (cast()).
Tags: ElevenLabs [tags] become Gemini's: a leading mood tag joins speech_metadata.style, vocal bursts become <laugh> etc. (TAGS).
Pace: every character turn carries CHAR_STYLE; a character block above MAX_WPM[part] gets a 4% stretch (paced()).
Blocks: consecutive turns without a pause >= 1 s, at most 2 speakers (Gemini's multi-speaker limit) and MAXCH characters (16k output tokens).
Silence ("pause") is made by ffmpeg, it costs nothing. Resumable: each block is cached in data/lr-generated/.gem-cache/.
Every API call appends its token usage to data/lr-generated/gemini-cost.log.
"""
import base64, hashlib, json, os, random, re, subprocess, sys, tempfile, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "data/lr-generated"
OUT = Path(os.environ.get("LR_GEN_DIR") or GEN)
CACHE = GEN / ".gem-cache"
QUEUE = GEN / ".align-queue"
LOG = GEN / "gemini-cost.log"
URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
MODEL = "gemini-3.8-flash-tts"
PRICE = (0.25, 4.50)  # USD per 1M tokens (text in, audio out), Flex tier, until 2026-12-31; doubles from 2027-01-01
TOK_PER_CHAR = 2.1  # audio tokens per input character, measured on the samples (for --dry estimates only)
MAXCH = 3000  # ~3.5 min of speech, well inside the 16,384 output-token limit
GAP = 0.35
NARRATOR_STYLE = "calm, clear and measured, like an exam recording"
# Characters: without a style Gemini talks at 180-206 wpm (Cambridge 130-158). This style measured ~164 (P1) / ~157 (P4) and still sounds
# natural; "very slowly and deliberately" hit the target but sounded forced (owner, 2026-10-24).
CHAR_STYLE = "speaking at a calm, measured pace, like a recording for language learners"
# A character block still above MAX_WPM[part] gets a 4% pitch-kept stretch, nothing more (owner: "Add 4% only", 2026-10-25; Part 4 since 2026-10-24).
# Parts 1-3 match the pace gate in scripts/lr-align-kaggle.py; Part 4 (Cambridge ~130) is held lower.
MAX_WPM, STRETCH = {1: 175, 2: 175, 3: 180, 4: 150}, 0.96
NARRATOR_VOICE = "en-gb-podcaster-4"  # owner's pick: 22-year-old Winchester radio host, objective and direct
# Character voices by accent -> role -> gender (owner approved 2026-10-24). Roles come from part["roles"] in the script:
# student (18-27), caller (customer/parent, 28-40), service (receptionist/desk), guide (Part 2 manager/presenter), tutor, lecturer, older.
CAST = {
    "southern": {  # Winchester English
        "student": {"f": ["en-gb-csagent-8", "en-gb-csagent-6", "en-gb-commercial-5"], "m": ["en-gb-training-3", "en-gb-assistant-2", "en-gb-commercial-7"]},
        "caller": {"f": ["en-gb-tutor-13", "en-gb-assistant-1", "en-gb-concierge-2"], "m": ["en-gb-csagent-7", "en-gb-assistant-4", "en-gb-tutor-14"]},
        "service": {"f": ["en-gb-csagent-2", "en-gb-csagent-4", "en-gb-concierge-6"], "m": ["en-gb-assistant-10", "en-gb-training-10", "en-gb-tutor-14"]},
        "guide": {"f": ["en-gb-concierge-7", "en-gb-podcaster-3", "en-gb-csagent-10"], "m": ["en-gb-training-1", "en-gb-training-10", "en-gb-assistant-4"]},
        "tutor": {"f": ["en-gb-tutor-11", "en-gb-tutor-19", "en-gb-advisor-6"], "m": ["en-gb-tutor-9", "en-gb-tutor-8", "en-gb-advisor-8"]},
        "lecturer": {"f": ["en-gb-tutor-4", "en-gb-storyteller-2", "en-gb-podcaster-2"], "m": ["en-gb-training-1", "en-gb-tutor-9", "en-gb-advisor-8", "en-gb-tutor-8"]},
        "older": {"f": ["en-gb-tutor-20", "en-gb-training-2", "en-gb-tutor-10"], "m": []},  # no older Winchester men: falls back to regional
    },
    "regional": {  # Manchester, Glasgow, Bristol
        "student": {"f": ["en-gb-csagent-9"], "m": ["en-gb-commercial-4", "en-gb-csagent-13"]},
        "caller": {"f": ["en-gb-podcaster-7", "en-gb-concierge-11"], "m": ["en-gb-advisor-10"]},
        "service": {"f": ["en-gb-podcaster-7", "en-gb-concierge-11"], "m": ["en-gb-advisor-10"]},
        "guide": {"f": ["en-gb-training-9", "en-gb-podcaster-12"], "m": ["en-gb-podcaster-5"]},
        "tutor": {"f": ["en-gb-techagent-2"], "m": ["en-gb-podcaster-9", "en-gb-advisor-9", "en-gb-storyteller-4"]},
        "lecturer": {"f": ["en-gb-techagent-2"], "m": ["en-gb-podcaster-9", "en-gb-advisor-9", "en-gb-storyteller-4"]},
        "older": {"f": ["en-gb-tutor-5"], "m": ["en-gb-csagent-3", "en-gb-assistant-5"]},
    },
    "australian": {
        "student": {"f": ["en-au-podcaster-1"], "m": ["en-au-techagent-3"]},
        "caller": {"f": ["en-au-tutor-3"], "m": ["en-au-csagent-1"]},
        "service": {"f": ["en-au-tutor-3"], "m": ["en-au-csagent-1"]},
        "guide": {"f": ["en-au-tutor-3"], "m": ["en-au-csagent-1"]},
        "tutor": {"f": ["en-au-storyteller-1"], "m": ["en-au-tutor-5"]},
        "lecturer": {"f": ["en-au-storyteller-1"], "m": ["en-au-tutor-5"]},
        "older": {"f": ["en-au-storyteller-1"], "m": ["en-au-tutor-5"]},
    },
    "newzealand": {
        "student": {"f": ["en-nz-commercial-3"], "m": ["en-nz-csagent-6"]},
        "caller": {"f": ["en-nz-training-3"], "m": ["en-nz-tutor-2"]},
        "service": {"f": ["en-nz-training-3"], "m": ["en-nz-tutor-2"]},
        "guide": {"f": ["en-nz-training-3"], "m": ["en-nz-tutor-2"]},
        "tutor": {"f": ["en-nz-tutor-6"], "m": ["en-nz-tutor-8"]},
        "lecturer": {"f": ["en-nz-tutor-6"], "m": ["en-nz-tutor-8"]},
        "older": {"f": ["en-nz-tutor-6"], "m": ["en-nz-tutor-8"]},
    },
    "northamerican": {  # Toronto + General American
        "student": {"f": ["en-ca-training-2"], "m": ["en-ca-concierge-2", "iapetus"]},
        "caller": {"f": ["en-ca-training-2", "erinome"], "m": ["en-ca-concierge-2", "iapetus"]},
        "service": {"f": ["en-ca-training-2", "erinome"], "m": ["iapetus"]},
        "guide": {"f": ["erinome"], "m": ["en-ca-podcaster-1"]},
        "tutor": {"f": ["en-ca-tutor-4", "gacrux"], "m": ["en-ca-podcaster-1", "rasalgethi"]},
        "lecturer": {"f": ["gacrux", "en-ca-tutor-4"], "m": ["rasalgethi", "en-ca-podcaster-1"]},
        "older": {"f": ["en-ca-tutor-4"], "m": ["en-ca-podcaster-1"]},
    },
}
# Accent shares, target 70/15/5/5/5 of character voices. Part 1 stays British (as in Cambridge), and the "no shared gender + accent in a
# part" rule pushes second speakers off southern, so these weights are tuned on the real scripts (gen-l-11..120): 66/15/5/6/7.
SHARES = {1: {"southern": 90, "regional": 10}, 0: {"southern": 55, "regional": 16, "australian": 8, "newzealand": 8, "northamerican": 6.5}}
GENDER = {  # gender of the ElevenLabs voice the script was written for
    "onwK4e9ZLuTAKqWW03F9": "m", "2UMI2FME0FFUFMlUoRER": "m", "JBFqnCBsd6RMkjVDRZzb": "m", "jRAAK67SEFE9m7ci5DhD": "m", "IKne3meq5aSn9XLyUdCD": "m",
    "pFZP5JQG7iQjIQuC4Bku": "f", "Xb7hH8MSUJpSbSDYk0k2": "f", "MzqUf1HbJ8UmQ0wUsx2p": "f", "6fZce9LFNG3iEITDfqZZ": "f",
}


def cast(slug, script):
    """{part: {speaker: gemini voice}}. Deterministic per slug/part/speaker; within a part no two speakers share gender + accent;
    a voice is reused in the same test only when its pool runs out."""
    out, used = {}, set()
    for p in script["parts"]:
        if "roles" not in p: sys.exit(f"{slug} part {p['part']}: no roles; add part.roles {{SPEAKER: role}} (roles: {', '.join(CAST['southern'])})")
        got, taken = {"NARRATOR": NARRATOR_VOICE}, set()
        for spk, role in sorted(p["roles"].items()):
            g = GENDER[p["voices"][spk]]
            rng = random.Random(f"{slug}/{p['part']}/{spk}")
            shares = SHARES[1 if p["part"] == 1 else 0]
            order = sorted(shares, key=lambda a: rng.random() ** (100 / shares[a]), reverse=True)  # weighted shuffle
            pick = None
            for acc in order + list(CAST):  # preferred accent first; fall through when a pool is empty or blocked
                if (g, acc) in taken: continue
                pool = CAST[acc][role][g]
                fresh = [v for v in pool if v not in used]
                if pool: pick = (rng.choice(fresh or pool), acc); break
            if not pick: sys.exit(f"{slug} part {p['part']}: no voice for {spk} ({role}, {g})")
            got[spk] = pick[0]; taken.add((g, pick[1])); used.add(pick[0])
        out[p["part"]] = got
    return out


STYLE_TAGS = {"thoughtfully": "thoughtful", "curious": "curious", "excited": "excited"}
TAGS = {"hesitates": "<short pause>", "sighs": "<sigh>", "chuckles": "<chuckle>", "laughs": "<laugh>"}

KEY = next(l.split("=", 1)[1].strip().strip("\"'") for l in (ROOT / ".env").read_text().splitlines() if l.startswith("GEMINI_API_KEY="))


def gem_text(text):
    """ElevenLabs text -> (Gemini transcript, style or None). Mood tags only count at the start of a turn; elsewhere they are dropped."""
    style = None
    m = re.match(r"\s*\[(\w+)\]\s*", text)
    if m and m.group(1) in STYLE_TAGS:
        style, text = STYLE_TAGS[m.group(1)], text[m.end():]
    text = re.sub(r"\[(\w+)\]", lambda m: TAGS.get(m.group(1), ""), text)
    return re.sub(r"\s+", " ", text).strip(), style


plain = lambda t: re.sub(r"\s+", " ", re.sub(r"\[[^\]]*\]", " ", t)).strip()  # what the student reads in the transcript


def blocks(turns):
    """Group turns into speech blocks; a pause >= 1 s, a narrator turn, a third speaker or MAXCH closes the block."""
    cur, chars = [], 0
    for t in turns:
        if not t["text"].strip():
            if "pause" in t: yield cur, t["pause"]; cur, chars = [], 0
            continue
        if cur and (chars + len(t["text"]) > MAXCH or t["speaker"] == "NARRATOR" or len({x["speaker"] for x in cur} | {t["speaker"]}) > 2):
            yield cur, 0; cur, chars = [], 0
        cur.append(t); chars += len(t["text"])
        if t.get("pause", 0) >= 1 or t["speaker"] == "NARRATOR":
            yield cur, t.get("pause", 0); cur, chars = [], 0
    if cur: yield cur, 0


def request(blk, voices):
    """voices: {speaker: gemini voice} from cast(). Interactions body for one block: one speaker -> single voice, two -> multi-speaker with speech_metadata.speaker."""
    content, who = [], list(dict.fromkeys(t["speaker"] for t in blk))
    for t in blk:
        text, style = gem_text(t["text"])
        meta = {"type": "speech_metadata"}
        if len(who) == 2: meta["speaker"] = t["speaker"]
        style = NARRATOR_STYLE if t["speaker"] == "NARRATOR" else f"{style}, {CHAR_STYLE}" if style else CHAR_STYLE
        if style: meta["style"] = style
        content.append({"type": "text", "text": text, **({"annotations": [meta]} if len(meta) > 1 else {})})
    cfg = [{"voice": voices[who[0]]}] if len(who) == 1 else {"speakers": [{"speaker": s, "voice": voices[s]} for s in who]}
    return {"model": MODEL, "service_tier": "flex", "input": [{"type": "user_input", "content": content}],
            "response_format": {"type": "audio"}, "generation_config": {"speech_config": cfg}}


key_of = lambda body: hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()


def speech(body):
    """Cached wav for one block; returns (path, usd). Flex can answer 429/503 when Google is busy, so retry with backoff."""
    k = key_of(body)
    f = CACHE / f"{k}.wav"
    if f.exists(): return f, 0.0
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
    for attempt in range(12):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=900)); break
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            code = getattr(e, "code", 0)
            msg = e.read()[:400] if hasattr(e, "read") else str(e)
            if code in (0, 429, 500, 502, 503, 504) and attempt < 11:
                time.sleep(min(300, 10 * 2 ** attempt)); continue
            sys.exit(f"Gemini {code}: {msg}")
    audio = [c for s in r["steps"] if s["type"] == "model_output" for c in s["content"] if c["type"] == "audio"][-1]
    u = r["usage"]
    usd = (u["total_input_tokens"] * PRICE[0] + u["total_output_tokens"] * PRICE[1]) / 1e6
    tmp = f.with_suffix(".part")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "-", "-ac", "1", "-ar", "24000", "-f", "wav", str(tmp)], input=base64.b64decode(audio["data"]), check=True)
    tmp.rename(f)
    with LOG.open("a") as L:
        L.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {k[:10]} in={u['total_input_tokens']} out={u['total_output_tokens']} tier={r.get('service_tier', u.get('service_tier', '?'))} usd={usd:.6f}\n")
    return f, usd


BATCH_STATE = GEN / ".gem-batch.json"


def to_generate_content(body):
    """Interactions body -> generateContent request (the format batchGenerateContent takes); same voices, styles and speakers."""
    voice = lambda v: {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": v}}}
    cfg = body["generation_config"]["speech_config"]
    parts = [{"text": c["text"], **({"speechMetadata": {k: v for k, v in c["annotations"][0].items() if k != "type"}} if c.get("annotations") else {})}
             for c in body["input"][0]["content"]]
    sc = voice(cfg[0]["voice"]) if isinstance(cfg, list) else {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [{"speaker": x["speaker"], **voice(x["voice"])} for x in cfg["speakers"]]}}
    return {"contents": [{"parts": parts}], "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": sc}}


def gapi(method, path, body=None):
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta" + path, data=json.dumps(body).encode() if body else None,
                                 method=method, headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
    for attempt in range(12):  # Batch GETs see multi-minute 503 spells; the job keeps running meanwhile
        try:
            return json.load(urllib.request.urlopen(req, timeout=300))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            code, msg = getattr(e, "code", 0), (e.read()[:600] if hasattr(e, "read") else str(e))
            if code in (0, 500, 502, 503, 504) and attempt < 11: time.sleep(min(60, 15 * (attempt + 1))); continue
            sys.exit(f"Gemini batch {method} {path}: {code} {msg}")


def upload_jsonl(path):
    """Files API resumable upload (two calls); returns the file name, e.g. files/abc."""
    n = path.stat().st_size
    start = urllib.request.Request("https://generativelanguage.googleapis.com/upload/v1beta/files", method="POST",
                                   data=json.dumps({"file": {"display_name": path.name}}).encode(),
                                   headers={"x-goog-api-key": KEY, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
                                            "X-Goog-Upload-Header-Content-Length": str(n), "X-Goog-Upload-Header-Content-Type": "application/jsonl",
                                            "Content-Type": "application/json"})
    url = urllib.request.urlopen(start, timeout=120).headers["x-goog-upload-url"]
    put = urllib.request.Request(url, method="POST", data=path.read_bytes(),
                                 headers={"X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0", "Content-Length": str(n)})
    return json.load(urllib.request.urlopen(put, timeout=600))["file"]["name"]


def render_batch(todo):
    """Render uncached blocks through the Batch API (own quota, separate from the per-day request cap; half price like Flex).
    File input and file output: an inline job puts every audio result in the job object itself, and past ~20 MB its GET only returns 503.
    Resumable: the job name is kept in BATCH_STATE, so a rerun polls the same job instead of paying again."""
    keys = {key_of(b): b for b in todo}
    st = json.loads(BATCH_STATE.read_text()) if BATCH_STATE.exists() else {}
    if not (st and set(st["keys"]) == set(keys) and st.get("file")):
        with tempfile.TemporaryDirectory() as td:
            f = Path(td) / f"lr-tts-{len(keys)}.jsonl"
            f.write_text("".join(json.dumps({"key": k, "request": to_generate_content(b)}) + "\n" for k, b in keys.items()))
            src = upload_jsonl(f)
        job = gapi("POST", f"/models/{MODEL}:batchGenerateContent", {"batch": {"display_name": f"lr-tts-{len(keys)}", "input_config": {"file_name": src}}})
        st = {"name": job["name"], "keys": list(keys), "file": src}
        BATCH_STATE.write_text(json.dumps(st))
        print("batch submitted", job["name"], len(keys), "requests", flush=True)
    t0 = time.time()
    while True:
        job = gapi("GET", "/" + st["name"])
        state = (job.get("metadata") or {}).get("state") or job.get("state")
        if state and not state.endswith(("PENDING", "RUNNING")): break
        print(f"batch {state} {time.time() - t0:.0f}s", flush=True)
        time.sleep(60)
    if not state.endswith("SUCCEEDED"): sys.exit(f"batch {state}: {json.dumps(job)[:800]}")
    out = job.get("response") or job["metadata"].get("output") or {}
    res = out.get("responsesFile") or (out.get("dest") or {}).get("fileName")
    if not res: sys.exit(f"no responses file in job: {json.dumps(job)[:800]}")
    jl = CACHE / ".gem-batch-out.jsonl"  # kept until every line is cached, so a crash below does not lose paid audio
    if not jl.exists():
        dl = urllib.request.Request(f"https://generativelanguage.googleapis.com/download/v1beta/{res}:download?alt=media", headers={"x-goog-api-key": KEY})
        with urllib.request.urlopen(dl, timeout=1800) as r, open(f"{jl}.part", "wb") as w:
            while chunk := r.read(1 << 20): w.write(chunk)
        os.rename(f"{jl}.part", jl)
    items = []
    for line in open(jl):
        it = json.loads(line)
        items.append({"metadata": {"key": it.get("key")}, "response": it.get("response"), "error": it.get("error") or it.get("status")})
    spent, bad = 0.0, []
    for it in items:
        k, r = (it.get("metadata") or {}).get("key"), it.get("response")
        if not r: bad.append(f"{k}: {it.get('error')}"); continue
        d = r["candidates"][0]["content"]["parts"][0]["inlineData"]
        u = r["usageMetadata"]
        usd = (u["promptTokenCount"] * PRICE[0] + u["candidatesTokenCount"] * PRICE[1]) / 1e6
        raw = ["-f", "s16le", "-ar", re.search(r"rate=(\d+)", d["mimeType"]).group(1), "-ac", "1"] if "l16" in d["mimeType"].lower() or "pcm" in d["mimeType"].lower() else []
        tmp = (CACHE / f"{k}.part")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *raw, "-i", "-", "-ac", "1", "-ar", "24000", "-f", "wav", str(tmp)], input=base64.b64decode(d["data"]), check=True)
        tmp.rename(CACHE / f"{k}.wav")
        spent += usd
        with LOG.open("a") as L:
            L.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {k[:10]} in={u['promptTokenCount']} out={u['candidatesTokenCount']} tier=batch usd={usd:.6f}\n")
    BATCH_STATE.unlink(); jl.unlink()
    print(f"batch done in {time.time() - t0:.0f}s: {len(items) - len(bad)} ok, {len(bad)} failed, ${spent:.4f}", flush=True)
    if bad: sys.exit("failed blocks (rerun to retry them):\n" + "\n".join(bad[:20]))
    return spent


def ff(*a): subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)
def dur(x): return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(x)]))


def paced(wav, blk, part):
    """A character block above MAX_WPM[part] gets the 4% stretch (cached next to the original)."""
    if blk[0]["speaker"] == "NARRATOR": return wav
    words = sum(len(plain(t["text"]).split()) for t in blk)
    if words / dur(wav) * 60 <= MAX_WPM[part]: return wav
    out = wav.with_suffix(f".t{STRETCH}.wav")
    if not out.exists(): ff("-i", str(wav), "-af", f"rubberband=tempo={STRETCH}:pitchq=quality", str(out))
    return out


def assemble(slug, p, rendered):
    """Concatenate speech blocks and silences into the part mp3; write the alignment bundle with each block's offset."""
    out = OUT / f"assets/lr/gen/{slug}-p{p['part']}.mp3"
    out.parent.mkdir(parents=True, exist_ok=True)
    q = QUEUE / f"{slug}-p{p['part']}"
    q.mkdir(parents=True, exist_ok=True)
    segs, clock = [], 0.0
    with tempfile.TemporaryDirectory() as td:
        pieces = []
        for i, (blk, pause, wav) in enumerate(rendered):
            if wav:
                wav = paced(wav, blk, p["part"])
                pieces.append(wav)
                name = f"{i:03d}.flac"
                ff("-i", str(wav), "-ar", "16000", str(q / name))
                segs.append({"file": name, "offset": round(clock, 3), "lines": [{"speaker": t["speaker"], "text": plain(t["text"])} for t in blk]})
                clock += dur(wav)
            sec = pause if pause else GAP
            s = Path(td) / f"s{i}.wav"
            ff("-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", str(sec), str(s)); pieces.append(s); clock += dur(s)
        lst = Path(td) / "list.txt"
        lst.write_text("".join(f"file '{x}'\n" for x in pieces))
        ff("-f", "concat", "-safe", "0", "-i", str(lst), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "44100", "-b:a", "64k", str(out))
    (q / "manifest.json").write_text(json.dumps({"name": f"{slug}-p{p['part']}", "slug": slug, "part": p["part"], "total_s": round(clock, 3), "segments": segs}, indent=1))
    return out, dur(out)


def main():
    args = sys.argv[1:]
    opt = lambda k, d: type(d)(args[args.index(k) + 1]) if k in args else d
    dry, cap, jobs = "--dry" in args, opt("--max-usd", 5.0), opt("--jobs", 6)
    slugs = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--max-usd", "--jobs"))]
    CACHE.mkdir(parents=True, exist_ok=True)
    work = []  # (slug, part, [(blk, pause, body|None)])
    for slug in slugs:
        script = json.loads((OUT / f"scripts/{slug}.json").read_text())
        chk = subprocess.run(["pnpm", "-s", "tsx", "scripts/lr-structure-check.ts", slug, "--lenient", "--no-timings"], cwd=ROOT, capture_output=True, text=True)
        if chk.returncode: sys.exit(f"refusing to render {slug}: script fails scripts/lr-structure-check.ts\n{chk.stdout}{chk.stderr}")
        voices = cast(slug, script)
        print(slug, {k: v for pv in voices.values() for k, v in pv.items() if k != "NARRATOR"}, flush=True)
        for p in script["parts"]:
            work.append((slug, p, [(blk, pause, request(blk, voices[p["part"]]) if blk else None) for blk, pause in blocks(p["turns"])]))
    todo = [b for _, _, bl in work for _, _, b in bl if b and not (CACHE / f"{key_of(b)}.wav").exists()]
    chars = sum(len(c["text"]) for b in todo for c in b["input"][0]["content"])
    est = chars * TOK_PER_CHAR * PRICE[1] / 1e6
    print(f"{len(slugs)} tests, {len(todo)} blocks to render, {chars} chars, est ${est:.2f} at Flex price (cap ${cap})", flush=True)
    if dry: return
    if est > cap: sys.exit("refusing: estimate above --max-usd")
    if "--batch" in args:
        spent = render_batch(todo) if todo else 0.0
    else:
        with ThreadPoolExecutor(jobs) as ex:
            spent = sum(u for _, u in ex.map(speech, todo))
    for slug, p, bl in work:
        out, d = assemble(slug, p, [(blk, pause, speech(b)[0] if b else None) for blk, pause, b in bl])
        print(f"{slug} part {p['part']}: {d:.0f}s -> {out.relative_to(ROOT)}", flush=True)
    print(f"spent ${spent:.4f} (Flex price, from token usage)")


if __name__ == "__main__":
    main()
