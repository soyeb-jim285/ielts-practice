// OpenAI GPT-Live (gpt-live-1) over WebRTC. The browser's SDP offer goes to OUR server, which creates the session with the API key and returns the answer
// (there are no client secrets for Live). Script control and transcripts run through the server's sideband; the data channel carries captions and mute.
// Docs: developers.openai.com/api/docs/guides/voice-webrtc?api=live, live-conversations.
import { api } from '@/lib/api';
import { useDuplexExaminer, type CueKey, type Duplex, type Handlers } from './duplex';
import { appendEvent, closeEvent, muteEvent, parseLiveEvent, type LiveEvent } from './gptLiveProtocol';
import type { LiveExaminer, LiveSource } from './turn';

const CONNECT_MS = 15_000;
const IDLE_MS = 2500; // no caption delta for this long: the examiner has finished speaking (there is no response.done in GPT-Live)
const FALLBACK_HINT = 'Try again, or switch to the turn-based examiner in Settings.';

export class GptLiveDuplex implements Duplex {
  private h!: Handlers;
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private mic?: MediaStream;
  private audio = Object.assign(new Audio(), { autoplay: true });
  private sessionId = '';
  private fresh = true; // the next examiner words start a new turn
  private heard = false; // the candidate spoke since the last cue or answer
  private speaking = false;
  private closed = false;
  private idle?: ReturnType<typeof setTimeout>;
  private chain: Promise<void> = Promise.resolve(); // cues reach the server in order
  private onStarted?: () => void;

  private send(ev: object) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(ev));
  }

  async connect(h: Handlers, sessionId: string) {
    this.h = h;
    this.sessionId = sessionId;
    const pc = (this.pc = new RTCPeerConnection());
    pc.ontrack = (e) => (this.audio.srcObject = e.streams[0] ?? null);
    const mic = (this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
    pc.addTrack(mic.getAudioTracks()[0]!, mic);
    const dc = (this.dc = pc.createDataChannel('oai-events')); // before the offer
    dc.onmessage = (e) => {
      const ev = parseLiveEvent(String(e.data));
      if (ev) this.onEvent(ev);
    };

    let opened = false;
    const ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`The GPT-Live examiner did not answer. ${FALLBACK_HINT}`)), CONNECT_MS);
      this.onStarted = () => ((opened = true), clearTimeout(t), resolve());
      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== 'failed') return;
        clearTimeout(t);
        if (opened) {
          if (!this.closed) h.lost();
        } else reject(new Error(`Could not connect to the GPT-Live examiner. ${FALLBACK_HINT}`));
      };
    });
    ready.catch(() => {}); // surfaced by the await below

    await pc.setLocalDescription(await pc.createOffer());
    await iceComplete(pc);
    const answer = await api.post<{ sdp: string }>('/live/gpt-live/session', { sessionId, sdp: pc.localDescription!.sdp }).catch(() => {
      throw new Error(`Could not connect to the GPT-Live examiner. ${FALLBACK_HINT}`);
    });
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    await ready; // session.started: do not send anything before it
    this.queueCue('begin');
  }

  private onEvent(ev: LiveEvent) {
    switch (ev.type) {
      case 'started':
        this.onStarted?.();
        break;
      case 'inText':
        this.heard = true;
        break;
      case 'outText':
        if (this.fresh) {
          this.fresh = false;
          this.h.caption('');
          if (this.heard) {
            this.heard = false;
            this.h.answered();
          }
        }
        this.h.caption(ev.text, true);
        this.speak(true);
        clearTimeout(this.idle);
        this.idle = setTimeout(() => (this.speak(false), (this.fresh = true)), IDLE_MS);
        break;
      case 'closed':
        if (!this.closed) this.h.lost();
        break;
      case 'error':
        console.warn('gpt-live', ev.message);
        break;
    }
  }

  private speak(on: boolean) {
    if (this.speaking === on) return;
    this.speaking = on;
    this.h.speaking(on);
  }

  /** The server appends the instruction through its sideband; if it can't, it hands the text back and we append it on the data channel. */
  private queueCue(key: CueKey | 'begin') {
    this.chain = this.chain.then(async () => {
      try {
        const r = await api.post<{ sent: boolean; content: string }>('/live/gpt-live/cue', { sessionId: this.sessionId, cue: key });
        if (!r.sent) this.send(appendEvent(r.content));
      } catch (e) {
        console.warn('gpt-live cue failed', key, e);
      }
    });
  }

  cue(_text: string, _heard = false, key?: CueKey) {
    clearTimeout(this.idle);
    this.heard = false;
    this.fresh = true;
    this.speak(false);
    if (key) this.queueCue(key);
  }

  listen(on: boolean, fresh = false) {
    // Mute only for the preparation minute. The long turn is heard (the rounding-off question follows from it) and the examiner is told to stay silent.
    this.send(muteEvent(!on && !fresh));
  }

  close() {
    this.closed = true;
    clearTimeout(this.idle);
    this.send(closeEvent());
    const { pc, dc, mic } = this;
    this.pc = this.dc = this.mic = undefined;
    this.audio.pause();
    mic?.getTracks().forEach((t) => t.stop());
    setTimeout(() => (dc?.close(), pc?.close()), 500); // let session.close go out
  }
}

/** Waits (at most 2 s) for ICE gathering so the offer carries its candidates. */
function iceComplete(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => (pc.removeEventListener('icegatheringstatechange', check), clearTimeout(t), resolve());
    const check = () => pc.iceGatheringState === 'complete' && done();
    const t = setTimeout(done, 2000);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export function useGptLiveExaminer(onFinished: (sessionId: string, attemptIds: string[]) => void, onUnavailable?: (reason: string) => void, source?: LiveSource): LiveExaminer {
  return useDuplexExaminer(() => new GptLiveDuplex(), onFinished, onUnavailable, source);
}
