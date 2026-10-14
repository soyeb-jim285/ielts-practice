// Smart Turn v3.2 (pipecat-ai/smart-turn-v3, BSD-2): an 8 MB ONNX audio model that says whether the speaker has finished their turn, run on the
// device with onnxruntime-web. Input = the last 8 s of the turn at 16 kHz, zero-padded at the start, as Whisper log-mel features (80 x 800); output =
// P(turn complete). The features reproduce transformers' WhisperFeatureExtractor(chunk_length=8, do_normalize=True) (checked against it in the test).
// Model card: huggingface.co/pipecat-ai/smart-turn-v3; reference inference: github.com/pipecat-ai/smart-turn/blob/main/inference.py.
/** fp32 ("gpu" file, 32 MB) gives exactly the reference outputs in onnxruntime-web; the int8 file (8 MB, faster) drifts from Python's int8 on
 *  mid-sentence pauses (measured 2026-10-14 on TTS speech: 0.54 vs 0.74), so fp32 is the default. */
export type SmartTurnModel = 'fp32' | 'int8';
export const SMART_TURN_URL: Record<SmartTurnModel, string> = {
  fp32: 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-gpu.onnx',
  int8: 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx',
};
const ORT_VERSION = '1.30.0'; // = the package.json pin (kept there for the types only)
const SR = 16000, N_FFT = 400, HOP = 160, N_MELS = 80, SECONDS = 8;
const SAMPLES = SR * SECONDS, FRAMES = SAMPLES / HOP; // 800

let tables: { window: Float32Array; mel: Float32Array[] } | undefined;

/** Slaney mel scale and slaney-normalised triangular filters, as transformers' mel_filter_bank(norm="slaney", mel_scale="slaney"). */
function melFilters() {
  const hzToMel = (f: number) => (f < 1000 ? (3 * f) / 200 : 15 + Math.log(f / 1000) * (27 / Math.log(6.4)));
  const melToHz = (m: number) => (m < 15 ? (200 * m) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)));
  const bins = N_FFT / 2 + 1;
  const fftFreqs = Array.from({ length: bins }, (_, i) => (i * (SR / 2)) / (bins - 1));
  const lo = hzToMel(0), hi = hzToMel(SR / 2);
  const pts = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(lo + ((hi - lo) * i) / (N_MELS + 1)));
  return Array.from({ length: N_MELS }, (_, m) => {
    const f = new Float32Array(bins);
    const enorm = 2 / (pts[m + 2]! - pts[m]!);
    for (let k = 0; k < bins; k++) {
      const down = (fftFreqs[k]! - pts[m]!) / (pts[m + 1]! - pts[m]!);
      const up = (pts[m + 2]! - fftFreqs[k]!) / (pts[m + 2]! - pts[m + 1]!);
      f[k] = Math.max(0, Math.min(down, up)) * enorm;
    }
    return f;
  });
}

function getTables() {
  if (tables) return tables;
  const window = new Float32Array(N_FFT).map((_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT)); // periodic Hann
  return (tables = { window, mel: melFilters() });
}

/** Power spectrum (bins 0..200) of one real 400-sample frame: Cooley-Tukey with N = 16 x 25 (16-point DFTs, twiddles, 25-point DFTs) on
 *  precomputed tables, ~17k multiply-adds instead of the direct DFT's 160k. */
const N1 = 16, N2 = 25;
let ft: { c1: Float64Array; s1: Float64Array; tc: Float64Array; ts: Float64Array; c2: Float64Array; s2: Float64Array; ar: Float64Array; ai: Float64Array } | undefined;
function powerSpectrum(frame: Float64Array, power: Float32Array) {
  if (!ft) {
    const c1 = new Float64Array(N1 * N1), s1 = new Float64Array(N1 * N1), tc = new Float64Array(N2 * N1), ts = new Float64Array(N2 * N1), c2 = new Float64Array(N2 * N2), s2 = new Float64Array(N2 * N2);
    for (let a = 0; a < N1; a++) for (let b = 0; b < N1; b++) (c1[a * N1 + b] = Math.cos((-2 * Math.PI * a * b) / N1)), (s1[a * N1 + b] = Math.sin((-2 * Math.PI * a * b) / N1));
    for (let a = 0; a < N2; a++) for (let b = 0; b < N1; b++) (tc[a * N1 + b] = Math.cos((-2 * Math.PI * a * b) / N_FFT)), (ts[a * N1 + b] = Math.sin((-2 * Math.PI * a * b) / N_FFT));
    for (let a = 0; a < N2; a++) for (let b = 0; b < N2; b++) (c2[a * N2 + b] = Math.cos((-2 * Math.PI * a * b) / N2)), (s2[a * N2 + b] = Math.sin((-2 * Math.PI * a * b) / N2));
    ft = { c1, s1, tc, ts, c2, s2, ar: new Float64Array(N2 * N1), ai: new Float64Array(N2 * N1) };
  }
  const { c1, s1, tc, ts, c2, s2, ar, ai } = ft;
  // 1) for each n2: 16-point DFT of x[25*n1 + n2] (real input), then the twiddle W_400^(n2*k1)
  for (let n2 = 0; n2 < N2; n2++)
    for (let k1 = 0; k1 < N1; k1++) {
      let re = 0, im = 0;
      for (let n1 = 0; n1 < N1; n1++) {
        const x = frame[N2 * n1 + n2]!;
        re += x * c1[n1 * N1 + k1]!;
        im += x * s1[n1 * N1 + k1]!;
      }
      const c = tc[n2 * N1 + k1]!, sn = ts[n2 * N1 + k1]!;
      ar[n2 * N1 + k1] = re * c - im * sn;
      ai[n2 * N1 + k1] = re * sn + im * c;
    }
  // 2) for each k1: 25-point DFT over n2 gives X[k1 + 16*k2]; only bins up to 200 are needed
  for (let k1 = 0; k1 < N1; k1++)
    for (let k2 = 0; k2 < N2; k2++) {
      const k = k1 + N1 * k2;
      if (k > N_FFT / 2) continue;
      let re = 0, im = 0;
      for (let n2 = 0; n2 < N2; n2++) {
        const xr = ar[n2 * N1 + k1]!, xi = ai[n2 * N1 + k1]!, c = c2[n2 * N2 + k2]!, sn = s2[n2 * N2 + k2]!;
        re += xr * c - xi * sn;
        im += xr * sn + xi * c;
      }
      power[k] = re * re + im * im;
    }
}

