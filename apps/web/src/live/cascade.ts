// Fast cascade examiner (admin playground). Two transcribers:
//  - Scribe v2 Realtime: mic → AudioWorklet → local VAD (only the candidate's speech, with a short pre-roll, is sent) → WebSocket, committed by us when
//    they pause (elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime);
//  - OpenAI gpt-4o(-mini)-transcribe: mic → WebRTC Realtime transcription session, server VAD (developers.openai.com/api/docs/guides/realtime-transcription).
// Each finished answer → POST /live/cascade/reply (cheap LLM writes the next line from the duplex plan, TTS voices it inline) → Web Audio playback. The same
// cue convention and handlers as the speech-to-speech engines, so useDuplexExaminer runs the script, timers and stall watchdog unchanged.
import { api } from '@/lib/api';
import type { Duplex, Handlers } from './duplex';
import { WORKLET } from './gemini';
import { fromBase64, IN_RATE, MicEncoder, toBase64 } from './pcm';

export type CascadeLlm = 'deepseek/deepseek-v4.1-flash' | 'inception/mercury-2.5' | 'mistralai/mistral-small-3.2-24b-instruct' | 'openai/gpt-6-luna';
export type CascadeStt = 'scribe_v2_realtime' | 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe';
export type CascadeTts = 'elevenlabs/eleven-v4-turbo' | 'elevenlabs/eleven-flash-v2.5' | 'google/gemini-3.8-flash-lite-tts' | 'google/gemini-3.8-flash-tts';
type Turn = { role: 'examiner' | 'candidate' | 'app'; text: string };
/** One answered turn, ms: end-of-speech wait (VAD silence before the answer counts as finished), transcript after that, then the reply round trip
 *  split into the server's LLM and TTS time and the rest (network, auth, server overhead), then audio decode until the voice starts. */
export type ReplyTiming = { at: number; vad: number; stt: number; llm: number; tts: number; net: number; decode: number; total: number; text: string };
type Line = { text: string; audio: string | null; contentType: string | null; ms: { llm: number; tts: number }; costUsd: number };

const CONNECT_MS = 15_000;
const SCRIBE_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const VOICE_RMS = 0.02; // mic block loudness that counts as speech (echo cancellation and noise suppression are on), as for Gemini
const CHUNK_MS = 40; // MicEncoder chunk length
const PRE_CHUNKS = 8; // 320 ms kept from before the first loud block, so the first word isn't clipped
const END_MS = 1000; // quiet this long ends the answer and commits it (the realtime engines' server VAD waits the same)
const COMMIT_WAIT_MS = 8000;
const VAD_MS = 1000; // both transcribers wait this much silence before the answer counts as finished (Scribe: our END_MS; OpenAI: silence_duration_ms) // a commit whose transcript never comes stops blocking the reply after this

/** Local VAD over mic blocks: speech (with its pre-roll) passes, silence doesn't, so Scribe only hears, and bills, the candidate talking. */
export class SpeechGate {
  private pre: Uint8Array[] = [];
  private on = false;
  private quiet = 0;
  push(loud: boolean, ms: number, chunks: Uint8Array[]): { send: Uint8Array[]; edge?: 'start' | 'end' } {
    if (!this.on && !loud) {
      this.pre.push(...chunks);
      this.pre.splice(0, this.pre.length - PRE_CHUNKS);
      return { send: [] };
    }
    if (!this.on) {
      this.on = true;
      this.quiet = 0;
      return { send: [...this.pre.splice(0), ...chunks], edge: 'start' };
    }
    this.quiet = loud ? 0 : this.quiet + ms;
    if (this.quiet < END_MS) return { send: chunks };
    this.on = false;
    return { send: chunks, edge: 'end' };
  }
}

export class CascadeDuplex implements Duplex {
  private h!: Handlers;
  private sessionId = '';
  private ws?: WebSocket;
  private pc?: RTCPeerConnection; // OpenAI transcription session
  private dc?: RTCDataChannel;
  private ready = false; // session_started on the current socket
  private opening?: Promise<void>;
  private outbox: string[] = []; // messages waiting for a socket (Scribe may close an idle one; the next speech reopens it)
  private mic?: MediaStream;
  private ctx?: AudioContext;
  private tap?: MediaStreamAudioDestinationNode;
  private src?: AudioBufferSourceNode;
  private closed = false;
  private turns: Turn[] = [];
  private said = ''; // candidate speech not yet in `turns`
  private inSpeech = false;
  private commits = 0; // answers committed (Scribe) or ended by the server VAD (OpenAI)
  private transcribed = 0; // of those, transcribed (or given up on)
  private replies = true; // false in the prep minute and the long turn: transcribed, but no reply until the next cue
  private hearing = true;
  private heard = false; // the candidate spoke since the last cue or answer
  private seq = 0; // newest reply request; older answers are dropped
  private sttSeconds = 0; // transcribed audio not yet reported (Scribe: what we sent; OpenAI: what the session reports)
  /** Running totals for the playground: cost (STT + LLM + TTS, from the server) and the last reply's stage timings. */
  readonly stats = { costUsd: 0, replies: 0, last: undefined as { llm: number; tts: number } | undefined, timeline: [] as ReplyTiming[] };
  private speechEndAt?: number; // performance.now() when the VAD ended the latest answer
  private transcriptAt?: number;

  constructor(private llm?: CascadeLlm, private tts?: CascadeTts, private stt: CascadeStt = 'scribe_v2_realtime') {}

