"""Pronunciation assessment API on Modal (T4 GPU, scales to zero): wav2vec2 phoneme CTC + forced alignment, GOP-style scores.

    modal deploy modal/pronunciation/app.py
    curl -X POST "$URL/assess" -H "Modal-Key: $KEY" -H "Modal-Secret: $SECRET" -F audio=@clip.webm [-F text="what they read"]
    modal run modal/pronunciation/app.py::evaluate --n 300     # agreement with speechocean762 human scores + playground samples

How it scores: facebook/wav2vec2-xlsr-53-espeak-cv-ft gives per-frame IPA phone posteriors. The expected phones of each word
(espeak-ng, en-us AND en-gb; the better one counts, so either accent is fine) are force-aligned to them (torchaudio CTC
forced_align). A phone's score is exp(mean over its frames of log p(expected) - log p(best non-blank phone)): 1.0 when the
expected phone is what the model hears most, lower as another phone wins. "heard" is the phone that won. Without a reference
text the clip is first transcribed (faster-whisper small.en, word timestamps) and assessed in <=20 s windows.
ponytail: no prosody (stress/intonation) yet; add an F0 pass (e.g. pyin) if the playground shows it is needed.
"""
import re
import subprocess
import time

import modal

W2V = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"
ASR = "small.en"
LANGS = ("en-us", "en-gb")
WINDOW_S = 20.0
FRAME_S = 0.02  # wav2vec2 stride: 320 samples at 16 kHz


def download():
    from faster_whisper.utils import download_model
    from huggingface_hub import snapshot_download

    snapshot_download(W2V)
    download_model(ASR)


image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("ffmpeg", "espeak-ng")
    .pip_install("torch==2.5.1", "torchaudio==2.5.1", "transformers==4.46.3", "phonemizer==3.3.0", "faster-whisper==1.1.1",
                 "huggingface_hub", "fastapi[standard]", "python-multipart", "numpy<2", "pyarrow==16.1.0", "datasets==3.2.0", "soundfile", "librosa==0.10.2.post1")
    .env({"PHONEMIZER_ESPEAK_LIBRARY": "/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1"})
    .run_function(download)
)
app = modal.App("pronunciation", image=image)


