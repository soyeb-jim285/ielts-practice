// Gemini Live (Gemini 3.8 Live) over a browser WebSocket with an ephemeral token from our server (the token locks the model, voice and examiner instructions).
// Mic: AudioWorklet → 16 kHz PCM16 → realtimeInput.audio. Examiner: 24 kHz PCM16 chunks → PcmPlayer. Docs: ai.google.dev/gemini-api/docs/live-api (+ /ephemeral-tokens, /session-management).
import { api } from '@/lib/api';
import { useDuplexExaminer, type Duplex, type Handlers } from './duplex';
import { addUsage, audioEndMessage, emptyUsage, audioMessage, cueMessage, frameText, geminiUrl, parseGeminiMessage, setupMessage, type GeminiEvent } from './geminiProtocol';
import { bytesToPcm16, fromBase64, MicEncoder } from './pcm';
import { PcmPlayer } from './pcmPlayer';
import type { LiveExaminer, LiveSource } from './turn';

const CONNECT_MS = 15_000;
const RECONNECTS = 3; // a connection lives ~10 min; sessionResumption carries the test across it
const FALLBACK_HINT = 'Try again, or switch to the turn-based examiner in Settings.';
// Posts the mic's samples to the page in ~20 ms blocks (resampling and encoding happen there, in pcm.ts).
const WORKLET = `class C extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) { this.b[this.n++] = ch[i]; if (this.n === this.b.length) { this.port.postMessage(this.b.slice()); this.n = 0; } }
    return true;
  }
}
registerProcessor('pcm-capture', C);`;

export class GeminiDuplex implements Duplex {
  private h!: Handlers;
  private ws?: WebSocket;
  private mic?: MediaStream;
  private ctx?: AudioContext;
  private player?: PcmPlayer;
  private token = '';
  private model = '';
  private handle?: string; // latest session resumption handle
  private ready = false; // setupComplete received on the current socket
  private closed = false;
  /** Token totals so far (summed usageMetadata). */
  readonly usage = emptyUsage();
  private sessionId = '';
  private hearing = true; // false during the preparation minute and the long turn
  private fresh = true; // the next model output starts a new examiner turn
  private heard = false; // the candidate spoke since the last cue or answer
  private speaking = false;
  private endTimer?: ReturnType<typeof setTimeout>;
  private queued?: string; // a cue sent while reconnecting
  private chain: Promise<void> = Promise.resolve(); // frames are handled in arrival order even when they need an async Blob read

  private send(m: object) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  async connect(h: Handlers, sessionId: string) {
    this.h = h;
    this.sessionId = sessionId;
    const t = await api.post<{ value: string; model: string }>('/live/gemini-token', { sessionId });
    if (this.closed) throw new Error('The examiner connection was cancelled.');
    this.token = t.value;
    this.model = t.model;
    const ctx = (this.ctx = new AudioContext());
    if (!ctx.audioWorklet) throw new Error(`This browser can't capture audio for the Gemini examiner. ${FALLBACK_HINT}`);
    void ctx.resume().catch(() => {});
    this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (this.closed) {
      this.mic.getTracks().forEach((t) => t.stop());
      throw new Error('The examiner connection was cancelled.');
    }
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    if (this.closed) throw new Error('The examiner connection was cancelled.');
    const enc = new MicEncoder(ctx.sampleRate);
    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    node.port.onmessage = (e) => {
      if (!this.hearing || !this.ready) return;
      // Half duplex: the examiner plays through Web Audio, which the browser's echo cancellation may not cover, so the mic would hear the examiner
      // and Gemini would take it as the candidate interrupting (it stops after "Hello." and waits). Silence keeps the stream's clock for its VAD.
      // ponytail: the candidate can't talk over the examiner; route the player through WebRTC if barge-in matters.
      const block = e.data as Float32Array;
      for (const chunk of enc.push(this.speaking ? new Float32Array(block.length) : block)) this.send(audioMessage(chunk));
    };
    ctx.createMediaStreamSource(this.mic).connect(node);
    node.connect(ctx.destination); // silent output; keeps the capture node running
    const tap = ctx.createMediaStreamDestination(); // the examiner's voice as a stream: the part recorder pauses while it is audible
    this.player = new PcmPlayer(ctx, tap);
    h.output?.(tap.stream);

    await this.open();
    this.send(cueMessage('Begin the test.')); // the examiner opens with the introduction
  }

