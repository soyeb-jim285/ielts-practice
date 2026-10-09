// OpenAI Realtime (gpt-realtime family) over WebRTC with a short-lived client secret from our server (the secret locks model, voice, instructions, VAD and
// input transcription). Same script convention as Gemini Live: cues are "[APP CUE]" user messages followed by response.create.
// Docs: platform.openai.com/docs/guides/realtime-webrtc, realtime-conversations; events: platform.openai.com/docs/api-reference/realtime-server-events.
import { api } from '@/lib/api';
import type { Duplex, Handlers } from './duplex';
import { withDeadline } from './deadline';
import { CUE_PREFIX } from './geminiProtocol';

export type RealtimeModel = 'gpt-realtime-mini' | 'gpt-realtime';
export type RealtimeUsage = { textIn: number; audioIn: number; cachedIn: number; textOut: number; audioOut: number; transcribeSeconds: number };
export const emptyRealtimeUsage = (): RealtimeUsage => ({ textIn: 0, audioIn: 0, cachedIn: 0, textOut: 0, audioOut: 0, transcribeSeconds: 0 });

type Details = { text_tokens?: number; audio_tokens?: number; cached_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } };
/** Adds one response.done usage to `t`, in place. Cached tokens are part of the text/audio counts, so they are moved out of them. */
export function addRealtimeUsage(t: RealtimeUsage, u?: { input_token_details?: Details; output_token_details?: Details }) {
  const i = u?.input_token_details, o = u?.output_token_details, n = (x?: number) => Math.max(0, x ?? 0);
  if (i) {
    const cText = n(i.cached_tokens_details?.text_tokens), cAudio = n(i.cached_tokens_details?.audio_tokens);
    t.textIn += Math.max(0, n(i.text_tokens) - cText);
    t.audioIn += Math.max(0, n(i.audio_tokens) - cAudio);
    t.cachedIn += i.cached_tokens_details ? cText + cAudio : n(i.cached_tokens);
  }
  if (o) (t.textOut += n(o.text_tokens)), (t.audioOut += n(o.audio_tokens));
  return t;
}

const CONNECT_MS = 15_000;

export class RealtimeDuplex implements Duplex {
  private h!: Handlers;
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private mic?: MediaStream;
  private audio = Object.assign(new Audio(), { autoplay: true });
  private sessionId = '';
  private closed = false;
  private fresh = true; // the next examiner words start a new turn
  private heard = false; // the candidate spoke since the last cue or answer
  private speaking = false;
  private replies = true; // false during the long turn: heard, but the VAD must not trigger a reply
  /** Token totals so far (summed response.done usage) and the candidate audio transcribed. */
  readonly usage = emptyRealtimeUsage();

  constructor(private model: RealtimeModel) {}

  private send(ev: object) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(ev));
  }

  async connect(h: Handlers, sessionId: string) {
    this.h = h;
    this.sessionId = sessionId;
    const t = await api.post<{ value: string }>('/live/realtime-token', { sessionId, model: this.model });
    const pc = (this.pc = new RTCPeerConnection());
    pc.ontrack = (e) => {
      this.audio.srcObject = e.streams[0] ?? null;
      if (e.streams[0]) h.output?.(e.streams[0]);
    };
    const mic = (this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
    if (this.closed) {
      mic.getTracks().forEach((x) => x.stop());
      throw new Error('The examiner connection was cancelled.');
    }
    pc.addTrack(mic.getAudioTracks()[0]!, mic);
    const dc = (this.dc = pc.createDataChannel('oai-events'));
    const open = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The OpenAI Realtime examiner did not answer.')), CONNECT_MS);
      dc.onopen = () => (clearTimeout(timer), resolve());
    });
    dc.onmessage = (e) => this.onEvent(JSON.parse(String(e.data)));
    dc.onclose = () => { if (!this.closed) h.lost(); };
    await pc.setLocalDescription(await pc.createOffer());
    const res = await withDeadline(fetch(`https://api.openai.com/v1/realtime/calls?model=${this.model}`, { method: 'POST', body: pc.localDescription!.sdp, headers: { Authorization: `Bearer ${t.value}`, 'Content-Type': 'application/sdp' } }));
    if (!res.ok) throw new Error(`Could not connect to OpenAI Realtime (${res.status}).`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    await open;
    this.say('Begin the test.');
  }

  private onEvent(ev: { type: string; delta?: string; transcript?: string; usage?: { seconds?: number; type?: string }; response?: { usage?: Parameters<typeof addRealtimeUsage>[1] }; error?: { message?: string } }) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        this.h.pending?.();
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript) this.h.heard?.(ev.transcript);
        if (ev.usage?.type === 'duration') this.usage.transcribeSeconds += ev.usage.seconds ?? 0;
        this.heard = true;
        this.h.pending?.();
        break;
      case 'response.output_audio_transcript.delta':
        if (this.fresh) {
          this.fresh = false;
          this.h.caption('');
          if (this.heard) (this.heard = false), this.h.answered();
        }
        if (ev.delta) this.h.caption(ev.delta, true);
        break;
      case 'output_audio_buffer.started':
        this.speak(true);
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.fresh = true;
        this.speak(false);
        break;
      case 'response.done':
        addRealtimeUsage(this.usage, ev.response?.usage);
        break;
      case 'error':
        console.warn('openai realtime', ev.error?.message);
        break;
    }
  }

  private speak(on: boolean) {
    if (this.speaking === on) return;
    this.speaking = on;
    this.h.speaking(on);
  }

  /** An instruction from the app: interrupt the examiner, add it as a cue message and ask for the reply now. */
  private say(text: string) {
    this.send({ type: 'response.cancel' });
    this.send({ type: 'output_audio_buffer.clear' });
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: CUE_PREFIX + text }] } });
    this.send({ type: 'response.create' });
  }

  cue(text: string) {
    this.heard = false;
    this.fresh = true;
    this.speak(false);
    this.say(text);
  }

  /** Off for the preparation minute (the mic is muted); off with `fresh` for the long turn (heard, but no automatic reply until the next cue). */
  listen(on: boolean, fresh = false) {
    const track = this.mic?.getAudioTracks()[0];
    if (track) track.enabled = on || fresh;
    const replies = on;
    if (replies === this.replies) return;
    this.replies = replies;
    this.send({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: { type: 'server_vad', silence_duration_ms: 1000, prefix_padding_ms: 300, create_response: replies, interrupt_response: replies } } } } });
  }

  close() {
    if (!this.closed && this.sessionId && Object.values(this.usage).some(Boolean))
      void fetch('/api/live/realtime-usage', { method: 'POST', credentials: 'include', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: this.sessionId, model: this.model, usage: this.usage }) }).catch(() => {});
    this.closed = true;
    const { pc, dc, mic } = this;
    this.pc = this.dc = this.mic = undefined;
    this.audio.pause();
    mic?.getTracks().forEach((x) => x.stop());
    dc?.close();
    pc?.close();
  }
}
