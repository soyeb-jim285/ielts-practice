// Admin playground helpers: transcript stats and live-engine price estimates. The price tables mirror the server's (ai/cost.ts geminiLiveUsd,
// ai/openai-realtime.ts realtimeUsd, ai/cost.ts gptLiveUsd): the ledger keeps the authoritative figure, these only drive the live readout.
import type { GeminiUsage } from '@/live/geminiProtocol';
import type { RealtimeModel, RealtimeUsage } from '@/live/realtime';

/** A filled pause ("um", "uhh", "er", "hmm"), the same rule as the server's verbatim check. */
const FILLER = /^(u+m+|u+h+|e+r+m*|a+h+|h+m+|m+)$/;
export const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
export const isFiller = (w: string) => FILLER.test(bare(w));

export type Word = { w: string; start: number; end: number; conf?: number };
/** Words, filled pauses, immediate repetitions ("I I", "the the") and speaking rate over the transcribed span. */
export function transcriptStats(words: Word[]) {
  const b = words.map((w) => bare(w.w)).filter(Boolean);
  const span = words.length ? words.at(-1)!.end - words[0]!.start : 0;
  const content = b.filter((w) => !FILLER.test(w)).length;
  return {
    words: b.length,
    fillers: b.length - content,
    repeats: b.filter((w, i) => i > 0 && w === b[i - 1] && !FILLER.test(w)).length,
    wpm: span > 0 ? Math.round((content / span) * 60) : 0,
  };
}

/** The upload format the API takes, from a MIME type or a file name. */
export function audioFormat(mime: string, name = ''): 'webm' | 'm4a' | 'wav' | 'mp3' | 'ogg' | null {
  const m = mime.toLowerCase(), ext = name.toLowerCase().split('.').pop() ?? '';
  if (m.includes('webm') || ext === 'webm') return 'webm';
  if (m.includes('ogg') || ext === 'ogg' || ext === 'opus') return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac') || ext === 'm4a' || ext === 'mp4') return 'm4a';
  if (m.includes('wav') || ext === 'wav') return 'wav';
  if (m.includes('mpeg') || m.includes('mp3') || ext === 'mp3') return 'mp3';
  return null;
}

/** 16-bit mono PCM WAV of float samples (-1..1). */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  b.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); // PCM
  b.setUint16(22, 1, true); // mono
  b.setUint32(24, rate, true);
  b.setUint32(28, rate * 2, true);
  b.setUint16(32, 2, true);
  b.setUint16(34, 16, true);
  str(36, 'data');
  b.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Blob([b.buffer], { type: 'audio/wav' });
}

/** Any clip the browser can play, as 16 kHz mono WAV (Whisper's input rate): for hosts that only take WAV (CrisperWhisper's Space can't decode webm). */
export async function toWav16k(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    return encodeWav((await off.startRendering()).getChannelData(0), 16000);
  } finally {
    void ctx.close();
  }
}

/** Gemini 3.8 Live, USD per 1M tokens (paid tier). */
export const geminiUsd = (u: GeminiUsage) => (u.inputText * 0.75 + u.inputAudio * 3 + u.inputMedia * 1 + (u.outputText + u.thoughts) * 4.5 + u.outputAudio * 12) / 1e6;
/** OpenAI Realtime, USD per 1M tokens, plus the candidate's input transcription per minute. */
const REALTIME: Record<RealtimeModel, [number, number, number, number, number]> = {
  'gpt-realtime': [4, 32, 0.4, 16, 64],
  'gpt-realtime-mini': [0.6, 10, 0.3, 2.4, 20],
  'gpt-realtime-2.1': [4, 32, 0.4, 24, 64],
  'gpt-realtime-2.1-mini': [0.6, 10, 0.3, 2.4, 20],
};
export const realtimeUsd = (model: RealtimeModel, u: RealtimeUsage) => {
  const [ti, ai, ci, to, ao] = REALTIME[model];
  return (u.textIn * ti + u.audioIn * ai + u.cachedIn * ci + u.textOut * to + u.audioOut * ao) / 1e6 + (u.transcribeSeconds / 60) * 0.003;
};
/** GPT-Live bills the session by the second. */
export const gptLiveUsd = (seconds: number) => (seconds / 60) * 0.05;
