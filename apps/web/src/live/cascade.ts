// Fast cascade examiner (admin playground): every stage is a setting, so the playground can compare them (CascadeConfig).
//  Ears (mic → transcript):
//   - Scribe v2 Realtime / Soniox stt-rt-v5: AudioWorklet → local VAD → WebSocket, only the candidate's speech is sent; we commit (Scribe) or
//     finalize (Soniox) when the turn ends.
//   - OpenAI gpt-4o(-mini)-transcribe: WebRTC Realtime transcription session; its server VAD ends the turn (turn settings don't apply).
//   - OpenRouter batch transcribers: the browser keeps the turn's audio and sends it as WAV, whole or in pieces cut at "not finished" pauses.
//  End of turn (Scribe and batch): a fixed silence, or Smart Turn on the device (smartTurn.ts) after a short pause, with a silence cap as a safety net.
//  Reply: /live/cascade/reply (one JSON with the whole line and its audio) or /live/cascade/reply-stream (NDJSON: the LLM streamed, each sentence
//  voiced as soon as it is written, clips played in order). Same handlers as the speech-to-speech engines, so useDuplexExaminer runs the script,
//  timers and stall watchdog unchanged.
import { api } from '@/lib/api';
import { blobToBase64, encodeWav } from '@/components/admin/playground';
import type { Duplex, Handlers } from './duplex';
import { WORKLET } from './gemini';
import { fromBase64, IN_RATE, MicEncoder, Resampler, toBase64 } from './pcm';
import { loadSmartTurn, smartTurnProbability, type SmartTurnModel } from './smartTurn';

export type CascadeLlm = 'deepseek/deepseek-v4.1-flash' | 'inception/mercury-2.5' | 'mistralai/mistral-small-3.2-24b-instruct' | 'openai/gpt-6-luna';
export type CascadeStreamStt = 'scribe_v2_realtime' | 'stt-rt-v5' | 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe';
export type CascadeBatchStt = 'elevenlabs/scribe-v2' | 'nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b' | 'nvidia/parakeet-tdt-0.6b-v3' | 'openai/whisper-large-v3-turbo' | 'deepgram/nova-3' | 'openai/gpt-4o-mini-transcribe';
export type CascadeStt = CascadeStreamStt | `batch:${CascadeBatchStt}`;
export type CascadeTts = 'elevenlabs/eleven-v4-turbo' | 'elevenlabs/eleven-flash-v2.5' | 'google/gemini-3.8-flash-lite-tts' | 'google/gemini-3.8-flash-tts';

export type CascadeConfig = {
  stt: CascadeStt;
  llm: CascadeLlm;
  tts: CascadeTts;
  /** End of turn: fixed silence or Smart Turn after a short pause, decided in the browser; 'server': the OpenAI session's own silence detection. */
  turn: 'smart' | 'silence' | 'server';
  silenceMs: number; // silence mode: quiet this long ends the turn
  smartPauseMs: number; // smart mode: run the model after this pause
  smartThreshold: number; // smart mode: P(complete) at or above this ends the turn
  smartMaxMs: number; // smart mode: quiet this long ends the turn whatever the model says
  smartModel: SmartTurnModel; // fp32 (32 MB, exact) or int8 (8 MB, faster, drifts in the browser)
  /** Batch ears: transcribe each finished piece during "not finished" pauses, so only the tail is left when the turn ends. */
  chunkedStt: boolean;
  /** Stream the reply (LLM as NDJSON) instead of one JSON reply. */
  stream: boolean;
  /** With stream: voice each sentence as soon as it is written (false: one TTS call for the whole line). */
  sentenceTts: boolean;
};
export const DEFAULT_CASCADE: CascadeConfig = {
  stt: 'scribe_v2_realtime', llm: 'deepseek/deepseek-v4.1-flash', tts: 'elevenlabs/eleven-v4-turbo',
  turn: 'smart', silenceMs: 1000, smartPauseMs: 250, smartThreshold: 0.5, smartMaxMs: 3000, smartModel: 'fp32', chunkedStt: true, stream: true, sentenceTts: true,
};

/** One startup step, for the playground's checklist. */
export type StartupStep = { key: string; label: string; state: 'running' | 'done' | 'failed' | 'skipped'; ms?: number; detail?: string };

/** One answered turn, ms from the candidate's last sound to the examiner's first sound, split into stages that add up to `total`:
 *  wait (silence before the turn counted as finished, minus the turn model), turnModel (Smart Turn checks of the deciding pause), stt (turn end →
 *  final transcript), llm (to the first sentence when streamed, else the whole line), tts (then until its audio was ready), net (round trip minus
 *  the server's own time), decode (browser decode until playback). */
