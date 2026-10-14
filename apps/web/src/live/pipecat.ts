// Pipecat examiner (admin playground): the whole cascade runs on our server (services/voice), the page only streams the mic and plays the voice
// over one WebRTC connection. Signalling goes through /api/live/pipecat/offer (owner only), which adds the examiner prompt. Turn detection (Silero
// VAD + Smart Turn v3), transcription (Soniox or Scribe, finalized when the turn ends), the LLM and the streamed voice all happen next to each
// other in Helsinki, so a reply costs no per-turn round trips from the phone. Cues and listen() go to the bot as RTVI client messages.
import type { PipecatClient } from '@pipecat-ai/client-js';
import type { Duplex, Handlers } from './duplex';
import type { ReplyTiming, StartupStep } from './cascade';

export type PipecatConfig = {
  stt: 'soniox' | 'scribe';
  llm: 'deepseek/deepseek-v4.1-flash' | 'inception/mercury-2.5' | 'mistralai/mistral-small-3.2-24b-instruct' | 'openai/gpt-6-luna';
  tts: 'openai' | 'soniox' | 'elevenlabs';
  ttsModel: 'eleven_flash_v2_5' | 'eleven_turbo_v2_5'; // ElevenLabs' streaming endpoint rejects the v4 models
  /** OpenAI or Soniox voice name, or an ElevenLabs voice id; empty: the default (OpenAI "fable", Soniox "Adrian", ElevenLabs "George"). */
  voice: string;
  /** Silero VAD: quiet this long is a pause, where Smart Turn decides. */
  vadStopSecs: number;
  /** Smart Turn said "not finished": quiet this long ends the turn anyway. */
  smartStopSecs: number;
};
export const DEFAULT_PIPECAT: PipecatConfig = { stt: 'soniox', llm: 'deepseek/deepseek-v4.1-flash', tts: 'openai', ttsModel: 'eleven_flash_v2_5', voice: '', vadStopSecs: 0.2, smartStopSecs: 1.5 };

const VOICE_RMS = 0.02; // the cascade's speech loudness, for "your last sound" on this device

export class PipecatDuplex implements Duplex {
  readonly stats = { steps: [] as StartupStep[], costUsd: 0, timeline: [] as ReplyTiming[], lastCheck: undefined as { p: number; ms: number } | undefined };
  private client?: PipecatClient;
  private h!: Handlers;
  private closed = false;
  private audio?: HTMLAudioElement;
  private ctx?: AudioContext;
  private poll?: ReturnType<typeof setInterval>;
  private lastVoice = 0; // performance.now() of the candidate's last loud mic block
  private stoppedAt = 0; // when the bot said the turn ended
  private voiceAtStop = 0;
  private ttfb: Record<string, number> = {}; // per service, this turn (ms)
  private waiting = false; // a finished answer is waiting for the examiner's voice
  private heardText = '';
  private said = new Set<number | string>(); // sentences captioned in the current line
  private newLine = true; // the next voice starts a new examiner line (after an answer or a cue)
  private inTurn = false;
  private checks: { p: number; ms: number }[] = []; // Smart Turn's verdicts in the current answer

  constructor(private cfg: PipecatConfig) {}

  private async step<T>(key: string, label: string, run: () => Promise<T>): Promise<T> {
    const s: StartupStep = { key, label, state: 'running' };
    this.stats.steps.push(s);
    const t0 = performance.now();
    try {
      const v = await run();
      s.state = 'done';
      return v;
    } catch (e) {
      s.state = 'failed';
      s.detail = (e as Error).message;
      throw e;
    } finally {
      s.ms = performance.now() - t0;
    }
  }

