import { DEFAULT_LIVEKIT, LIVEKIT_TTS_MODELS, type LiveKitConfig, type LiveKitPartConfig } from '@ielts/core';
import type { RemoteTrack, Room } from 'livekit-client';
import { api } from '@/lib/api';
import type { ReplyTiming, StartupStep } from './cascade';
import type { CueKey, Duplex, Handlers } from './duplex';

export const LIVEKIT_KEY = 'admin-livekit-config';
export function loadLiveKitConfig(): LiveKitConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(LIVEKIT_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_LIVEKIT };
    const normalize = (input: Partial<LiveKitPartConfig>, base: LiveKitPartConfig): LiveKitPartConfig => {
      const c = { ...base };
      for (const key of Object.keys(base) as (keyof LiveKitPartConfig)[]) {
        const v = input[key];
        if (typeof v === typeof base[key] && (typeof v !== 'number' || Number.isFinite(v))) Object.assign(c, { [key]: v });
      }
      if (!['soniox', 'elevenlabs'].includes(c.stt)) c.stt = base.stt;
      c.sttModel = c.stt === 'soniox' ? 'stt-rt-v5' : 'scribe_v2_realtime';
      if (!Object.hasOwn(LIVEKIT_TTS_MODELS, c.tts)) c.tts = base.tts;
      if (!(LIVEKIT_TTS_MODELS[c.tts] as readonly string[]).includes(c.ttsModel)) c.ttsModel = LIVEKIT_TTS_MODELS[c.tts][0];
      if (!['openai/gpt-6-luna', 'deepseek/deepseek-v4.1-flash'].includes(c.llm)) c.llm = base.llm;
      if (!['audio', 'vad'].includes(c.turnDetection)) c.turnDetection = base.turnDetection;
      return c;
    };
    const base = normalize(raw, DEFAULT_LIVEKIT), parts: LiveKitConfig['parts'] = {};
    for (const part of ['1', '2', '3'] as const) if (raw.parts?.[part] && typeof raw.parts[part] === 'object') parts[part] = normalize(raw.parts[part], base);
    return Object.keys(parts).length ? { ...base, parts } : base;
  } catch { return { ...DEFAULT_LIVEKIT }; }
}

/** Speaking is the worker's state, not a measurement of browser audio playout. */
export class LiveKitDuplex implements Duplex {
  readonly stats = { steps: [] as StartupStep[], costUsd: 0, timeline: [] as ReplyTiming[], metrics: undefined as unknown };
  private room?: Room;
  private h?: Handlers;
  private closed = false;
  private failure?: Error;
  private tracks = new Set<RemoteTrack>();
  private audio = new Set<HTMLMediaElement>();
  private commands: Promise<void> = Promise.resolve();
  private rejectReady?: (error: Error) => void;
  private answeredAt?: number;
  private heard = '';
  private part: 1 | 2 | 3 = 1;
  constructor(private cfg: LiveKitConfig) {}

  private async step<T>(key: string, label: string, run: () => Promise<T>) {
    const s: StartupStep = { key, label, state: 'running' }, at = performance.now();
    this.stats.steps.push(s);
    try { const value = await run(); if (this.closed) { for (const p of this.room?.localParticipant.trackPublications.values() ?? []) p.track?.stop(); void this.room?.disconnect().catch(() => {}); throw this.failure ?? new Error('LiveKit connection cancelled.'); } s.state = 'done'; return value; }
    catch (e) { s.state = 'failed'; s.detail = (e as Error).message; throw e; }
    finally { s.ms = performance.now() - at; }
  }