export type ReplyTiming = { at: number; wait: number; turnModel: number; stt: number; llm: number; tts: number; net: number; decode: number; total: number; text: string; checks: number[]; label: string };
type Turn = { role: 'examiner' | 'candidate' | 'app'; text: string };
type Line = { text: string; audio: string | null; contentType: string | null; ms: { llm: number; tts: number }; costUsd: number };
type StreamEvent =
  | { type: 'text'; i: number; text: string; ms: number }
  | { type: 'audio'; i: number; audio: string; contentType: string; ms: number }
  | { type: 'done'; text: string; ms: { llmFirst: number; llm: number; ttsFirst: number | null }; costUsd: number }
  | { type: 'error'; error: string };

const CONNECT_MS = 15_000;
const SCRIBE_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const RECHECK_MS = 300; // Smart Turn re-checks a pause it called unfinished this often
const VOICE_RMS = 0.02; // mic block loudness that counts as speech (echo cancellation and noise suppression are on), as for Gemini
const CHUNK_MS = 40; // MicEncoder chunk length
const PRE_MS = 320; // audio kept from before the first loud block, so the first word isn't clipped
const COMMIT_WAIT_MS = 8000; // a turn whose transcript never comes stops blocking the reply after this
const OPENAI_VAD_MS = 1000; // the OpenAI session's silence_duration_ms (server side, so only an estimate in the timeline)
const MIN_PIECE_S = 0.6; // a chunked-transcription piece shorter than this waits for the next pause

const sum = (xs: Float32Array[]) => {
  const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of xs) out.set(x, o), (o += x.length);
  return out;
};

export class CascadeDuplex implements Duplex {
  private h!: Handlers;
  private sessionId = '';
  private readonly cfg: CascadeConfig;
  private ws?: WebSocket;
  private pc?: RTCPeerConnection; // OpenAI transcription session
  private dc?: RTCDataChannel;
  private ready = false; // session_started on the current socket
  private opening?: Promise<void>;
  private outbox: (string | Uint8Array<ArrayBuffer>)[] = []; // messages waiting for a socket (Scribe may close an idle one; the next speech reopens it)
  private mic?: MediaStream;
  private ctx?: AudioContext;
  private tap?: MediaStreamAudioDestinationNode;
  private playing = new Set<AudioBufferSourceNode>();
  private playEnd = 0; // ctx time when the queued clips finish
  private streamOpen = false; // a streamed reply may still send clips: a gap between clips is not the end of the voice
  private closed = false;
  private turns: Turn[] = [];
  private said = ''; // candidate speech not yet in `turns`
  private inSpeech = false;
  private commits = 0; // turns ended (and owed a transcript)
  private transcribed = 0; // of those, transcribed (or given up on)
  private replies = true; // false in the prep minute and the long turn: transcribed, but no reply until the next cue
  private hearing = true;
  private heard = false; // the candidate spoke since the last cue or answer
  private seq = 0; // newest reply request; older answers are dropped
  private sttSeconds = 0; // streamed-ear audio not yet reported (Scribe: what we sent; OpenAI: what the session reports)
  // the current turn (Scribe and batch ears)
  private pre: Float32Array[] = [];
  private turnAudio: Float32Array[] = [];
  private turnSamples = 0;
  private cutAt = 0; // samples of this turn already sent as chunked pieces
  private pieces: Promise<string>[] = [];
  private quiet = 0;
  private lastVoiceAt = 0;
  private pauseId = 0; // bumps whenever speech resumes, so a late Smart Turn answer for an old pause is ignored
  private checking = false;
  private nextCheck = 0; // quiet ms at which Smart Turn checks this pause (again)
  private checks: { p: number; ms: number; pause: number }[] = [];
  private smartOk = false;
  // what the timeline needs about the last turn
  private turnInfo?: { lastVoice: number; decided: number; model: number; checks: number[] };
  private transcriptAt?: number;
  /** Running totals for the playground: cost (STT + LLM + TTS, from the server), the last reply's server timings, the per-reply timeline. */
  readonly stats = { steps: [] as StartupStep[], costUsd: 0, replies: 0, last: undefined as { llm: number; tts: number } | undefined, timeline: [] as ReplyTiming[], turnModel: 'off' as 'off' | 'loading' | 'ready' | 'failed', lastCheck: undefined as { p: number; ms: number } | undefined };

