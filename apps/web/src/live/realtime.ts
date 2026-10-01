// OpenAI Realtime over WebRTC (GA interface): an ephemeral client secret from our server, SDP offer to /v1/realtime/calls, events on the "oai-events" data channel.
// Docs: developers.openai.com/api/docs/guides/realtime-webrtc, realtime-conversations, realtime-vad.
import { api } from '@/lib/api';
import { useDuplexExaminer, type Duplex, type Handlers } from './duplex';
import type { LiveExaminer } from './turn';

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
// Low eagerness so the examiner waits for the candidate to finish rather than jumping into pauses.
const TURN_DETECTION = { type: 'semantic_vad', eagerness: 'low' } as const;
const CONNECT_MS = 15_000;

type ServerEvent = { type: string; delta?: string; error?: { message?: string } };

/** Server event → what the state machine needs. Pure apart from `h`. */
export function onRealtimeEvent(ev: ServerEvent, h: Handlers) {
  switch (ev.type) {
    case 'response.created':
      h.caption('');
      break;
    case 'response.output_audio_transcript.delta':
      h.caption(ev.delta ?? '', true);
      break;
    case 'output_audio_buffer.started':
      h.speaking(true);
      break;
    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      h.speaking(false);
      break;
    case 'input_audio_buffer.speech_stopped':
      h.answered();
      break;
    case 'error':
      // Cancelling or clearing when nothing is playing is expected; everything else is logged, the session carries on.
      if (!/no active response|cancel|nothing to clear|empty/i.test(ev.error?.message ?? '')) console.warn('realtime', ev.error?.message);
      break;
  }
}

export class OpenAiDuplex implements Duplex {
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private mic?: MediaStream;
  private audio = Object.assign(new Audio(), { autoplay: true });

  private send(ev: object) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(ev));
  }

  async connect(h: Handlers, sessionId: string) {
    const token = await api.post<{ value: string }>('/live/realtime-token', { sessionId });
    const pc = (this.pc = new RTCPeerConnection());
    pc.ontrack = (e) => (this.audio.srcObject = e.streams[0] ?? null);
    const mic = (this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
    pc.addTrack(mic.getAudioTracks()[0]!, mic);
    const dc = (this.dc = pc.createDataChannel('oai-events'));
    dc.onmessage = (e) => onRealtimeEvent(JSON.parse(e.data as string) as ServerEvent, h);

    let opened = false;
    const ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The realtime examiner did not answer. Try again, or switch to the turn-based examiner in Settings.')), CONNECT_MS);
      dc.onopen = () => (opened = true, clearTimeout(t), resolve());
      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== 'failed') return;
        clearTimeout(t);
        if (opened) h.lost();
        else reject(new Error('Could not connect to the realtime examiner. Try again, or switch to the turn-based examiner in Settings.'));
      };
    });
    ready.catch(() => {}); // surfaced by the await below; this keeps an early rejection from being "unhandled"

    await pc.setLocalDescription(await pc.createOffer());
    const res = await fetch(CALLS_URL, {
      method: 'POST',
      body: pc.localDescription!.sdp,
      headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/sdp' },
    });
    if (!res.ok) throw new Error('Could not connect to the realtime examiner. Try again, or switch to the turn-based examiner in Settings.');
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    await ready;
    this.listen(true);
    this.send({ type: 'response.create' }); // the examiner opens with the introduction
  }

  cue(text: string, heard = false) {
    if (heard) this.send({ type: 'input_audio_buffer.commit' }); // the long turn becomes one user message the examiner can answer
    this.send({ type: 'response.cancel' });
    this.send({ type: 'output_audio_buffer.clear' }); // WebRTC: drop what is still buffered, a real examiner cuts in too
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
    this.send({ type: 'response.create' });
  }

  listen(on: boolean, fresh = false) {
    this.send({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: on ? TURN_DETECTION : null } } } });
    if (fresh) this.send({ type: 'input_audio_buffer.clear' }); // WebRTC keeps buffering with VAD off: start the long turn from an empty buffer
  }

  close() {
    this.dc?.close();
    this.pc?.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.audio.pause();
    this.pc = this.dc = this.mic = undefined;
  }
}

export function useRealtimeExaminer(onFinished: (sessionId: string, attemptIds: string[]) => void, onUnavailable?: (reason: string) => void): LiveExaminer {
  return useDuplexExaminer(() => new OpenAiDuplex(), onFinished, onUnavailable);
}
