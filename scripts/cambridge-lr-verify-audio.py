# /// script
# requires-python = ">=3.11"
# dependencies = ["faster-whisper", "av<14"]
# ///
"""Spot-checks that each listening section's mp3 is the right recording: transcribes two 25 s clips locally (whisper tiny, 2 threads)
and measures how many of their words occur in that section's audioscript. Usage: uv run scripts/cambridge-lr-verify-audio.py [C17 ...]"""
import json, re, subprocess, sys
from pathlib import Path

D = Path(__file__).resolve().parent.parent / "data" / "cambridge-lr"
from faster_whisper import WhisperModel

m = WhisperModel("tiny.en", device="cpu", cpu_threads=2, compute_type="int8")
words = lambda s: set(w for w in re.findall(r"[a-z']+", s.lower()) if len(w) > 3)
bad = 0
for f in sorted(D.glob("C*-T*-listening.json"), key=lambda p: [int(x) for x in re.findall(r"\d+", p.name)]):
    if len(sys.argv) > 1 and not any(f.name.startswith(a + "-") for a in sys.argv[1:]): continue
    t = json.loads(f.read_text())
    for s in t["sections"]:
        tr = words(s.get("transcript") or "")
        mp3 = D / "assets" / s["audio"]
        scores = []
        for off in (90, 200):
            subprocess.run(["nice", "-n", "19", "ffmpeg", "-loglevel", "error", "-y", "-ss", str(off), "-t", "25", "-i", str(mp3), "-ac", "1", "-ar", "16000", "/tmp/lr-verify.wav"])
            segs, _ = m.transcribe("/tmp/lr-verify.wav", language="en", beam_size=1)
            w = words(" ".join(x.text for x in segs))
            scores.append(len(w & tr) / max(len(w), 1))
        flag = max(scores) < 0.45
        bad += flag
        print(f"{'MISMATCH' if flag else 'ok      '} {f.name} part {s['part']} {s['audio']} overlap={[round(x, 2) for x in scores]}", flush=True)
print(f"{bad} mismatching sections")