  constructor(cfg: Partial<CascadeConfig> = {}) {
    this.cfg = { ...DEFAULT_CASCADE, ...cfg };
    if (this.cfg.turn === 'server' && !this.cfg.stt.startsWith('gpt-')) this.cfg.turn = 'smart'; // only OpenAI has a server VAD
  }

  /** Runs one startup step and records its state and duration (the playground shows them as a checklist). */
  private async step<T>(key: string, label: string, run: (s: StartupStep) => Promise<T>): Promise<T> {
    const s: StartupStep = { key, label, state: 'running' };
    this.stats.steps.push(s);
    const t0 = performance.now();
    try {
      const v = await run(s);
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

  private get ear(): 'scribe' | 'soniox' | 'openai' | 'batch' {
    return this.cfg.stt === 'scribe_v2_realtime' ? 'scribe' : this.cfg.stt === 'stt-rt-v5' ? 'soniox' : this.cfg.stt.startsWith('batch:') ? 'batch' : 'openai';
  }
  /** Ears we stream the candidate's speech to over our own WebSocket. */
  private get socketEar() {
    return this.ear === 'scribe' || this.ear === 'soniox';
  }

  async connect(h: Handlers, sessionId: string) {
    this.h = h;
    this.sessionId = sessionId;
    const ctx = (this.ctx = new AudioContext());
    if (!ctx.audioWorklet) throw new Error("This browser can't capture audio for the cascade examiner.");
    void ctx.resume().catch(() => {});
    this.tap = ctx.createMediaStreamDestination(); // the examiner's voice as a stream: the part recorder pauses while it is audible
    h.output?.(this.tap.stream);
    const mic = (this.mic = await this.step('mic', 'Microphone permission', () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })));
    if (this.closed) {
      mic.getTracks().forEach((x) => x.stop());
      throw new Error('The examiner connection was cancelled.');
    }
    const serverVad = this.ear === 'openai' && this.cfg.turn === 'server';
    if (serverVad) {
      await this.step('stt', 'Transcriber: OpenAI session (server VAD)', () => this.openOpenAi(mic, true));
      return this.firstLine();
    }
    // Everything else runs side by side: the examiner can open the test while the turn model downloads (the silence timer stands in until it is
    // ready) and while the transcriber connects.
    if (this.cfg.turn === 'smart') {
      this.stats.turnModel = 'loading';
      const mb = (b?: number) => (b == null ? '?' : (b / 1e6).toFixed(1));
      void this.step('turn', `Turn model: Smart Turn ${this.cfg.smartModel} (cached after the first time)`, (s) =>
        loadSmartTurn(this.cfg.smartModel, (stage, loaded, total) => (s.detail = stage === 'runtime' ? 'loading the runtime' : stage === 'download' ? `downloading ${mb(loaded)} / ${mb(total)} MB` : 'starting the model')),
      ).then(
        () => ((this.smartOk = true), (this.stats.turnModel = 'ready')),
        (e) => (console.warn('Smart Turn unavailable, using the silence timer', e), (this.stats.turnModel = 'failed')),
      );
    }
    await this.step('capture', 'Audio capture', async () => {
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
      const enc = new MicEncoder(ctx.sampleRate), rs = new Resampler(ctx.sampleRate, IN_RATE);
      const node = new AudioWorkletNode(ctx, 'pcm-capture');
      node.port.onmessage = (e) => {
        const block = e.data as Float32Array; // a disabled track (examiner speaking, prep minute) is silence, so it never opens the gate
        let s2 = 0;
        for (const v of block) s2 += v * v;
        this.onBlock(Math.sqrt(s2 / block.length) > VOICE_RMS, (block.length / ctx.sampleRate) * 1000, rs.push(block), this.socketEar ? enc.push(block) : []);
      };
      ctx.createMediaStreamSource(mic).connect(node);
      node.connect(ctx.destination); // silent output; keeps the capture node running
    });
    const ear =
      this.ear === 'scribe' ? this.step('stt', 'Transcriber: Scribe v2 Realtime (token + socket)', () => this.open())
      : this.ear === 'soniox' ? this.step('stt', 'Transcriber: Soniox stt-rt-v5 (temporary key + socket)', () => this.open())
      : this.ear === 'openai' ? this.step('stt', 'Transcriber: OpenAI session (browser commits)', () => this.openOpenAi(mic, false))
      : this.step('stt', 'Transcriber: OpenRouter batch (nothing to connect)', async () => {});
    this.firstLine();
    await ear; // a transcriber that can't connect still fails the start
  }

