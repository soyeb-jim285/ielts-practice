#!/usr/bin/env python3
"""Render generated IELTS listening scripts to mp3 with ElevenLabs Eleven v4 Turbo (multi-speaker dialogue).

Usage: python3 scripts/gen-lr-elevenlabs.py <slug> [part ...] [--dry] [--max-credits N]
Needs ELEVENLABS_API_KEY in .env and ffmpeg on PATH. Python stdlib only.

Reads  data/lr-generated/scripts/<slug>.json
         {"parts":[{"part":1,"voices":{LABEL: voice_id},"turns":[{"speaker":LABEL,"text":"...[tags] allowed","pause":seconds_of_silence_after?}]}]}
         speaker NARRATOR is the exam voice. Silence ("pause") is made by ffmpeg, it costs no credits.
Writes data/lr-generated/assets/lr/gen/<slug>-p<N>.mp3 (mono, 64 kbps, 44.1 kHz, about -16 LUFS).
Resumable: every speech block is cached in data/lr-generated/.el-cache/<sha1(model+voices+text)>.mp3.
Every API call appends its `character-cost` header to data/lr-generated/elevenlabs-cost.log.
Blocks: consecutive turns without a long pause are one text-to-dialogue request (split at turn boundaries, <= 9000 chars).
"""
import hashlib, json, os, subprocess, sys, tempfile, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/lr-generated"
CACHE = OUT / ".el-cache"
LOG = OUT / "elevenlabs-cost.log"
MODEL = "eleven_v4_turbo"
MAXCH = 9000
GAP = 0.35  # seconds of room between consecutive speech blocks without an explicit pause

for l in (ROOT / ".env").read_text().splitlines():
    if l.startswith("ELEVENLABS_API_KEY="):
        KEY = l.split("=", 1)[1].strip().strip("\"'")
HDR = {"xi-api-key": KEY, "Content-Type": "application/json"}


def api(path, body=None):
    req = urllib.request.Request("https://api.elevenlabs.io" + path, data=json.dumps(body).encode() if body else None, headers=HDR)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read(), r.headers
        except urllib.error.HTTPError as e:
            msg = e.read()[:400]
            if e.code in (429, 500, 502, 503) and attempt < 4:
                time.sleep(5 * (attempt + 1)); continue
            sys.exit(f"ElevenLabs {e.code}: {msg}")
    sys.exit("ElevenLabs: retries exhausted")


def remaining():
    d = json.loads(api("/v1/user/subscription")[0])
    return d["character_limit"] - d["character_count"], d["tier"]


def blocks(turns):
    """Group turns into speech blocks; a turn with pause >= 1 s closes the block."""
    cur, chars = [], 0
    for t in turns:
        if not t["text"].strip():
            if "pause" in t: yield cur, t["pause"]; cur, chars = [], 0
            continue
        if cur and chars + len(t["text"]) > MAXCH:
            yield cur, 0; cur, chars = [], 0
        if t["speaker"] == "NARRATOR" and cur:
            yield cur, 0; cur, chars = [], 0
        cur.append(t); chars += len(t["text"])
        if t.get("pause", 0) >= 1 or t["speaker"] == "NARRATOR":
            yield cur, t.get("pause", 0); cur, chars = [], 0
    if cur: yield cur, 0


def speech(inputs):
    key = hashlib.sha1(json.dumps([MODEL, inputs], sort_keys=True).encode()).hexdigest()
    f = CACHE / f"{key}.mp3"
    if f.exists(): return f, 0
    data, h = api("/v1/text-to-dialogue?output_format=mp3_44100_128", {"model_id": MODEL, "inputs": inputs})
    cost = int(h.get("character-cost") or sum(len(i["text"]) for i in inputs))
    with LOG.open("a") as L: L.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {key[:10]} chars={sum(len(i['text']) for i in inputs)} cost={cost}\n")
    f.write_bytes(data)
    return f, cost


def ff(*a): subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)


def main():
    args = sys.argv[1:]
    dry = "--dry" in args
    cap = int(args[args.index("--max-credits") + 1]) if "--max-credits" in args else 40000
    rest = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--max-credits")]
    slug, only = rest[0], {int(p) for p in rest[1:]}
    CACHE.mkdir(parents=True, exist_ok=True)
    parts = [p for p in json.loads((OUT / f"scripts/{slug}.json").read_text())["parts"] if not only or p["part"] in only]
    est = sum(len(t["text"]) for p in parts for t in p["turns"])
    left, tier = remaining()
    print(f"{slug}: {est} chars (~{est // 2} credits at 0.5/char), account {tier}, {left} credits left", flush=True)
    if dry: return
    if tier == "free" or est // 2 > left or est // 2 > cap: sys.exit("refusing: plan/credit guard")
    spent = 0
    for p in parts:
        out = OUT / f"assets/lr/gen/{slug}-p{p['part']}.mp3"
        out.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as td:
            pieces = []
            def add_silence(sec):
                if sec <= 0: return
                s = Path(td) / f"s{len(pieces)}.wav"
                ff("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", str(sec), str(s)); pieces.append(s)
            for blk, pause in blocks(p["turns"]):
                if blk:
                    inputs = [{"voice_id": p["voices"][t["speaker"]], "text": t["text"]} for t in blk]
                    f, c = speech(inputs); spent += c
                    w = Path(td) / f"b{len(pieces)}.wav"
                    ff("-i", str(f), "-ac", "1", "-ar", "44100", str(w)); pieces.append(w)
                add_silence(pause if pause else GAP)
            lst = Path(td) / "list.txt"
            lst.write_text("".join(f"file '{x}'\n" for x in pieces))
            ff("-f", "concat", "-safe", "0", "-i", str(lst), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "44100", "-b:a", "64k", str(out))
        d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)]))
        print(f"{slug} part {p['part']}: {d:.0f}s, credits so far {spent}", flush=True)
        if spent > cap: sys.exit("credit cap reached")


main()