def load16k(data: bytes):
    import numpy as np

    raw = subprocess.run(["ffmpeg", "-nostdin", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                         input=data, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


WORD = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?")


@app.cls(gpu="T4", scaledown_window=120, max_containers=1)  # ponytail: 1 container caps spend; raise for traffic
class Pron:
    @modal.enter()
    def load(self):
        import json

        import torch
        from faster_whisper import WhisperModel
        from huggingface_hub import hf_hub_download
        from phonemizer.backend import EspeakBackend
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

        self.torch = torch
        self.fe = Wav2Vec2FeatureExtractor.from_pretrained(W2V)
        self.model = Wav2Vec2ForCTC.from_pretrained(W2V).half().cuda().eval()
        self.vocab = json.load(open(hf_hub_download(W2V, "vocab.json")))
        self.inv = {i: p for p, i in self.vocab.items()}
        self.maxlen = max(len(p) for p in self.vocab)
        self.blank = self.vocab["<pad>"]
        self.special = [self.vocab[t] for t in ("<pad>", "<s>", "</s>", "<unk>")]
        self.espeak = {l: EspeakBackend(l, language_switch="remove-flags") for l in LANGS}
        self.asr = WhisperModel(ASR, device="cuda", compute_type="float16")
        self.cache: dict[tuple[str, str], list[int]] = {}

    def phones(self, word: str, lang: str) -> list[int]:
        """Expected phone ids of one word: espeak IPA, split greedily into the longest tokens the model knows."""
        key = (word.lower(), lang)
        if key not in self.cache:
            from phonemizer.separator import Separator

            ipa = self.espeak[lang].phonemize([word.lower()], separator=Separator(phone="", word=" ", syllable=""), strip=True)[0]
            ipa = re.sub(r"[ˈˌ\s‿-]", "", ipa)
            ids, i = [], 0
            while i < len(ipa):
                for n in range(min(self.maxlen, len(ipa) - i), 0, -1):
                    if ipa[i:i + n] in self.vocab:
                        ids.append(self.vocab[ipa[i:i + n]])
                        i += n
                        break
                else:
                    i += 1  # a symbol the model has no token for: skip it
            self.cache[key] = ids
        return self.cache[key]

    def logprobs(self, wav):
        torch = self.torch
        x = self.fe(wav, sampling_rate=16000, return_tensors="pt").input_values.half().cuda()
        with torch.inference_mode():
            return self.model(x).logits[0].float().log_softmax(-1).cpu()

    def align(self, lp, words: list[str], lang: str):
        """Per word: list of (expected id, heard id, score, start frame, end frame), or None if alignment is impossible."""
        import torchaudio.functional as F

        torch = self.torch
        per = [self.phones(w, lang) for w in words]
        targets = [p for ids in per for p in ids]
        if not targets or len(targets) > lp.shape[0]:
            return None
        ali, scores = F.forced_align(lp[None], torch.tensor([targets], dtype=torch.int32), blank=self.blank)
        spans = F.merge_tokens(ali[0], scores[0].exp())
        if len(spans) != len(targets):
            return None
        rival = lp.clone()
        rival[:, self.special] = float("-inf")  # the best competing PHONE, never blank
        best, heard = rival.max(-1)
        out, k = [], 0
        for ids in per:
            rows = []
            for exp in ids:
                s = spans[k]
                k += 1
                fr = slice(s.start, s.end)
                gop = float((lp[fr, exp] - best[fr]).mean())
                h = int(torch.mode(heard[fr]).values)
                rows.append((exp, h, min(1.0, float(torch.tensor(gop).exp())), s.start, s.end))
            out.append(rows)
        return out

    def assess_window(self, wav, words: list[str], offset: float):
        lp = self.logprobs(wav)
        by_lang = {l: self.align(lp, words, l) for l in LANGS}
        res = []
        for i, w in enumerate(words):
            options = [(l, r[i]) for l, r in by_lang.items() if r is not None and r[i]]
            if not options:
                res.append({"word": w, "score": None, "accent": None, "phones": [], "start": None, "end": None})
                continue
            lang, rows = max(options, key=lambda o: sum(p[2] for p in o[1]) / len(o[1]))
            res.append({
                "word": w,
                "score": round(100 * sum(p[2] for p in rows) / len(rows), 1),
                "accent": "us" if lang == "en-us" else "gb",
                "start": round(offset + rows[0][3] * FRAME_S, 2),
                "end": round(offset + rows[-1][4] * FRAME_S, 2),
                "phones": [{"expected": self.inv[e], "heard": self.inv[h], "score": round(s, 3), "ok": e == h or s >= 0.5} for e, h, s, _, _ in rows],
            })
        return res

    def run(self, wav, text: str | None) -> dict:
        t0 = time.perf_counter()
        secs = len(wav) / 16000
        timing = {}
        if text and text.strip():
            mode, windows = "scripted", [(0.0, secs, WORD.findall(text))]
        else:
            mode = "spontaneous"
            segs, _ = self.asr.transcribe(wav, language="en", beam_size=5, word_timestamps=True, vad_filter=True)
            asr_words = [(w.start, w.end, m) for s in segs for w in (s.words or []) for m in WORD.findall(w.word)]
            timing["asrMs"] = round(1000 * (time.perf_counter() - t0))
            windows, cur = [], []
            for a, b, m in asr_words:
                if cur and (b - cur[0][0] > WINDOW_S or a - cur[-1][1] > 1.5):
                    windows.append((cur[0][0], cur[-1][1], [x[2] for x in cur]))
                    cur = []
                cur.append((a, b, m))
            if cur:
                windows.append((cur[0][0], cur[-1][1], [x[2] for x in cur]))
            text = " ".join(m for _, _, m in asr_words)
        t1 = time.perf_counter()
        words = []
        for a, b, ws in windows:
            a, b = max(0.0, a - 0.25), min(secs, b + 0.25)
            if ws:
                words += self.assess_window(wav[int(a * 16000):int(b * 16000)], ws, a)
        timing["alignMs"] = round(1000 * (time.perf_counter() - t1))
        scored = [w for w in words if w["score"] is not None]
        nph = sum(len(w["phones"]) for w in scored) or 1
        accuracy = round(sum(w["score"] * len(w["phones"]) for w in scored) / nph, 1) if scored else None
        # fluency from the aligned word times: rate over speaking time, and pauses between words
        gaps = [b["start"] - a["end"] for a, b in zip(scored, scored[1:]) if b["start"] is not None and a["end"] is not None]
        speech = sum(max(0.0, w["end"] - w["start"]) for w in scored)
        span = (scored[-1]["end"] - scored[0]["start"]) if len(scored) > 1 else speech
        fluency = {
            "wordsPerMinute": round(60 * len(scored) / span, 1) if span > 0 else None,
            "phonesPerSecond": round(nph / speech, 2) if speech > 0 else None,
            "pauses": sum(1 for g in gaps if g >= 0.4),
            "longPauses": sum(1 for g in gaps if g >= 1.0),
            "speakingSeconds": round(span, 2),
        }
        timing["totalMs"] = round(1000 * (time.perf_counter() - t0))
        flagged = sorted(((p["expected"], p["heard"]) for w in scored for p in w["phones"] if not p["ok"]))
        confusions: dict[str, int] = {}
        for e, h in flagged:
            confusions[f"{e}>{h}"] = confusions.get(f"{e}>{h}", 0) + 1
        return {
            "mode": mode, "text": text, "audioSeconds": round(secs, 2), "accuracy": accuracy,
            "mispronouncedWords": sum(1 for w in scored if any(not p["ok"] for p in w["phones"])),
            "words": words, "fluency": fluency,
            "confusions": sorted(({"expected": k.split(">")[0], "heard": k.split(">")[1], "count": v} for k, v in confusions.items()), key=lambda c: -c["count"])[:12],
            "timing": timing, "model": W2V,
        }

    @modal.method()
    def assess(self, audio: bytes, text: str | None = None) -> dict:
        return self.run(load16k(audio), text)

    @modal.method()
    def evaluate(self, n: int = 300, samples: int = 8) -> dict:
        """Agreement with human raters on speechocean762 (test split, Apache-2.0): Pearson r of our sentence accuracy vs theirs
        (0-10) and of word scores vs word accuracy; returns a spread of clips (low to high human score) for the playground."""
        import io

        import numpy as np
        import soundfile as sf
        from datasets import load_dataset

        ds = load_dataset("mispeech/speechocean762", split="test").shuffle(seed=7).select(range(n))
        ours, theirs, w_ours, w_theirs, rows = [], [], [], [], []
        for ex in ds:
            wav = np.asarray(ex["audio"]["array"], dtype=np.float32)
            if ex["audio"]["sampling_rate"] != 16000:
                continue
            r = self.run(wav, ex["text"])
            if r["accuracy"] is None:
                continue
            ours.append(r["accuracy"])
            theirs.append(ex["accuracy"])
            for w, hw in zip(r["words"], ex["words"]):
                if w["score"] is not None:
                    w_ours.append(w["score"])
                    w_theirs.append(hw["accuracy"])
            rows.append((ex, r))
        pcc = lambda a, b: float(np.corrcoef(a, b)[0, 1])
        rows.sort(key=lambda x: x[0]["total"])
        pick = [rows[round(i * (len(rows) - 1) / (samples - 1))] for i in range(samples)]
        out = []
        for ex, r in pick:
            buf = io.BytesIO()
            sf.write(buf, np.asarray(ex["audio"]["array"], dtype=np.float32), 16000, format="WAV", subtype="PCM_16")
            out.append({"text": ex["text"], "human": {k: ex[k] for k in ("accuracy", "completeness", "fluency", "prosodic", "total")},
                        "ours": r["accuracy"], "wav": buf.getvalue()})
        return {"n": len(ours), "sentencePearson": round(pcc(ours, theirs), 3), "wordPearson": round(pcc(w_ours, w_theirs), 3),
                "wordN": len(w_ours), "samples": out}

    @modal.asgi_app(requires_proxy_auth=True)  # needs Modal-Key/Modal-Secret headers, so strangers can't burn credits
    def web(self):
        from fastapi import FastAPI, File, Form, UploadFile

        api = FastAPI(title="Pronunciation")

        @api.post("/assess")
        async def assess(audio: UploadFile = File(...), text: str = Form("")):
            return self.run(load16k(await audio.read()), text or None)

        return api


@app.local_entrypoint()
def evaluate(n: int = 300, out: str = "apps/web/public/pron-samples"):
    """modal run modal/pronunciation/app.py::evaluate --n 300 : prints agreement and writes the playground sample clips."""
    import json
    from pathlib import Path

    r = Pron().evaluate.remote(n)
    d = Path(out)
    d.mkdir(parents=True, exist_ok=True)
    meta = []
    for i, s in enumerate(r["samples"]):
        (d / f"so762-{i + 1}.wav").write_bytes(s.pop("wav"))
        meta.append({"file": f"so762-{i + 1}.wav", **s})
    summary = {k: r[k] for k in ("n", "sentencePearson", "wordPearson", "wordN")}
    (d / "samples.json").write_text(json.dumps({"source": "speechocean762 test split (Apache-2.0, huggingface.co/datasets/mispeech/speechocean762)",
                                                "eval": summary, "samples": meta}, indent=1))
    print(json.dumps(summary, indent=1))


@app.local_entrypoint()
def assess(path: str, text: str = ""):
    """modal run modal/pronunciation/app.py::assess --path clip.wav [--text '...']"""
    import json
    from pathlib import Path

    t = time.perf_counter()
    print(json.dumps(Pron().assess.remote(Path(path).read_bytes(), text or None), indent=1))
    print(f"round trip incl. any cold start: {time.perf_counter() - t:.1f}s")