  /** The examiner opens the test; the step finishes when the first line starts playing. */
  private firstLine() {
    const s: StartupStep = { key: 'first', label: 'Examiner first line (LLM + voice)', state: 'running' };
    this.stats.steps.push(s);
    this.firstStep = { s, t0: performance.now() };
    this.cue('Begin the test.');
  }
  private firstStep?: { s: StartupStep; t0: number };

  /** One mic block: 16 kHz samples for the turn buffer (Smart Turn, batch ears) and PCM16 chunks for Scribe. */
  private onBlock(loud: boolean, ms: number, f16: Float32Array, chunks: Uint8Array[]) {
    const now = performance.now();
    if (!this.inSpeech) {
      this.pre.push(f16);
      for (let n = this.pre.reduce((a, x) => a + x.length, 0); n > (PRE_MS / 1000) * IN_RATE && this.pre.length > 1; n -= this.pre.shift()!.length);
      this.preChunks.push(...chunks);
      this.preChunks.splice(0, this.preChunks.length - PRE_MS / CHUNK_MS);
      if (!loud) return;
      this.turnAudio = [...this.pre];
      this.turnSamples = this.turnAudio.reduce((a, x) => a + x.length, 0);
      this.pre = [];
      this.cutAt = 0;
      this.pieces = [];
      this.checks = [];
      this.quiet = 0;
      this.lastVoiceAt = now;
      this.speechStart();
      this.sendChunks(this.preChunks.splice(0));
      return;
    }
    this.turnAudio.push(f16);
    this.turnSamples += f16.length;
    this.sendChunks(chunks);
    if (loud) {
      if (this.quiet > 0) (this.pauseId++, (this.nextCheck = 0));
      this.quiet = 0;
      this.lastVoiceAt = now;
      return;
    }
    this.quiet += ms;
    const smart = this.cfg.turn === 'smart' && this.smartOk;
    if (!smart) {
      if (this.quiet >= this.cfg.silenceMs) this.endTurn(0);
      return;
    }
    if (this.quiet >= this.cfg.smartMaxMs) return this.endTurn(this.checks.filter((c) => c.pause === this.pauseId).reduce((a, c) => a + c.ms, 0));
    if (this.quiet >= Math.max(this.cfg.smartPauseMs, this.nextCheck) && !this.checking) void this.checkTurn();
  }

  private preChunks: Uint8Array[] = [];

  private async checkTurn() {
    this.checking = true;
    const pause = this.pauseId, at = this.quiet;
    try {
      const { p, ms } = await smartTurnProbability(sum(this.turnAudio), this.cfg.smartModel);
      this.checks.push({ p, ms, pause });
      this.stats.lastCheck = { p, ms };
      if (!this.inSpeech || pause !== this.pauseId) return; // they spoke again while it ran
      if (p >= this.cfg.smartThreshold) return this.endTurn(this.checks.filter((c) => c.pause === pause).reduce((a, c) => a + c.ms, 0));
      // "Not finished" often turns into "finished" as the pause grows (measured on TTS speech: 0.02 at 250 ms, 0.63 at 1 s), so look again
      // every RECHECK_MS instead of waiting for the cap
      this.nextCheck = at + RECHECK_MS;
      if (this.ear === 'batch' && this.cfg.chunkedStt && this.checks.filter((c) => c.pause === pause).length === 1) this.sendPiece(false);
    } catch (e) {
      console.warn('Smart Turn check failed, using the silence timer', e);
      this.smartOk = false;
      this.stats.turnModel = 'failed';
    } finally {
      this.checking = false;
    }
  }

