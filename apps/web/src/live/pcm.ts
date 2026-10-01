// PCM helpers for Gemini Live: the mic goes up as 16 kHz 16-bit mono, the examiner comes back as 24 kHz 16-bit mono (both little-endian, base64 in JSON).
export const IN_RATE = 16_000;
export const OUT_RATE = 24_000;
/** 40 ms of 16 kHz audio per message: the docs ask for 20-40 ms chunks (no large input buffering). */
const CHUNK_SAMPLES = (IN_RATE * 40) / 1000;

/** Streaming area-average resampler (a box filter, so downsampling 48 → 16 kHz doesn't alias much). State carries across calls, so chunk sizes don't matter. */
export class Resampler {
  private buf = new Float32Array(0);
  private pos = 0;
  private readonly step: number;
  constructor(from: number, to: number) {
    this.step = from / to;
  }
  push(input: Float32Array): Float32Array {
    const all = new Float32Array(this.buf.length + input.length);
    all.set(this.buf);
    all.set(input, this.buf.length);
    const out: number[] = [];
    let pos = this.pos;
    while (pos + this.step <= all.length) {
      const end = pos + this.step;
      let sum = 0;
      for (let i = Math.floor(pos); i < Math.ceil(end); i++) sum += all[i]! * (Math.min(i + 1, end) - Math.max(i, pos));
      out.push(sum / this.step);
      pos = end;
    }
    const drop = Math.floor(pos);
    this.buf = all.slice(drop);
    this.pos = pos - drop;
    return Float32Array.from(out);
  }
}

export function floatToPcm16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToFloat(p: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i]! / 0x8000;
  return out;
}

/** Little-endian bytes (what the wire format wants) regardless of platform endianness. */
export function pcm16ToBytes(p: Int16Array): Uint8Array {
  const out = new Uint8Array(p.length * 2);
  const v = new DataView(out.buffer);
  p.forEach((s, i) => v.setInt16(i * 2, s, true));
  return out;
}

/** Inverse of pcm16ToBytes; a trailing odd byte is dropped. */
export function bytesToPcm16(b: Uint8Array): Int16Array {
  const out = new Int16Array(b.length >> 1);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true);
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** Mic samples at the context's own rate in; 40 ms 16 kHz PCM16 byte chunks out. */
export class MicEncoder {
  private rs: Resampler;
  private pending = new Int16Array(0);
  constructor(inRate: number) {
    this.rs = new Resampler(inRate, IN_RATE);
  }
  push(f: Float32Array): Uint8Array[] {
    const pcm = floatToPcm16(this.rs.push(f));
    const all = new Int16Array(this.pending.length + pcm.length);
    all.set(this.pending);
    all.set(pcm, this.pending.length);
    const chunks: Uint8Array[] = [];
    let i = 0;
    for (; i + CHUNK_SAMPLES <= all.length; i += CHUNK_SAMPLES) chunks.push(pcm16ToBytes(all.subarray(i, i + CHUNK_SAMPLES)));
    this.pending = all.slice(i);
    return chunks;
  }
}
