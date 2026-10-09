import { OUT_RATE, pcm16ToFloat } from './pcm';

/** The slice of AudioContext the player uses (so tests can fake it). */
type Ctx = Pick<AudioContext, 'currentTime' | 'createBuffer' | 'createBufferSource'> & { destination: AudioNode };

/** Gapless playback of streamed 24 kHz PCM16 chunks: each chunk is scheduled right after the previous one; flush() drops whatever is still queued (barge-in or a part change). */
export class PcmPlayer {
  private next = 0;
  private live = new Set<AudioBufferSourceNode>();
  /** `tap`: an extra node every chunk also plays into (a MediaStreamDestination that reports the examiner's audio). */
  constructor(private ctx: Ctx, private tap?: AudioNode) {}

  push(pcm: Int16Array) {
    if (!pcm.length) return;
    const buf = this.ctx.createBuffer(1, pcm.length, OUT_RATE);
    buf.copyToChannel(pcm16ToFloat(pcm), 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    if (this.tap) src.connect(this.tap);
    const at = Math.max(this.ctx.currentTime + 0.03, this.next); // 30 ms of lead absorbs network jitter at the start
    src.start(at);
    this.next = at + buf.duration;
    this.live.add(src);
    src.onended = () => this.live.delete(src);
  }

  /** Seconds of audio still waiting to play. */
  get queued() {
    return Math.max(0, this.next - this.ctx.currentTime);
  }

  flush() {
    for (const s of this.live) {
      s.onended = null;
      try {
        s.stop();
      } catch {} // already ended
    }
    this.live.clear();
    this.next = 0;
  }
}