  /** The turn ended (silence timer, Smart Turn or its cap): commit it to the ear. `model`: Smart Turn ms spent on the deciding pause. */
  private endTurn(model: number) {
    const decided = performance.now();
    this.turnInfo = { lastVoice: this.lastVoiceAt, decided, model, checks: this.checks.map((c) => Math.round(c.p * 100) / 100) };
    if (this.ear === 'batch') this.sendPiece(true);
    if (this.ear === 'openai') this.dc?.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); // the session has no VAD: we end the answer
    this.speechEnd(this.socketEar);
  }

  /** Batch ears: transcribe the turn audio since the last cut (`last`: the turn's tail; else only a piece long enough to be worth it). */
  private sendPiece(last: boolean) {
    const all = sum(this.turnAudio);
    if (!last && (all.length - this.cutAt) / IN_RATE < MIN_PIECE_S) return;
    const piece = all.subarray(this.cutAt);
    this.cutAt = all.length;
    if (piece.length / IN_RATE < 0.15 && this.pieces.length) return;
    const model = this.cfg.stt.slice('batch:'.length);
    this.pieces.push(
      blobToBase64(encodeWav(piece, IN_RATE))
        .then((audio) => api.post<{ text: string; costUsd: number | null }>('/live/cascade/transcribe', { sessionId: this.sessionId, audio, model }))
        .then((r) => ((this.stats.costUsd += r.costUsd ?? 0), r.text))
        .catch((e) => (console.warn('cascade transcribe failed', e), '')),
    );
    if (last) {
      const pieces = this.pieces;
      void Promise.all(pieces).then((texts) => this.transcript(texts.filter(Boolean).join(' ')));
    }
  }

  private sendChunks(chunks: Uint8Array[]) {
    if (!this.socketEar || !chunks.length) return;
    for (const c of chunks) this.send(this.ear === 'soniox' ? c : { message_type: 'input_audio_chunk', audio_base_64: toBase64(c), commit: false, sample_rate: IN_RATE });
    this.sttSeconds += (chunks.length * CHUNK_MS) / 1000;
  }

  /** OpenAI Realtime transcription session over WebRTC: the mic track goes up, server VAD and transcripts come back on the data channel. */
  private async openOpenAi(mic: MediaStream, serverVad: boolean) {
    const t = await api.post<{ value?: string }>('/live/cascade/stt-token', { sessionId: this.sessionId, stt: this.cfg.stt, serverVad });
    if (!t.value) throw new Error('The transcription service sent no credentials.');
    const pc = (this.pc = new RTCPeerConnection());
    pc.addTrack(mic.getAudioTracks()[0]!, mic);
    const dc = (this.dc = pc.createDataChannel('oai-events'));
    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The transcription service did not answer.')), CONNECT_MS);
      dc.onopen = () => (clearTimeout(timer), resolve());
    });
    dc.onmessage = (e) => this.onOpenAi(JSON.parse(String(e.data)));
    dc.onclose = () => { if (!this.closed) this.h.lost(); };
    await pc.setLocalDescription(await pc.createOffer());
    const res = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: pc.localDescription!.sdp, headers: { Authorization: `Bearer ${t.value}`, 'Content-Type': 'application/sdp' }, signal: AbortSignal.timeout(CONNECT_MS) });
    if (!res.ok) throw new Error(`Could not connect to OpenAI transcription (${res.status}).`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    await opened;
  }

  private onOpenAi(ev: { type: string; transcript?: string; usage?: { type?: string; seconds?: number }; error?: { message?: string } }) {
    if (ev.type === 'input_audio_buffer.speech_started') this.speechStart();
    else if (ev.type === 'input_audio_buffer.speech_stopped') {
      const now = performance.now();
      this.turnInfo = { lastVoice: now - OPENAI_VAD_MS, decided: now, model: 0, checks: [] };
      this.speechEnd(false);
    } else if (ev.type === 'conversation.item.input_audio_transcription.completed' || ev.type === 'conversation.item.input_audio_transcription.failed') {
      if (ev.usage?.type === 'duration') this.sttSeconds += ev.usage.seconds ?? 0;
      this.transcript(ev.transcript);
    } else if (ev.type === 'error') console.warn('cascade stt', ev.error?.message);
  }

  /** One Scribe/Soniox socket at a time, opened with a fresh single-use token; queued messages go out once the session starts. */
  private open(): Promise<void> {
    if (this.ear === 'soniox') return (this.opening ??= this.openSoniox().finally(() => (this.opening = undefined)));
    return (this.opening ??= (async () => {
      const { token } = await api.post<{ token: string }>('/live/cascade/stt-token', { sessionId: this.sessionId });
      if (this.closed) throw new Error('The examiner connection was cancelled.');
      const q = new URLSearchParams({ model_id: 'scribe_v2_realtime', token, audio_format: 'pcm_16000', commit_strategy: 'manual', language_code: 'en' });
      const ws = (this.ws = new WebSocket(`${SCRIBE_URL}?${q}`));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => (reject(new Error('The transcription service did not answer.')), ws.close()), CONNECT_MS);
        ws.onmessage = (e) => {
          const m = JSON.parse(String(e.data));
          if (m.message_type !== 'session_started') return this.onEvent(m);
          clearTimeout(timer);
          this.ready = true;
          for (const x of this.outbox.splice(0)) ws.send(x);
          resolve();
        };
        ws.onclose = (e) => {
          clearTimeout(timer);
          if (this.ws === ws) (this.ws = undefined), (this.ready = false);
          reject(new Error(`Could not connect to ElevenLabs transcription${e.reason ? ` (${e.reason})` : ''}.`));
        };
      });
    })().finally(() => (this.opening = undefined)));
  }

  /** Soniox: the temporary key goes in the first message; we finalize each turn ourselves (its own endpoint detection is off), and a keepalive holds
   *  the socket open while the examiner speaks (we send only the candidate's speech). */
  private async openSoniox() {
    const { key } = await api.post<{ key: string }>('/live/cascade/stt-token', { sessionId: this.sessionId, stt: 'stt-rt-v5' });
    if (this.closed) throw new Error('The examiner connection was cancelled.');
    const ws = (this.ws = new WebSocket(SONIOX_URL));
    ws.binaryType = 'arraybuffer';
    this.sonioxFinal = '';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => (reject(new Error('The transcription service did not answer.')), ws.close()), CONNECT_MS);
      let keep: ReturnType<typeof setInterval> | undefined;
      ws.onopen = () => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ api_key: key, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: IN_RATE, num_channels: 1, language_hints: ['en'], enable_endpoint_detection: false }));
        this.ready = true;
        for (const x of this.outbox.splice(0)) ws.send(x);
        keep = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"keepalive"}'), 5000);
        resolve();
      };
      ws.onmessage = (e) => this.onSoniox(JSON.parse(String(e.data)));
      ws.onclose = (e) => {
        clearTimeout(timer);
        clearInterval(keep);
        if (this.ws === ws) (this.ws = undefined), (this.ready = false);
        reject(new Error(`Could not connect to Soniox transcription${e.reason ? ` (${e.reason})` : ''}.`));
      };
    });
  }

  private sonioxFinal = '';
  /** Final tokens add up to the turn's text; `<fin>` (our finalize answered) closes it. */
  private onSoniox(m: { tokens?: { text: string; is_final: boolean }[]; error_code?: number; error_message?: string }) {
    if (m.error_code || m.error_message) console.warn('cascade stt soniox', m.error_code, m.error_message);
    for (const t of m.tokens ?? []) {
      if (!t.is_final) continue;
      if (t.text === '<fin>') this.transcript(this.sonioxFinal), (this.sonioxFinal = '');
      else if (t.text !== '<end>') this.sonioxFinal += t.text;
    }
  }

  private send(m: object | Uint8Array<ArrayBuffer> | string) {
    if (this.closed) return;
    const x = m instanceof Uint8Array || typeof m === 'string' ? m : JSON.stringify(m);
    if (this.ready) return this.ws!.send(x);
    this.outbox.push(x);
    if (!this.opening)
      void this.open().catch((e) => {
        console.warn('cascade stt', e);
        this.outbox = [];
        if (!this.closed) this.h.lost();
      });
  }

  private speechStart() {
    this.inSpeech = true;
    this.seq++; // they went on talking: a reply already asked for would cut them off
    this.h.pending?.(true);
  }

  /** The turn ended: one more transcript is owed (Scribe: we commit it; OpenAI: the server VAD already did; batch: the pieces are on their way). */
  private speechEnd(commit = true) {
    this.inSpeech = false;
    this.quiet = 0;
    if (commit) this.send(this.ear === 'soniox' ? '{"type":"finalize"}' : { message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: IN_RATE });
    const n = ++this.commits;
    setTimeout(() => {
      if (this.transcribed >= n) return;
      this.transcribed = n;
      this.answerIfDone();
    }, COMMIT_WAIT_MS);
    this.h.pending?.(false);
  }

  private onEvent(m: { message_type: string; text?: string; error?: string }) {
    if (m.message_type === 'committed_transcript') this.transcript(m.text);
    else if (m.error) console.warn('cascade stt', m.message_type, m.error);
  }

  private transcript(text?: string) {
    this.transcriptAt = performance.now();
    this.transcribed = Math.min(this.transcribed + 1, this.commits);
    if (text?.trim()) {
      this.said = `${this.said} ${text.trim()}`.trim();
      this.heard = true;
      this.h.heard?.(text);
    }
    this.h.pending?.(this.inSpeech);
    this.answerIfDone();
  }

  /** The candidate stopped and every piece of their speech is transcribed: ask for the examiner's reply. */
  private answerIfDone() {
    if (!this.replies || this.inSpeech || this.transcribed < this.commits || !this.said) return;
    this.flushSaid();
    void this.reply();
  }

  private flushSaid() {
    if (this.said) this.turns.push({ role: 'candidate', text: this.said });
    this.said = '';
  }

  private replyBody() {
    const secs = this.ear === 'batch' ? 0 : this.sttSeconds; // batch transcription was priced by /transcribe
    this.sttSeconds = 0;
    return { secs, body: { sessionId: this.sessionId, turns: this.turns.slice(-200), llm: this.cfg.llm, tts: this.cfg.tts, stt: this.cfg.stt.replace(/^batch:/, ''), ...(secs && { sttSeconds: secs }) } };
  }

  private async reply() {
    const n = ++this.seq;
    const answered = this.turns.at(-1)?.role === 'candidate' && this.turnInfo && this.transcriptAt != null ? { ...this.turnInfo, heard: this.transcriptAt } : undefined;
    this.turnInfo = undefined;
    if (this.cfg.stream) return this.replyStream(n, answered);
    const sentAt = performance.now();
    const { secs, body } = this.replyBody();
    let line: Line;
    try {
      line = await api.post<Line>('/live/cascade/reply', body);
    } catch (e) {
      this.sttSeconds += secs;
      console.warn('cascade reply failed', e); // the stall watchdog nudges again, and gives up after its limit
      return;
    }
    const recvAt = performance.now();
    this.stats.costUsd += line.costUsd;
    if (this.closed || n !== this.seq || !line.text) return;
    const buf = line.audio ? await this.ctx!.decodeAudioData(fromBase64(line.audio).buffer as ArrayBuffer).catch(() => null) : null;
    if (this.closed || n !== this.seq) return;
    this.stats.replies++;
    this.stats.last = line.ms;
    this.startLine(line.text);
    if (buf) this.enqueue(buf, true);
    else this.h.speaking(false);
    if (answered) this.record(answered, { sentAt, firstAudioAt: recvAt, playAt: performance.now(), llm: line.ms.llm, tts: line.ms.tts, serverFirstAudio: line.ms.llm + line.ms.tts, text: line.text });
  }

  /** Streamed reply: captions and clips as they come; clip i plays after clip i-1. */
  private async replyStream(n: number, answered?: { lastVoice: number; decided: number; model: number; checks: number[]; heard: number }) {
    const sentAt = performance.now();
    const { secs, body } = this.replyBody();
    let res: Response;
    try {
      res = await fetch('/api/live/cascade/reply-stream', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, sentenceTts: this.cfg.sentenceTts }) });
      if (!res.ok || !res.body) throw new Error(`reply-stream ${res.status}`);
    } catch (e) {
      this.sttSeconds += secs;
      console.warn('cascade reply failed', e);
      return;
    }
    this.streamOpen = true;
    const clips = new Map<number, AudioBuffer | null>();
    let next = 0, texts = 0, started = false, done = false, firstAudio: { at: number; ms: number } | undefined, llmFirst = 0, full = '';
    const flushQueue = () => {
      while (clips.has(next)) {
        const b = clips.get(next)!;
        next++;
        if (b) this.enqueue(b, false);
      }
      // the stream is over and nothing more will arrive: indexes whose voice failed are skipped
      if (done && next < (this.cfg.sentenceTts ? texts : 1) && !clips.has(next)) (clips.set(next, null), flushQueue());
      if (done && !this.playing.size && started) this.h.speaking(false);
    };
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as StreamEvent;
        if (this.closed || n !== this.seq) continue; // overtaken: read to the end, play nothing
        if (ev.type === 'text') {
          if (!started) (this.startLine(ev.text), (started = true), (llmFirst = ev.ms));
          else this.h.caption(` ${ev.text}`, true);
          texts++;
        } else if (ev.type === 'audio') {
          const at = performance.now();
          const b = await this.ctx!.decodeAudioData(fromBase64(ev.audio).buffer as ArrayBuffer).catch(() => null);
          if (this.closed || n !== this.seq) continue;
          if (!firstAudio && b) firstAudio = { at, ms: ev.ms };
          clips.set(ev.i, b);
          const before = this.playing.size;
          flushQueue();
          if (answered && firstAudio && before === 0 && this.playing.size && this.stats.timeline.at(-1)?.at !== answered.decided)
            this.record(answered, { sentAt, firstAudioAt: firstAudio.at, playAt: performance.now(), llm: llmFirst, tts: firstAudio.ms - llmFirst, serverFirstAudio: firstAudio.ms, text: '' }, answered.decided);
        } else if (ev.type === 'done') {
          done = true;
          this.streamOpen = false;
          full = ev.text;
          this.stats.costUsd += ev.costUsd;
          this.stats.replies++;
          this.stats.last = { llm: ev.ms.llm, tts: ev.ms.ttsFirst ?? 0 };
          const last = this.stats.timeline.at(-1);
          if (last && answered && last.at === answered.decided) last.text = full;
          flushQueue();
        } else if (ev.type === 'error') console.warn('cascade reply', ev.error);
      }
    }
    if (n === this.seq) this.streamOpen = false;
    if (this.closed || n !== this.seq) return;
    if (full) this.turns.push({ role: 'examiner', text: full });
    if (!started || !this.playing.size) this.h.speaking(false);
  }

  /** A new examiner line: report the answer, reset the caption. The voice starts with the first clip. */
  private startLine(text: string) {
    if (this.firstStep) (this.firstStep.s.state = 'done'), (this.firstStep.s.ms = performance.now() - this.firstStep.t0), (this.firstStep = undefined);
    if (!this.cfg.stream) this.turns.push({ role: 'examiner', text });
    if (this.heard) (this.heard = false), this.h.answered();
    this.stopAll();
    this.h.speaking(true); // voice first, then the caption: listeners time the reply from the voice and start a new line on it
    this.h.caption('');
    this.h.caption(text, true);
  }

  private record(a: { lastVoice: number; decided: number; model: number; checks: number[]; heard: number }, r: { sentAt: number; firstAudioAt: number; playAt: number; llm: number; tts: number; serverFirstAudio: number; text: string }, at = Date.now()) {
    const label = [this.cfg.stt.replace(/^batch:/, 'batch '), this.ear === 'openai' && this.cfg.turn === 'server' ? 'server VAD' : this.cfg.turn === 'smart' && this.smartOk ? 'Smart Turn' : `${this.cfg.silenceMs} ms silence`, this.cfg.stream ? (this.cfg.sentenceTts ? 'streamed, per sentence' : 'streamed, whole line') : 'one reply'].join(' · ');
    this.stats.timeline = [
      ...this.stats.timeline,
      {
        at, label, text: r.text, checks: a.checks,
        wait: Math.max(0, a.decided - a.lastVoice - a.model), turnModel: a.model,
        stt: Math.max(0, r.sentAt - a.decided), llm: r.llm, tts: Math.max(0, r.tts),
        net: Math.max(0, r.firstAudioAt - r.sentAt - r.serverFirstAudio), decode: Math.max(0, r.playAt - r.firstAudioAt), total: r.playAt - a.lastVoice,
      },
    ].slice(-50);
  }

  /** Plays a clip after whatever is queued. `alone`: a one-shot reply, so the voice ends with this clip. */
  private enqueue(buf: AudioBuffer, alone: boolean) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.connect(this.tap!);
    const at = Math.max(ctx.currentTime, this.playEnd);
    this.playEnd = at + buf.duration;
    this.playing.add(src);
    // ponytail: half duplex like Gemini (Web Audio output may escape echo cancellation, and the VAD would hear the examiner): no barge-in.
    src.onended = () => {
      this.playing.delete(src);
      if (this.playing.size) return;
      this.micOn();
      if (alone || !this.streamOpen) this.h.speaking(false);
    };
    src.start(at);
    this.micOn();
  }

  private stopAll() {
    for (const s of this.playing) (s.onended = null), s.stop();
    this.playing.clear();
    this.playEnd = 0;
  }

  private micOn() {
    const track = this.mic?.getAudioTracks()[0];
    if (track) track.enabled = this.hearing && !this.playing.size;
  }

  cue(text: string, heard = false) {
    if (!heard) this.heard = false;
    if (this.playing.size) (this.stopAll(), this.h.speaking(false));
    this.flushSaid();
    this.turns.push({ role: 'app', text });
    void this.reply();
  }

  listen(on: boolean, fresh = false) {
    this.replies = on;
    this.hearing = on || fresh;
    this.micOn();
    if (on) this.answerIfDone();
  }

  close() {
    this.closed = true;
    this.seq++;
    this.stopAll();
    const { ws, pc, dc, mic, ctx } = this;
    this.ws = this.pc = this.dc = this.mic = this.ctx = undefined;
    this.outbox = [];
    mic?.getTracks().forEach((x) => x.stop());
    ws?.close();
    dc?.close();
    pc?.close();
    void ctx?.close().catch(() => {});
  }
}
