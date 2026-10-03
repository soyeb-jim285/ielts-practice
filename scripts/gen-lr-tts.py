# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["kokoro-onnx", "soundfile", "numpy", "onnxruntime"]
# ///
"""Render generated listening scripts to mp3 with Kokoro-82M (CPU, 2 threads, resumable).
Usage: nice -n 19 uv run scripts/gen-lr-tts.py <slug> [part ...]
Reads data/lr-generated/scripts/<slug>.json, writes data/lr-generated/assets/lr/gen/<slug>-p<N>.mp3 (mono, 64 kbps, 44.1 kHz).
Model files: data/lr-generated/models/{kokoro-v1.0.onnx,voices-v1.0.bin} (downloaded from the kokoro-onnx GitHub release).
"""
import os
for k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[k] = "2"
import json, random, re, subprocess, sys, time, tempfile
from pathlib import Path
import numpy as np, onnxruntime as rt, soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent / "data/lr-generated"
slug, only = sys.argv[1], {int(p) for p in sys.argv[2:]}
so = rt.SessionOptions(); so.intra_op_num_threads = 2; so.inter_op_num_threads = 1
sess = rt.InferenceSession(str(ROOT / "models/kokoro-v1.0.onnx"), so, providers=["CPUExecutionProvider"])
sess._model_path = str(ROOT / "models/kokoro-v1.0.onnx")
kk = Kokoro.from_session(sess, str(ROOT / "models/voices-v1.0.bin"))
SR = 24000
# "H-A-R-G" (spelled out) -> "H, A, R, G" so the model reads letter names
spell = lambda t: re.sub(r"\b[A-Z](?:-[A-Z]){1,}\b", lambda m: ", ".join(m.group(0).split("-")) + ",", t)
silence = lambda s: np.zeros(int(SR * s), dtype=np.float32)

for part in json.loads((ROOT / f"scripts/{slug}.json").read_text())["parts"]:
    n = part["part"]
    out = ROOT / f"assets/lr/gen/{slug}-p{n}.mp3"
    if (only and n not in only) or out.exists():
        continue
    out.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(f"{slug}{n}")
    t0, chunks, speech = time.time(), [], 0.0
    for t in part["turns"]:
        if t["text"].strip():
            narr = t["speaker"] == "NARRATOR"
            a, _ = kk.create(spell(t["text"]), t["voice"], speed=1.0 if narr else 0.97, lang="en-gb")
            speech += len(a) / SR
            chunks.append(a)
        chunks.append(silence(min(30, t["pause"]) if t.get("pause") else rng.uniform(0.4, 0.7)))
    audio = np.concatenate(chunks)
    with tempfile.NamedTemporaryFile(suffix=".wav") as w:
        sf.write(w.name, audio, SR)
        subprocess.run(["nice", "-n", "19", "ffmpeg", "-y", "-loglevel", "error", "-i", w.name, "-ac", "1", "-ar", "44100", "-b:a", "64k", str(out)], check=True)
    el = time.time() - t0
    print(f"{slug} part {n}: total {len(audio)/SR:.0f}s, speech {speech:.0f}s, wall {el:.0f}s, RTF {el/speech:.2f}", flush=True)
