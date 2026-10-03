#!/usr/bin/env python3
"""Word timings for Listening audio via ElevenLabs scribe_v1 -> data/<dir>/timings/{slug}.json.
Usage: uv run scripts/lr-timings.py [--cap N] [slug...]   (default: all, generated first, then Cambridge 19 -> 10)
Resumable; logs to data/lr-timings-cost.log; stops once credits spent >= cap."""
import json, os, re, subprocess, sys, time, uuid, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.elevenlabs.io/v1"
LOG = ROOT / "data/lr-timings-cost.log"
KEY = [l.split("=", 1)[1].strip().strip("\"'") for l in (ROOT / ".env").read_text().splitlines() if l.startswith("ELEVENLABS_API_KEY=")][-1]
CAP = 40000


def req(url, data=None, headers=None):
    h = {"xi-api-key": KEY, **(headers or {})}
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data, h), timeout=600) as r:
                return r.read(), r.headers
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429: raise RuntimeError(f"{e.code} {e.read()[:300]}")
        except Exception: pass
        time.sleep(5 * (i + 1))
    raise RuntimeError("retries exhausted")


def used():
    return json.loads(req(f"{API}/user/subscription")[0])["character_count"]


def stt(path):
    b = uuid.uuid4().hex
    body = b"".join(
        [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in
         [("model_id", "scribe_v1"), ("timestamps_granularity", "word"), ("diarize", "false"), ("tag_audio_events", "false")]]
        + [f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\nContent-Type: audio/mpeg\r\n\r\n'.encode(), path.read_bytes(), f"\r\n--{b}--\r\n".encode()])
    raw, h = req(f"{API}/speech-to-text", body, {"Content-Type": f"multipart/form-data; boundary={b}"})
    j = json.loads(raw)
    return [[w["text"], round(w["start"], 2), round(w["end"], 2)] for w in j["words"] if w.get("type") == "word"], h.get("character-cost")


def duration(p):
    try: return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]))
    except Exception: return None


def norm(s): return re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " ")).strip()


def tests(args):
    gen = sorted((ROOT / "data/lr-generated").glob("gen-l-*.json"))
    cam = sorted((ROOT / "data/cambridge-lr").glob("*-listening.json"), key=lambda p: (-int(re.search(r"C(\d+)-", p.name).group(1)), p.name))
    out = []
    for p in gen + cam:
        t = json.loads(p.read_text())
        if not args or t["slug"] in args: out.append((p.parent, t))
    return out


def check(sec, words, audio):
    msgs = []
    tw = len(re.findall(r"\S+", sec.get("transcript") or ""))
    if tw and not 0.6 < len(words) / tw < 1.5: msgs.append(f"WORDCOUNT {len(words)} vs transcript {tw}")
    d = duration(audio)
    if d and words and words[-1][2] > d + 0.5: msgs.append(f"END {words[-1][2]} > dur {d:.1f}")
    return msgs


def gap_hits(t, parts):
    import random
    qs = [(s["part"], q) for s in t["sections"] for g in s["groups"] if g["type"] == "gap" for q in g["questions"]]
    pick = random.sample(qs, min(3, len(qs))); hit = 0
    for part, q in pick:
        text = " " + norm(" ".join(w[0] for w in parts.get(str(part), []))) + " "
        ans = q["answer"] if isinstance(q["answer"], list) else [q["answer"]]
        hit += any(" " + norm(str(a)) + " " in text for a in ans if norm(str(a)))
    return hit, len(pick)


def do_test(d, t, state):
    side = d / "timings" / f"{t['slug']}.json"
    parts = json.loads(side.read_text())["sections"] if side.exists() else {}
    todo = [s for s in t["sections"] if s.get("audio") and str(s["part"]) not in parts]
    for s in todo:
        if state["spent"] >= CAP: return "capped"
        audio = d / "assets" / s["audio"]
        words, cost = stt(audio)
        state["spent"] += int(cost or 0)
        parts[str(s["part"])] = words
        m = check(s, words, audio)
        line = f"{time.strftime('%F %T')} {t['slug']} p{s['part']} cost={cost} words={len(words)} {' '.join(m)}"
        print(line, flush=True); LOG.open("a").write(line + "\n")
        side.parent.mkdir(exist_ok=True)
        side.write_text(json.dumps({"slug": t["slug"], "sections": parts}, ensure_ascii=False))
    h, n = gap_hits(t, parts)
    line = f"{t['slug']} gap-answer hits {h}/{n}"; print(line); LOG.open("a").write(line + "\n")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--cap"]: CAP = int(a[1]); a = a[2:]
    state = {"spent": 0}
    before = used(); print("credits used before:", before)
    with ThreadPoolExecutor(2) as ex:
        for f in [ex.submit(do_test, d, t, state) for d, t in tests(a)]: f.result()
    after = used(); print("subscription delta:", after - before, "header-sum:", state["spent"])
    LOG.open("a").write(f"run done: subscription delta {after - before}, header sum {state['spent']}\n")
