// When the examiner is audible, measured on the examiner's own output audio (not caption timing, which runs ahead of playback by seconds).
// The part recorder pauses on it, so the scoring audio holds the candidate only and examiner time never reads as candidate pauses.

const FRAME_MS = 50;
/** RMS of the decoded examiner audio above which it is audible. Synthetic speech is digitally silent between words, so the threshold can be low. */
const ON_RMS = 0.01;
/** Inaudible this long ends an examiner stretch: bridges the gaps between words and sentences of one line. */
export const HANGOVER_MS = 600;

/** Pure state machine over RMS frames: true while audible, held through gaps shorter than the hangover. */
export function voiceGate(hangoverMs = HANGOVER_MS, frameMs = FRAME_MS) {
  let on = false, quiet = 0;
  return (rms: number): boolean => {
    if (rms >= ON_RMS) (quiet = 0), (on = true);
    else if (on && (quiet += frameMs) >= hangoverMs) on = false;
    return on;
  };
}

/** Calls `change(true|false)` as the examiner stream becomes audible or silent. Returns a stop function. */
export function watchExaminer(stream: MediaStream, change: (on: boolean) => void): () => void {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize), gate = voiceGate();
  let last = false;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const on = gate(Math.sqrt(sum / buf.length));
    if (on !== last) change((last = on));
  }, FRAME_MS);
  return () => {
    clearInterval(timer);
    if (last) change(false);
    void ctx.close().catch(() => {});
  };
}
