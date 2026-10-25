#!/usr/bin/env python3
"""Render the speaking examiner lines with Gemini 3.8 Flash-Lite TTS in the Listening narrator's voice, through the Batch API.

Usage: python3 scripts/gen-speaking-gemini.py [--dry] [--max-usd N] [--chunk N]
Lines come from scripts/speaking-audio-texts.ts, the same rules the API uses, so the file names (sha1 of the text) match what it serves.
Lines that already have an mp3 (the ElevenLabs ones) are skipped; only the missing ones are rendered.
Reuses the Batch API code of scripts/gen-lr-gemini.py (file input/output, resumable job state, cost log); only the model, voice, cache
and output paths differ. Output: data/speaking-audio/<hash>.mp3 (mono, 64 kbps, -16 LUFS) + manifest.json; upload with
`pnpm tsx scripts/speaking-audio-import.ts`.
"""
import importlib.util, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/speaking-audio"
spec = importlib.util.spec_from_file_location("lr", ROOT / "scripts/gen-lr-gemini.py")
lr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lr)

lr.MODEL = "gemini-3.8-flash-lite-tts"
lr.PRICE = (0.25, 3.00)  # USD per 1M tokens (text in, audio out), Batch tier, until 2026-12-31; doubles from 2027-01-01
lr.CACHE = OUT / ".gem-cache"
lr.BATCH_STATE = OUT / ".gem-batch.json"
lr.LOG = OUT / "gemini-cost.log"
VOICE = lr.NARRATOR_VOICE  # en-gb-podcaster-4: the Listening narrator (owner's pick)
STYLE = "calm, clear and friendly, like an IELTS speaking examiner talking to the candidate"


def body(text):
    """Interactions-shaped body (gen-lr-gemini's to_generate_content turns it into the batch request); single voice."""
    return {"model": lr.MODEL, "service_tier": "flex", "response_format": {"type": "audio"},
            "input": [{"type": "user_input", "content": [{"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": STYLE}]}]}],
            "generation_config": {"speech_config": [{"voice": VOICE}]}}


def main():
    args = sys.argv[1:]
    opt = lambda k, d: type(d)(args[args.index(k) + 1]) if k in args else d
    dry, cap, chunk = "--dry" in args, opt("--max-usd", 5.0), opt("--chunk", 600)
    cmd = ["pnpm", "-s", "tsx", "--env-file-if-exists=.env", "scripts/speaking-audio-texts.ts"]
    items = json.loads(subprocess.check_output(cmd, cwd=ROOT))
    OUT.mkdir(parents=True, exist_ok=True)
    lr.CACHE.mkdir(parents=True, exist_ok=True)
    jobs = [(i, body(i["text"])) for i in items if not (OUT / f"{i['hash']}.mp3").exists()]  # ponytail: keeps ElevenLabs lines, so a test can mix two voices
    todo = [b for _, b in jobs if not (lr.CACHE / f"{lr.key_of(b)}.wav").exists()]
    chars = sum(len(b["input"][0]["content"][0]["text"]) for b in todo)
    est = chars * lr.TOK_PER_CHAR * lr.PRICE[1] / 1e6
    print(f"{len(items)} lines, {len(jobs)} without audio, {len(todo)} to render, {chars} chars, est ${est:.2f} at batch price (cap ${cap})", flush=True)
    if dry: return
    if est > cap: sys.exit("refusing: estimate above --max-usd")
    spent = 0.0
    for n in range(0, len(todo), chunk):  # ~600 short lines a job keeps the responses file well under the size where downloads got flaky
        spent += lr.render_batch(todo[n:n + chunk])
        if spent > cap: sys.exit(f"stopping: spent ${spent:.2f} > cap")
    for i, b in jobs:
        wav, mp3 = lr.CACHE / f"{lr.key_of(b)}.wav", OUT / f"{i['hash']}.mp3"
        tmp = mp3.with_suffix(".part.mp3")
        lr.ff("-i", str(wav), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "44100", "-b:a", "64k", str(tmp))
        tmp.rename(mp3)
    (OUT / "manifest.json").write_text(json.dumps({i["hash"]: f"speaking/{i['hash']}.mp3" for i in items if (OUT / f"{i['hash']}.mp3").exists()}, indent=0))
    print(f"done: {len(jobs)} new mp3 in {OUT}, ${spent:.2f} spent; upload: pnpm tsx scripts/speaking-audio-import.ts", flush=True)


if __name__ == "__main__":
    main()
