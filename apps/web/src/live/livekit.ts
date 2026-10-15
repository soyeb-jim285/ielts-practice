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

const VOICE_RMS = 0.02; // the cascade's speech loudness, for "your last sound" on this device
const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v * 1000 : 0);

/** The label used for this engine in the playground (run header, past sessions, timeline). */
export const liveKitLabel = (c: LiveKitConfig) =>
  ['LiveKit', c.sttModel, c.turnDetection === 'audio' ? `v1-mini ${c.minEndpointDelay}–${c.maxEndpointDelay} s` : `VAD ${c.vadSilence} s`, c.llm.replace(/^.*\//, ''), c.ttsModel, c.voice, c.parts && Object.keys(c.parts).length ? 'part overrides' : '']
    .filter(Boolean).join(' · ');

/** Speaking is the worker's state (its audio starts going out), as Pipecat's bot-started-speaking. */
export class LiveKitDuplex implements Duplex {
  readonly stats = { steps: [] as StartupStep[], costUsd: 0, timeline: [] as ReplyTiming[], lastEot: undefined as number | undefined };
  private room?: Room;
  private h?: Handlers;
  private closed = false;
  private failure?: Error;
  private tracks = new Set<RemoteTrack>();
  private audio = new Set<HTMLMediaElement>();
  private commands: Promise<void> = Promise.resolve();
  private rejectReady?: (error: Error) => void;
  private heard = '';
  private ctx?: AudioContext;
  private poll?: ReturnType<typeof setInterval>;
  private lastVoice = 0; // performance.now() of the candidate's last loud mic block
  private answer?: { at: number; voiceAt: number; eot: number; stt: number }; // the finished answer awaiting the examiner's voice
  private reply?: ReplyTiming; // the latest reply, until the worker reports its LLM/TTS timings
  /** Last sound → examiner voice of the latest reply, read once by the playground for the conversation line. */
  replyMs?: number;
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
          case 'caption':
            if (typeof e.text !== 'string' || !e.text) break;
            if (!e.append) h.caption('', false); // a new examiner line
            h.caption(e.append ? ` ${e.text}` : e.text, true);
            break;
          case 'heard': if (typeof e.text === 'string') { this.heard = e.text; h.heard?.(e.text); } break;
          case 'pending': if (typeof e.on === 'boolean') h.pending?.(e.on); break;
          case 'answered':
            this.answer = { at: performance.now(), voiceAt: this.lastVoice, eot: ms(e.eot), stt: ms(e.stt) };
            this.stats.lastEot = this.answer.eot || undefined;
            h.answered(); break;
          case 'speaking':
            if (typeof e.on !== 'boolean') break;
            if (e.on && this.answer) this.record();
            h.speaking(e.on); break;
          case 'turn': {
            const t = this.reply;
            if (!t) break;
            t.llm = ms(e.llm); t.tts = ms(e.tts);
            t.net = Math.max(0, t.total - t.wait - t.stt - t.llm - t.tts);
            this.reply = undefined;
            break;
          }
          case 'cost': if (typeof e.usd === 'number' && Number.isFinite(e.usd) && e.usd >= 0) this.stats.costUsd = e.usd; break;
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
      await this.step('mic', 'Publish microphone', async () => {
        const pub = await room.localParticipant.setMicrophoneEnabled(true);
        if (pub?.track?.mediaStreamTrack) this.watchMic(pub.track.mediaStreamTrack);
      });
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
  /** "Your last sound" for the reply timeline, from the published mic track (no second capture). */
  private watchMic(track: MediaStreamTrack) {
    try {
      const ctx = (this.ctx = new AudioContext()), an = ctx.createAnalyser(), buf = new Float32Array(512);
      an.fftSize = 512;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
      this.poll = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += v * v;
        if (Math.sqrt(s / buf.length) > VOICE_RMS) this.lastVoice = performance.now();
      }, 20);
    } catch {} // timing only: never fail the session over it
  }

  /** One answered turn: last sound → turn ended (worker: end of turn, transcript) → LLM → voice. LLM/TTS arrive with the worker's 'turn' event. */
  private record() {
    const a = this.answer!;
    this.answer = undefined;
    const now = performance.now(), last = a.voiceAt && a.voiceAt <= a.at ? a.voiceAt : a.at - a.eot;
    const total = Math.max(0, now - last), stt = a.stt, wait = Math.max(0, a.eot - a.stt);
    const t: ReplyTiming = { at: Date.now(), wait, turnModel: 0, stt, llm: 0, tts: 0, net: Math.max(0, total - wait - stt), decode: 0, total, text: this.heard, checks: [], label: liveKitLabel(this.cfg) };
    this.stats.timeline.push(t);
    this.reply = t;
    this.replyMs = total;
  }

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
    clearInterval(this.poll);
    void this.ctx?.close().catch(() => {});
    this.rejectReady?.(new Error('LiveKit connection closed.'));
    for (const p of this.room?.localParticipant.trackPublications.values() ?? []) p.track?.stop();
    for (const track of this.tracks) track.detach();
    for (const audio of this.audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
    this.audio.clear(); this.tracks.clear();
    void this.room?.disconnect().catch(() => {});
  }
}