  /** Opens a socket and sends the setup; resolves on setupComplete. After the first success, a drop reconnects with the resumption handle. */
  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(geminiUrl(this.token)));
      let settled = false;
        const timer = setTimeout(() => {
          reject(new Error(`The Gemini examiner did not answer. ${FALLBACK_HINT}`));
          ws.close();
        }, CONNECT_MS);
      ws.onopen = () => ws.send(JSON.stringify(setupMessage(this.model, this.handle)));
      ws.onmessage = (e) => {
        this.chain = this.chain.then(async () => {
          const m = JSON.parse(await frameText(e.data));
          addUsage(this.usage, m.usageMetadata);
          for (const ev of parseGeminiMessage(m)) {
            if (ev.type === 'setupComplete') {
              this.ready = settled = true;
              clearTimeout(timer);
              resolve();
              if (this.queued) (this.send(cueMessage(this.queued)), (this.queued = undefined));
            } else this.onEvent(ev);
          }
        }).catch((e) => {
          clearTimeout(timer);
          if (!settled) reject(e);
          else if (!this.closed) this.h.lost();
        });
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        if (this.ws !== ws) return;
        this.ready = false;
        if (!settled) reject(new Error(`Could not connect to the Gemini examiner${e.reason ? ` (${e.reason})` : ''}. ${FALLBACK_HINT}`));
        else if (!this.closed) void this.reconnect();
      };
    });
  }

  private async reconnect() {
    for (let i = 0; i < RECONNECTS && !this.closed; i++) {
      if (!this.handle) break; // nothing to resume: the examiner would start over
      try {
        return await this.open();
      } catch {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    if (!this.closed) this.h.lost();
  }

  private speak(on: boolean) {
    if (this.speaking === on) return;
    this.speaking = on;
    this.h.speaking(on);
  }

  /** Examiner output is a new turn: reset the caption and, if the candidate spoke before it, report the answer. */
  private turnStart() {
    clearTimeout(this.endTimer);
    if (!this.fresh) return;
    this.fresh = false;
    this.h.caption('');
    if (this.heard) {
      this.heard = false;
      this.h.answered();
    }
  }

  private scheduleEnd(graceMs = 100) {
    clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => {
      this.fresh = true;
      this.speak(false);
    }, (this.player?.queued ?? 0) * 1000 + graceMs);
  }

  private onEvent(ev: GeminiEvent) {
    switch (ev.type) {
      case 'resume':
        this.handle = ev.handle;
        break;
      case 'inText':
        this.h.heard?.(ev.text);
        this.heard = true;
        this.h.pending?.();
        break;
      case 'audio':
        this.turnStart();
        this.player?.push(bytesToPcm16(fromBase64(ev.data)));
        this.speak(true);
        this.scheduleEnd(2500);
        break;
      case 'outText':
        this.turnStart();
        this.h.caption(ev.text, true);
        this.speak(true);
        this.scheduleEnd(2500);
        break;
      case 'interrupted': // the candidate spoke over the examiner, or a cue replaced the answer
        this.player?.flush();
        clearTimeout(this.endTimer);
        this.speak(false);
        this.fresh = true;
        break;
      case 'generationComplete':
        this.scheduleEnd();
        break;
      case 'turnComplete':
        this.fresh = true;
        this.scheduleEnd();
        break;
      case 'goAway': // the connection closes soon; onclose reconnects with the resumption handle
        console.info('gemini goAway', ev.timeLeftMs);
        break;
    }
  }

  cue(text: string) {
    this.heard = false;
    this.player?.flush(); // cut the examiner off at once; the server interrupts its generation too
    clearTimeout(this.endTimer);
    this.speak(false);
    this.fresh = true;
    if (this.ready) this.send(cueMessage(text));
    else this.queued = text;
  }

  listen(on: boolean) {
    this.hearing = on;
    if (!on) this.send(audioEndMessage()); // flush audio the server still holds
  }

  /** Sends the session's token totals so the server can price it (the browser is the only one that sees them). Best effort, survives page unload. */
  private reportUsage() {
    const u = this.usage;
    if (!this.sessionId || !Object.values(u).some(Boolean)) return;
    void fetch('/api/live/gemini-usage', { method: 'POST', credentials: 'include', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: this.sessionId, usage: u }) }).catch(() => {});
  }

  close() {
    if (!this.closed) this.reportUsage();
    this.closed = true;
    clearTimeout(this.endTimer);
    this.ws?.close();
    this.player?.flush();
    this.mic?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ws = this.mic = this.ctx = this.player = undefined;
  }
}

export function useGeminiExaminer(onFinished: (sessionId: string, attemptIds: string[]) => void, onUnavailable?: (reason: string) => void, source?: LiveSource, mockId?: string): LiveExaminer {
  return useDuplexExaminer(() => new GeminiDuplex(), onFinished, onUnavailable, source, mockId);
}