  async connect(h: Handlers, sessionId: string) {
    this.h = h;
    this.sessionId = sessionId;
    const ctx = (this.ctx = new AudioContext());
    if (!ctx.audioWorklet) throw new Error("This browser can't capture audio for the cascade examiner.");
    void ctx.resume().catch(() => {});
    this.tap = ctx.createMediaStreamDestination(); // the examiner's voice as a stream: the part recorder pauses while it is audible
    h.output?.(this.tap.stream);
    const mic = (this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
    if (this.closed) {
      mic.getTracks().forEach((x) => x.stop());
      throw new Error('The examiner connection was cancelled.');
    }
    if (this.stt !== 'scribe_v2_realtime') {
      await this.openOpenAi(mic);
      return this.cue('Begin the test.');
    }
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    const enc = new MicEncoder(ctx.sampleRate), gate = new SpeechGate();
    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    node.port.onmessage = (e) => {
      const block = e.data as Float32Array; // a disabled track (examiner speaking, prep minute) is silence, so it never opens the gate
      let sum = 0;
      for (const v of block) sum += v * v;
      const g = gate.push(Math.sqrt(sum / block.length) > VOICE_RMS, (block.length / ctx.sampleRate) * 1000, enc.push(block));
      if (g.edge === 'start') this.speechStart();
      for (const c of g.send) this.send({ message_type: 'input_audio_chunk', audio_base_64: toBase64(c), commit: false, sample_rate: IN_RATE });
      this.sttSeconds += (g.send.length * CHUNK_MS) / 1000;
      if (g.edge === 'end') this.speechEnd();
    };
    ctx.createMediaStreamSource(mic).connect(node);
    node.connect(ctx.destination); // silent output; keeps the capture node running
    await this.open(); // fail before the test starts, not at the first answer
    this.cue('Begin the test.');
  }

  /** OpenAI Realtime transcription session over WebRTC: the mic track goes up, server VAD and transcripts come back on the data channel. */
  private async openOpenAi(mic: MediaStream) {
    const t = await api.post<{ value?: string }>('/live/cascade/stt-token', { sessionId: this.sessionId, stt: this.stt });
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
    else if (ev.type === 'input_audio_buffer.speech_stopped') this.speechEnd(false);
    else if (ev.type === 'conversation.item.input_audio_transcription.completed' || ev.type === 'conversation.item.input_audio_transcription.failed') {
      if (ev.usage?.type === 'duration') this.sttSeconds += ev.usage.seconds ?? 0;
      this.transcript(ev.transcript);
    } else if (ev.type === 'error') console.warn('cascade stt', ev.error?.message);
  }

  /** One Scribe socket at a time, opened with a fresh single-use token; queued messages go out once the session starts. */
  private open(): Promise<void> {
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

  private send(m: object) {
    if (this.closed) return;
    if (this.ready) return this.ws!.send(JSON.stringify(m));
    this.outbox.push(JSON.stringify(m));
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

  /** The candidate paused: one more transcript is owed (Scribe: we commit it; OpenAI: the server VAD already did). */
  private speechEnd(commit = true) {
    this.inSpeech = false;
    this.speechEndAt = performance.now();
    if (commit) this.send({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: IN_RATE });
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

  private async reply() {
    const n = ++this.seq;
    const answered = this.turns.at(-1)?.role === 'candidate' ? { end: this.speechEndAt, heard: this.transcriptAt } : undefined;
    const sentAt = performance.now();
    const secs = this.sttSeconds;
    this.sttSeconds = 0;
    let line: Line;
    try {
      line = await api.post<Line>('/live/cascade/reply', { sessionId: this.sessionId, turns: this.turns.slice(-200), llm: this.llm, tts: this.tts, stt: this.stt, ...(secs && { sttSeconds: secs }) });
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
    if (answered?.end != null && answered.heard != null) {
      const now = performance.now(), round = recvAt - sentAt;
      this.stats.timeline = [...this.stats.timeline, {
        at: Date.now(), vad: VAD_MS, stt: Math.max(0, sentAt - answered.end), llm: line.ms.llm, tts: line.ms.tts,
        net: Math.max(0, round - line.ms.llm - line.ms.tts), decode: now - recvAt, total: VAD_MS + (now - answered.end), text: line.text,
      }].slice(-50);
    }
    this.turns.push({ role: 'examiner', text: line.text });
    if (this.heard) (this.heard = false), this.h.answered();
    // Voice first, then the caption: listeners time the reply from the voice and start a new line on it.
    if (buf) this.play(buf);
    else this.h.speaking(true); // voice failed: the caption stands in
    this.h.caption('');
    this.h.caption(line.text, true);
    if (!buf) this.h.speaking(false);
  }

  private play(buf: AudioBuffer) {
    const ctx = this.ctx!;
    this.stop();
    const src = (this.src = ctx.createBufferSource());
    src.buffer = buf;
    src.connect(ctx.destination);
    src.connect(this.tap!);
    // ponytail: half duplex like Gemini (Web Audio output may escape echo cancellation, and the VAD would hear the examiner): no barge-in.
    src.onended = () => {
      if (this.src !== src) return;
      this.src = undefined;
      this.micOn();
      this.h.speaking(false);
    };
    src.start();
    this.micOn();
    this.h.speaking(true);
  }

  private stop() {
    const s = this.src;
    this.src = undefined;
    if (s) (s.onended = null), s.stop(), this.h.speaking(false);
  }

  private micOn() {
    const track = this.mic?.getAudioTracks()[0];
    if (track) track.enabled = this.hearing && !this.src;
  }

  cue(text: string, heard = false) {
    if (!heard) this.heard = false;
    this.stop();
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
    this.stop();
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