/** 16 kHz mono samples of the turn (any length) → Whisper log-mel features [80 * 800], row-major (mel, frame). */
export function smartTurnFeatures(turn: Float32Array): Float32Array {
  const { window, mel } = getTables();
  const x = new Float32Array(SAMPLES);
  const src = turn.length > SAMPLES ? turn.subarray(turn.length - SAMPLES) : turn;
  x.set(src, SAMPLES - src.length); // zero padding at the start: the speech sits at the end, as in training
  // do_normalize: zero mean, unit variance over the whole 8 s window (padding included, like the reference)
  let mean = 0;
  for (const v of x) mean += v;
  mean /= SAMPLES;
  let vr = 0;
  for (const v of x) vr += (v - mean) ** 2;
  const sd = Math.sqrt(vr / SAMPLES + 1e-7);
  for (let i = 0; i < SAMPLES; i++) x[i] = (x[i]! - mean) / sd;
  // STFT with center=True reflect padding; Whisper drops the last frame
  const pad = N_FFT / 2, at = (i: number) => x[i < 0 ? -i : i >= SAMPLES ? 2 * SAMPLES - 2 - i : i]!;
  const bins = N_FFT / 2 + 1, frame = new Float64Array(N_FFT), power = new Float32Array(bins);
  const out = new Float32Array(N_MELS * FRAMES);
  let max = -Infinity;
  // frames fully inside the constant padding are identical: compute that one once
  const firstReal = Math.max(0, Math.floor((SAMPLES - src.length - N_FFT) / HOP)), constCache = new Float32Array(N_MELS);
  for (let t = 0; t < FRAMES; t++) {
    if (t > 0 && t < firstReal) {
      for (let m = 0; m < N_MELS; m++) out[m * FRAMES + t] = constCache[m]!;
      continue;
    }
    for (let n = 0; n < N_FFT; n++) frame[n] = at(t * HOP + n - pad) * window[n]!;
    powerSpectrum(frame, power);
    for (let m = 0; m < N_MELS; m++) {
      let e = 0;
      const f = mel[m]!;
      for (let k = 0; k < bins; k++) e += f[k]! * power[k]!;
      const v = Math.log10(Math.max(e, 1e-10));
      out[m * FRAMES + t] = v;
      if (t === 0) constCache[m] = v;
    }
  }
  for (const v of out) if (v > max) max = v;
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i]!, max - 8) + 4) / 4;
  return out;
}

type Session = { run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>> };
const sessions: Partial<Record<SmartTurnModel, Promise<{ ort: typeof import('onnxruntime-web'); s: Session }>>> = {};

/** Loads the runtime and the model once (cached by the browser after the first time). */
export function loadSmartTurn(model: SmartTurnModel = 'fp32') {
  return (sessions[model] ??= (async () => {
    // the runtime and its wasm load from the CDN on first use: bundling them would add ~28 MB to every deploy for an admin-only feature
    const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
    const ort = (await import(/* @vite-ignore */ `${base}ort.wasm.min.mjs`)) as typeof import('onnxruntime-web');
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.numThreads = 1;
    const bytes = await fetch(SMART_TURN_URL[model]).then((r) => {
      if (!r.ok) throw new Error(`Smart Turn model download failed (${r.status})`);
      return r.arrayBuffer();
    });
    const s = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    return { ort, s: s as unknown as Session };
  })().catch((e) => {
    delete sessions[model]; // let a later call retry
    throw e;
  }));
}

/** P(the speaker has finished) for the turn so far, and how long the check took (features + model), ms. */
export async function smartTurnProbability(turn: Float32Array, model: SmartTurnModel = 'fp32'): Promise<{ p: number; ms: number }> {
  const t0 = performance.now();
  const { ort, s } = await loadSmartTurn(model);
  const feats = smartTurnFeatures(turn);
  const out = await s.run({ input_features: new ort.Tensor('float32', feats, [1, N_MELS, FRAMES]) });
  const v = Object.values(out)[0]!.data[0]!;
  return { p: Number(v), ms: performance.now() - t0 };
}
