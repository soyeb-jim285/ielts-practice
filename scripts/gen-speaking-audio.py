#!/usr/bin/env python3
"""Render the examiner lines of the generated speaking bank (data/bank/speaking-*.json) to mp3 with ElevenLabs Eleven v4 Turbo, one British examiner voice.

Usage: python3 scripts/gen-speaking-audio.py [--dry] [--max-credits N]   (default cap 10000 credits)
Needs ELEVENLABS_API_KEY in .env (the LAST such line wins) and ffmpeg. Python stdlib only.
The text list comes from scripts/speaking-audio-texts.ts (same line rules as packages/core/src/speaking-audio.ts).
Writes data/speaking-audio/<sha1(text)[:16]>.mp3 (mono, 64 kbps) and manifest.json {hash: "speaking/<hash>.mp3"}; scripts/speaking-audio-import.ts uploads them.
Resumable: raw API audio is cached in data/speaking-audio/.el-cache/<hash>.mp3; every API call appends its `character-cost` header to cost.log.
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/speaking-audio"
CACHE = OUT / ".el-cache"
LOG = OUT / "cost.log"
MODEL = "eleven_v4_turbo"
VOICE = "onwK4e9ZLuTAKqWW03F9"  # Daniel: the British narrator voice of the listening tests
WORKERS = 3

for l in (ROOT / ".env").read_text().splitlines():
    if l.startswith("ELEVENLABS_API_KEY="):
        KEY = l.split("=", 1)[1].strip().strip("\"'")
HDR = {"xi-api-key": KEY, "Content-Type": "application/json"}


def api(path, body=None):
    req = urllib.request.Request("https://api.elevenlabs.io" + path, data=json.dumps(body).encode() if body else None, headers=HDR)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read(), r.headers
        except urllib.error.HTTPError as e:
            msg = e.read()[:300]
            if e.code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(4 * (attempt + 1)); continue
            sys.exit(f"ElevenLabs {e.code}: {msg}")
    sys.exit("ElevenLabs: retries exhausted")


def used():
    d = json.loads(api("/v1/user/subscription")[0])
    return d["character_count"], d["character_limit"], d["tier"]


def main():
    args = sys.argv[1:]
    dry = "--dry" in args
    cap = int(args[args.index("--max-credits") + 1]) if "--max-credits" in args else 10000
    OUT.mkdir(parents=True, exist_ok=True); CACHE.mkdir(exist_ok=True)
    items = json.loads(subprocess.check_output(["pnpm", "-s", "tsx", "scripts/speaking-audio-texts.ts"], cwd=ROOT))
    todo = [i for i in items if not (OUT / f"{i['hash']}.mp3").exists()]
    chars = sum(len(i["text"]) for i in todo)
    c0, limit, tier = used()
    print(f"{len(items)} lines, {len(todo)} to render, {chars} chars (~{int(chars * 0.06)}-{int(chars * 0.09)} credits at the observed 0.06-0.09/char), cap {cap}; account {tier}, {limit - c0} credits left", flush=True)
    (OUT / "manifest.json").write_text(json.dumps({i["hash"]: f"speaking/{i['hash']}.mp3" for i in items}, indent=0))
    if dry or not todo: return
    if tier == "free" or limit - c0 < cap: sys.exit("refusing: plan/credit guard")
    spent = 0

    def one(i):
        nonlocal spent
        if spent >= cap: return
        raw = CACHE / f"{i['hash']}.mp3"
        if not raw.exists():
            data, h = api("/v1/text-to-dialogue?output_format=mp3_44100_128", {"model_id": MODEL, "inputs": [{"voice_id": VOICE, "text": i["text"]}]})
            cost = int(h.get("character-cost") or len(i["text"]))
            spent += cost
            with LOG.open("a") as L: L.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {i['hash']} chars={len(i['text'])} cost={cost}\n")
            raw.write_bytes(data)
        tmp = OUT / f"{i['hash']}.tmp.mp3"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "44100", "-b:a", "64k", str(tmp)], check=True)
        tmp.rename(OUT / f"{i['hash']}.mp3")

    with ThreadPoolExecutor(WORKERS) as ex:
        for n, _ in enumerate(ex.map(one, todo), 1):
            if n % 100 == 0: print(f"{n}/{len(todo)} rendered, credits so far {spent}", flush=True)
    c1, _, _ = used()
    left = [i for i in items if not (OUT / f"{i['hash']}.mp3").exists()]
    print(f"done: {len(items) - len(left)}/{len(items)} files, {spent} credits by header, {c1 - c0} by subscription; {len(left)} left", flush=True)


main()