  async connect(h: Handlers, sessionId: string) {
    this.h = h;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { Room, RoomEvent, ParticipantKind } = await this.step('load', 'Load LiveKit client', () => import('livekit-client'));
      const result = await this.step('token', 'Start LiveKit worker via our API', () => api.post<{ url: string; token: string; roomName: string; participantIdentity: string }>('/api/live/livekit/start', { sessionId, cfg: this.cfg }));
      const room = this.room = new Room();
      let resolveReady!: () => void;
      const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; this.rejectReady = reject; });
      // Attach before connecting: the worker may announce readiness during connect or publishData.
      void ready.catch(() => {});
      room.on(RoomEvent.DataReceived, (data, participant, _kind, topic) => {
        if (this.closed || topic !== 'ielts.events' || participant?.kind !== ParticipantKind.AGENT) return;
        let e: Record<string, unknown>;
        try { e = JSON.parse(new TextDecoder().decode(data)); if (!e || typeof e !== 'object') return; } catch { return; }
        switch (e.type) {
          case 'ready': resolveReady(); break;
          case 'caption': if (typeof e.text === 'string') { h.caption('', false); h.caption(e.text, true); } break;
          case 'heard': if (typeof e.text === 'string') { this.heard = e.text; h.heard?.(e.text); } break;
          case 'pending': if (typeof e.on === 'boolean') h.pending?.(e.on); break;
          case 'answered': this.answeredAt = performance.now(); h.answered(); break;
          case 'speaking':
            if (typeof e.on !== 'boolean') break;
            if (e.on && this.answeredAt !== undefined) {
              const total = Math.max(0, performance.now() - this.answeredAt);
              this.stats.timeline.push({ at: Date.now(), wait: 0, turnModel: 0, stt: 0, llm: 0, tts: 0, net: total, decode: 0, total, text: this.heard, checks: [], label: 'LiveKit server event latency (answered to speaking; not browser first audio)' });
              this.answeredAt = undefined;
            }
            h.speaking(e.on); break;
          case 'cost': if (typeof e.usd === 'number' && Number.isFinite(e.usd) && e.usd >= 0) this.stats.costUsd = e.usd; break;
          case 'metrics': this.stats.metrics = e; break;
          case 'error': {
            const error = new Error(typeof e.message === 'string' ? e.message : 'LiveKit worker failed.');
            this.failure = error;
            this.rejectReady?.(error); this.close(); h.lost(); break;
          }
        }
      });
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (this.closed || participant.kind !== ParticipantKind.AGENT || track.kind !== 'audio') return;
        this.tracks.add(track);
        const audio = track.attach(); this.audio.add(audio);
        audio.autoplay = true;
        h.output?.(new MediaStream([track.mediaStreamTrack]));
        // iOS Safari can refuse play() outside a tap: retry on the next tap instead of dropping the session.
        void audio.play().catch(() => this.playOnTap());
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((a) => { a.pause(); a.srcObject = null; a.remove(); this.audio.delete(a); }); this.tracks.delete(track); });
      room.on(RoomEvent.Disconnected, () => { if (!this.closed) { this.rejectReady?.(new Error('LiveKit disconnected.')); this.close(); h.lost(); } });
      await this.step('connect', 'Connect to LiveKit room', () => room.connect(result.url, result.token));
      // Mic first: with capture active, iOS Safari allows the examiner's audio to play. The tap's gesture has expired by
      // now, so startAudio() may be refused there; that is not fatal (playOnTap unlocks it on the next tap).
      await this.step('mic', 'Publish microphone', () => room.localParticipant.setMicrophoneEnabled(true));
      await this.step('audio', 'Enable browser audio playback', () => room.startAudio().catch(() => this.playOnTap()));
      await this.step('ready', 'Start examiner and await worker ready', async () => {
        timer = setTimeout(() => this.rejectReady?.(new Error('LiveKit examiner readiness timed out.')), 30_000);
        await ready;
        await this.send({ type: 'start' });
      });
      this.rejectReady = undefined;
    } catch (e) { this.close(); throw e; }
    finally { clearTimeout(timer); }
  }

  private send(message: object): Promise<void> {
    this.commands = this.commands.then(async () => {
      if (this.closed || !this.room) throw new Error('LiveKit connection closed.');
      await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: 'ielts.control' });
    });
    void this.commands.catch((e) => { this.rejectReady?.(e); if (!this.closed) { this.close(); this.h?.lost(); } });
    return this.commands;
  }
  configurePart(part: 1 | 2 | 3) {
    if (part === this.part) return this.commands;
    this.part = part;
    return this.send({ type: 'configure', part });
  }
  cue(text: string, _heard?: boolean, key?: CueKey) { void this.send({ type: 'cue', text, key }); }
  listen(on: boolean, fresh = false) { void this.send({ type: 'listen', on, fresh }); }
  private tapArmed = false;
  /** Playback the browser refused (no user gesture): unlock it on the next tap anywhere on the page. */
  private playOnTap() {
    if (this.closed || this.tapArmed) return;
    this.tapArmed = true;
    document.addEventListener('pointerdown', () => {
      this.tapArmed = false;
      if (this.closed) return;
      void this.room?.startAudio().catch(() => {});
      for (const a of this.audio) void a.play().catch(() => this.playOnTap());
    }, { once: true });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.rejectReady?.(new Error('LiveKit connection closed.'));
    for (const p of this.room?.localParticipant.trackPublications.values() ?? []) p.track?.stop();
    for (const track of this.tracks) track.detach();
    for (const audio of this.audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
    this.audio.clear(); this.tracks.clear();
    void this.room?.disconnect().catch(() => {});
  }
}