  async connect(h: Handlers, sessionId: string) {
    this.h = h;
    const [{ PipecatClient }, { SmallWebRTCTransport }] = await this.step('load', 'Load the WebRTC client', () => Promise.all([import('@pipecat-ai/client-js'), import('@pipecat-ai/small-webrtc-transport')]));
    const first: StartupStep = { key: 'first', label: 'Examiner first line (server: LLM + voice)', state: 'running' };
    const connecting: StartupStep = { key: 'connect', label: 'Connect: mic, WebRTC offer via our API, voice service starts the pipeline', state: 'running' };
    const client = (this.client = new PipecatClient({
      transport: new SmallWebRTCTransport({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }),
      enableMic: true,
      enableCam: false,
      callbacks: {
        // what the transport went through, on the checklist: a start that fails inside the browser says where
        onTransportStateChanged: (st) => connecting.state === 'running' && (connecting.detail = `${connecting.detail ? `${connecting.detail} → ` : ''}${st}`),
        onError: (m) => {
          const d = (m as { data?: { message?: string; error?: string } }).data;
          (connecting.state === 'running' ? connecting : first).detail = `error: ${d?.message ?? d?.error ?? JSON.stringify(m).slice(0, 160)}`;
        },
        onDeviceError: (e) => (connecting.detail = `${connecting.detail ?? ''} · mic: ${(e as { type?: string }).type ?? String(e)}`),
        onTrackStarted: (track, p) => {
          if (track.kind !== 'audio') return;
          if (p?.local) return this.watchMic(track);
          const stream = new MediaStream([track]);
          this.audio ??= Object.assign(new Audio(), { autoplay: true });
          this.audio.srcObject = stream;
          void this.audio.play().catch(() => {});
          h.output?.(stream);
        },
        onBotStartedSpeaking: () => {
          if (first.state === 'running') (first.state = 'done'), (first.ms = performance.now() - firstAt);
          if (this.waiting) this.record();
          h.speaking(true); // voice first, then the caption: listeners time the reply from the voice and start a new line on it
          // a gap between two sentences of the same reply also stops and restarts the bot's voice: only a reply starts a new caption
          if (this.newLine) (this.newLine = false), this.said.clear(), h.caption('');
        },
        onBotStoppedSpeaking: () => h.speaking(false),
        onBotOutput: (d) => {
          // a sentence is reported again as it is spoken (spoken_status / progress): caption it once
          const text = d.text.trim(), key = text; // the same sentence can come with two segment ids (LLM text and spoken text)
          if (d.aggregated_by !== 'sentence' || !text || this.said.has(key)) return;
          this.said.add(key);
          h.caption(`${this.said.size > 1 ? ' ' : ''}${text}`, true);
        },
        onUserStartedSpeaking: () => {
          this.waiting = false;
          if (!this.inTurn) (this.inTurn = true), (this.checks = []);
          h.pending?.(true);
        },
        onUserStoppedSpeaking: () => {
          this.stoppedAt = performance.now();
          this.newLine = true;
          this.voiceAtStop = this.lastVoice;
          this.inTurn = false; // sound after this (a pause the server already called the end) is not part of the answer
          this.ttfb = {};
          this.waiting = true;
          h.pending?.(false);
          h.answered();
        },
        onUserTranscript: (d) => {
          if (!d.final || !d.text.trim()) return;
          this.heardText = d.text.trim();
          h.heard?.(this.heardText);
        },
        onMetrics: (m) => {
          for (const t of m.ttfb ?? []) {
            const k = /stt/i.test(t.processor) ? 'stt' : /llm/i.test(t.processor) ? 'llm' : /tts/i.test(t.processor) ? 'tts' : '';
            if (k) this.ttfb[k] = t.value * 1000;
          }
        },
        onServerMessage: (m: { type?: string; usd?: number; p?: number; ms?: number }) => {
          if (m?.type === 'cost' && typeof m.usd === 'number') this.stats.costUsd = m.usd;
          if (m?.type === 'turn' && typeof m.p === 'number') this.checks.push({ p: m.p, ms: m.ms ?? 0 }), (this.stats.lastCheck = { p: m.p, ms: m.ms ?? 0 });
        },
        onDisconnected: () => {
          console.warn('pipecat: disconnected', this.closed ? '(closed)' : '');
          if (connecting.state === 'running') (connecting.state = 'failed'), (connecting.ms = performance.now() - firstAt);
          if (!this.closed) h.lost();
        },
      },
    }));
    const firstAt = performance.now();
    this.stats.steps.push(connecting);
    try {
      await client.connect({ webrtcRequestParams: { endpoint: '/api/live/pipecat/offer', requestData: { sessionId, cfg: this.cfg } } });
      connecting.state = 'done';
    } catch (e) {
      connecting.state = 'failed';
      connecting.detail = `${connecting.detail ? `${connecting.detail} · ` : ''}${(e as Error).message}`;
      throw e;
    } finally {
      connecting.ms = performance.now() - firstAt;
    }
    if (this.closed) throw new Error('The examiner connection was cancelled.');
    this.stats.steps.push(first);
  }

  /** "Your last sound" for the reply timeline, from the local mic (the server's own timings come in as metrics). */
  private watchMic(track: MediaStreamTrack) {
    const ctx = (this.ctx = new AudioContext());
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
    const buf = new Float32Array(an.fftSize);
    this.poll = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      if (Math.sqrt(s / buf.length) > VOICE_RMS) this.lastVoice = performance.now();
    }, 20);
  }

  /** One answered turn: last sound → turn ended (VAD + Smart Turn + final transcript, as the server reported it) → LLM → voice → playing. */
  private record() {
    this.waiting = false;
    const now = performance.now(), last = Math.min(this.voiceAtStop || this.stoppedAt, this.stoppedAt);
    const total = now - last, stt = Math.min(this.ttfb.stt ?? 0, this.stoppedAt - last);
    const llm = this.ttfb.llm ?? 0, tts = this.ttfb.tts ?? 0;
    const turnModel = this.checks.at(-1)?.ms ?? 0;
    const wait = Math.max(0, this.stoppedAt - last - stt - turnModel);
    this.stats.timeline.push({
      at: Date.now(),
      wait,
      turnModel,
      stt,
      llm,
      tts,
      net: Math.max(0, total - wait - stt - llm - tts),
      decode: 0,
      total,
      text: this.heardText,
      checks: this.checks.map((c) => Math.round(c.p * 100) / 100),
      label: `Pipecat · ${this.cfg.stt} · ${this.cfg.llm.replace(/^.*\//, '')} · ${this.cfg.tts}`,
    });
  }

  cue(text: string) {
    this.newLine = true;
    this.client?.sendClientMessage('cue', { text });
  }

  listen(on: boolean, fresh = false) {
    this.client?.sendClientMessage('listen', { on, fresh });
  }

  close() {
    this.closed = true;
    clearInterval(this.poll);
    void this.client?.disconnect().catch(() => {});
    void this.ctx?.close().catch(() => {});
    if (this.audio) this.audio.srcObject = null;
  }
}
