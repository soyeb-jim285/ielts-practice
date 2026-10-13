// Fast cascade examiner (admin playground): mic → OpenAI Realtime transcription session over WebRTC (server VAD, gpt-4o-mini-transcribe) →
// each finished answer → POST /live/cascade/reply (cheap LLM writes the next line from the duplex plan, TTS voices it inline) → Web Audio playback.
// The same cue convention and handlers as the speech-to-speech engines, so useDuplexExaminer runs the script, timers and stall watchdog unchanged.
import { api } from '@/lib/api';
import type { Duplex, Handlers } from './duplex';
import { fromBase64 } from './pcm';

export type CascadeLlm = 'deepseek/deepseek-v4.1-flash' | 'openai/gpt-6-luna';
export type CascadeTts = 'elevenlabs/eleven-flash-v2.5' | 'google/gemini-3.8-flash-lite-tts' | 'google/gemini-3.8-flash-tts';
type Turn = { role: 'examiner' | 'candidate' | 'app'; text: string };
type Line = { text: string; audio: string | null; contentType: string | null; ms: { llm: number; tts: number }; costUsd: number };

const CONNECT_MS = 15_000;

export class CascadeDuplex implements Duplex {
  private h!: Handlers;
  private sessionId = '';
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private mic?: MediaStream;
  private ctx?: AudioContext;
  private tap?: MediaStreamAudioDestinationNode;
  private src?: AudioBufferSourceNode;
  private closed = false;
  private turns: Turn[] = [];
  private said = ''; // candidate speech not yet in `turns`
  private inSpeech = false;
  private open = 0; // speech turns whose transcript has not arrived
  private replies = true; // false in the prep minute and the long turn: transcribed, but no reply until the next cue
  private hearing = true;
  private heard = false; // the candidate spoke since the last cue or answer
  private seq = 0; // newest reply request; older answers are dropped
  private sttSeconds = 0; // transcribed audio not yet reported
  /** Running totals for the playground: cost (STT + LLM + TTS, from the server) and the last reply's stage timings. */
  readonly stats = { costUsd: 0, replies: 0, last: undefined as { llm: number; tts: number } | undefined };

  constructor(private llm?: CascadeLlm, private tts?: CascadeTts) {}

  async connect(h: Handlers, sessionId: string) {
    this.h = h;
    this.sessionId = sessionId;
    const t = await api.post<{ value: string }>('/live/cascade/stt-token', { sessionId });
    const ctx = (this.ctx = new AudioContext());
    void ctx.resume().catch(() => {});
    this.tap = ctx.createMediaStreamDestination(); // the examiner's voice as a stream: the part recorder pauses while it is audible
    h.output?.(this.tap.stream);
    const mic = (this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
    if (this.closed) {
      mic.getTracks().forEach((x) => x.stop());
      throw new Error('The examiner connection was cancelled.');
    }
    const pc = (this.pc = new RTCPeerConnection());
    pc.addTrack(mic.getAudioTracks()[0]!, mic);
    const dc = (this.dc = pc.createDataChannel('oai-events'));
    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The transcription service did not answer.')), CONNECT_MS);
      dc.onopen = () => (clearTimeout(timer), resolve());
    });
    dc.onmessage = (e) => this.onEvent(JSON.parse(String(e.data)));
    dc.onclose = () => { if (!this.closed) h.lost(); };
    await pc.setLocalDescription(await pc.createOffer());
    const res = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: pc.localDescription!.sdp, headers: { Authorization: `Bearer ${t.value}`, 'Content-Type': 'application/sdp' }, signal: AbortSignal.timeout(CONNECT_MS) });
    if (!res.ok) throw new Error(`Could not connect to OpenAI transcription (${res.status}).`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    await opened;
    this.cue('Begin the test.');
  }

  private onEvent(ev: { type: string; transcript?: string; usage?: { type?: string; seconds?: number }; error?: { message?: string } }) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        this.inSpeech = true;
        this.seq++; // they went on talking: a reply already asked for would cut them off
        this.h.pending?.(true);
        break;
      case 'input_audio_buffer.speech_stopped':
        this.inSpeech = false;
        this.open++;
        this.h.pending?.(false);
        break;
      case 'conversation.item.input_audio_transcription.completed':
      case 'conversation.item.input_audio_transcription.failed':
        this.open = Math.max(0, this.open - 1);
        if (ev.usage?.type === 'duration') this.sttSeconds += ev.usage.seconds ?? 0;
        if (ev.transcript?.trim()) {
          this.said = `${this.said} ${ev.transcript.trim()}`.trim();
          this.heard = true;
          this.h.heard?.(ev.transcript);
        }
        this.h.pending?.(this.inSpeech);
        this.answerIfDone();
        break;
      case 'error':
        console.warn('cascade stt', ev.error?.message);
        break;
    }
  }

  /** The candidate stopped and every piece of their speech is transcribed: ask for the examiner's reply. */
  private answerIfDone() {
    if (!this.replies || this.inSpeech || this.open > 0 || !this.said) return;
    this.flushSaid();
    void this.reply();
  }

  private flushSaid() {
    if (this.said) this.turns.push({ role: 'candidate', text: this.said });
    this.said = '';
  }

  private async reply() {
    const n = ++this.seq;
    const stt = this.sttSeconds;
    this.sttSeconds = 0;
    let line: Line;
    try {
      line = await api.post<Line>('/live/cascade/reply', { sessionId: this.sessionId, turns: this.turns.slice(-200), llm: this.llm, tts: this.tts, ...(stt && { sttSeconds: stt }) });
    } catch (e) {
      this.sttSeconds += stt;
      console.warn('cascade reply failed', e); // the stall watchdog nudges again, and gives up after its limit
      return;
    }
    this.stats.costUsd += line.costUsd;
    if (this.closed || n !== this.seq || !line.text) return;
    const buf = line.audio ? await this.ctx!.decodeAudioData(fromBase64(line.audio).buffer as ArrayBuffer).catch(() => null) : null;
    if (this.closed || n !== this.seq) return;
    this.stats.replies++;
    this.stats.last = line.ms;
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
    const { pc, dc, mic, ctx } = this;
    this.pc = this.dc = this.mic = this.ctx = undefined;
    mic?.getTracks().forEach((x) => x.stop());
    dc?.close();
    pc?.close();
    void ctx?.close().catch(() => {});
  }
}
