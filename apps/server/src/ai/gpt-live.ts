// GPT-Live (OpenAI, gpt-live-1): full-duplex speech-to-speech. Our server creates every session with the API key (there are no client secrets for Live),
// and keeps a WebSocket to the session ("sideband" for browser WebRTC sessions, the main connection for native clients) so it owns the transcript.
// Docs: developers.openai.com/api/docs/guides/live, live-conversations, live-delegation, live-prompting, voice-webrtc?api=live.
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { liveSessions } from '../db/schema';
import { env } from '../env';
import { gptLiveUsd, recordCost } from './cost';
import type { SpeakingTest } from '../routes/prompts';
import { candidateFacts, CUE_PHASE, GPT_LIVE_CUES, gptLiveCue, gptLiveInstructions, type GptLiveCue, type LiveState, type Phase, type Turn } from './examiner';

export const LIVE_HTTP = 'https://api.openai.com/v1/live/sessions';
export const LIVE_WS = 'wss://api.openai.com/v1/live/sessions';
export const MAX_RUN_MS = 20 * 60_000; // a test is ~14 min; this is the hard stop for one session
export const PCM_RATE = 24_000; // pcm16 mono little-endian, the same format for input and output

type Json = Record<string, unknown>;

/** The session config the server owns. No `delegation` field: GPT-Live then never delegates (live-delegation guide). */
export function sessionConfig(transport: 'webrtc' | 'websocket'): Json {
  const audio: Json = { output: { voice: env.OPENAI_LIVE_VOICE } };
  if (transport === 'websocket') audio.format = { type: 'audio/pcm', rate: PCM_RATE };
  return { model: env.OPENAI_LIVE_MODEL, instructions: gptLiveInstructions(), audio };
}

/** POST /v1/live/sessions body for a browser WebRTC session. */
export const webrtcBody = (sdp: string) => ({ session: sessionConfig('webrtc'), transport: { type: 'webrtc', sdp } });

/** First message on the upstream WebSocket. */
export const sessionStart = () => ({ type: 'session.start', session: sessionConfig('websocket') });

const safetyId = (userId: string) => createHash('sha256').update(userId).digest('hex');
const auth = (userId: string, apiKey: string) => ({ Authorization: `Bearer ${apiKey}`, 'OpenAI-Safety-Identifier': safetyId(userId) });

/** Creates the WebRTC session from the browser's SDP offer: returns the answer SDP and OpenAI's session id. */
export async function createWebrtcSession(sdp: string, userId: string, apiKey: string): Promise<{ sdp: string; id: string } | { status: number; detail: string }> {
  const res = await fetch(LIVE_HTTP, {
    method: 'POST',
    headers: { ...auth(userId, apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(webrtcBody(sdp)),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res || res.status !== 201) return { status: res?.status ?? 0, detail: (await res?.text().catch(() => ''))?.slice(0, 500) ?? '' };
  const d = (await res.json()) as { session?: { id?: string }; transport?: { sdp?: string } };
  if (!d.session?.id || !d.transport?.sdp) return { status: 502, detail: 'malformed live session response' };
  return { sdp: d.transport.sdp, id: d.session.id };
}

/** The upstream WebSocket factory (tests swap it for a fake). */
export type Upstream = { send(d: string): void; close(): void; terminate(): void; on(ev: string, fn: (...a: any[]) => void): unknown; readyState: number };
let connect: (url: string, userId: string, apiKey: string) => Upstream = (url, userId, apiKey) => new WebSocket(url, { headers: auth(userId, apiKey) });
export const setUpstream = (f: typeof connect) => void (connect = f);

// ---- client messages (native relay)

/** What a native client may send through the relay. Everything else is dropped: the client never chooses model, instructions or tools. */
const CLIENT_TYPES = new Set(['session.input_audio.append', 'session.input_audio.mute', 'session.input_audio.unmute', 'session.close', 'app.cue']);
const MAX_CLIENT_BYTES = 64 * 1024; // ~1 s of 24 kHz pcm16 is 64 KB in base64: clients send 20-100 ms chunks

/** Parses one client message; returns the event to send upstream (null: drop), or a cue request. */
export function clientMessage(raw: string): { upstream: Json } | { cue: GptLiveCue } | null {
  if (raw.length > MAX_CLIENT_BYTES) return null;
  let m: Json;
  try {
    m = JSON.parse(raw) as Json;
  } catch {
    return null;
  }
  if (typeof m.type !== 'string' || !CLIENT_TYPES.has(m.type)) return null;
  if (m.type === 'app.cue') return isCue(m.cue) ? { cue: m.cue } : null;
  if (m.type === 'session.input_audio.append') return typeof m.audio === 'string' ? { upstream: { type: m.type, audio: m.audio } } : null;
  return { upstream: { type: m.type } };
}
export const isCue = (v: unknown): v is GptLiveCue => typeof v === 'string' && (GPT_LIVE_CUES as readonly string[]).includes(v);

/** session.instructions.append for one script moment (content is limited to 500 tokens; the cue texts stay well below). */
export const cueEvent = (cue: GptLiveCue, t: SpeakingTest, facts = '') => ({ type: 'session.instructions.append', event_id: `cue-${cue}`, delegation_id: null, content: gptLiveCue(cue, t, facts) });

/** A server event as the native client sees it: the instructions are ours, not theirs, and output audio always has its base64 in `audio` (also kept in `delta`). */
export function scrub(raw: string): string {
  try {
    const m = JSON.parse(raw) as { type?: string; audio?: string; delta?: string; session?: Json };
    let changed = false;
    if (m.session && 'instructions' in m.session) (delete m.session.instructions, (changed = true));
    if (m.type === 'session.output_audio.delta' && m.audio === undefined && typeof m.delta === 'string') (m.audio = m.delta, (changed = true));
    if (changed) return JSON.stringify(m);
  } catch {}
  return raw;
}

// ---- transcript

/** Turns from caption deltas (appended verbatim). A cue starts its phase; the examiner's first words after the candidate's answer move intro → p1 and p2-follow → p3. */
export class Transcript {
  turns: Turn[] = [];
  phase: Phase = 'intro';
  private t0 = new Map<Turn, number>();
  constructor(private now: () => number = Date.now) {}

  private last?: Turn;

  setPhase(p: Phase) {
    this.phase = p;
    this.last = undefined; // the next words open a new turn in the new phase
  }

  /** Feeds one server event; returns true if it was a caption delta. */
  feed(ev: { type?: string; delta?: string; start_ms?: number; end_ms?: number }): boolean {
    const role = ev.type === 'session.input_transcript.delta' ? 'candidate' : ev.type === 'session.output_transcript.delta' ? 'examiner' : null;
    if (!role || typeof ev.delta !== 'string') return false;
    let t = this.last;
    if (!t || t.role !== role) {
      const prev = this.turns.at(-1);
      if (role === 'examiner' && prev?.role === 'candidate' && prev.phase === this.phase) {
        if (this.phase === 'intro') this.phase = 'p1';
        else if (this.phase === 'p2-follow') this.phase = 'p3';
      }
      t = this.last = { role, text: '', at: this.now(), phase: this.phase };
      this.turns.push(t);
    }
    t.text += ev.delta;
    if (role === 'candidate' && typeof ev.start_ms === 'number' && typeof ev.end_ms === 'number') {
      const s = this.t0.get(t) ?? ev.start_ms;
      this.t0.set(t, s);
      t.durationMs = Math.max(0, ev.end_ms - s);
    }
    return true;
  }
}

// ---- runs: one live session per user

export type Run = {
  sessionId: string;
  userId: string;
  paidBy: 'house' | 'own_key';
  test: SpeakingTest;
  transcript: Transcript;
  ws?: Upstream;
  ready: boolean;
  /** Sends one event upstream; false when the connection isn't open. */
  send(ev: object): boolean;
  /** Applies a script cue: tags the transcript phase and sends the instruction. False when it could not be sent (the web client then sends it itself). */
  cue(c: GptLiveCue): boolean;
  /** Closes the upstream (politely, then hard) and saves the transcript. */
  end(): Promise<void>;
};

const runs = new Map<string, Run>(); // by our session id
const byUser = new Map<string, Run>();
const OPEN = 1;
export const activeRun = (sessionId: string, userId: string) => {
  const r = runs.get(sessionId);
  return r?.userId === userId ? r : undefined;
};

/** Ends this user's run for the session (if any) and waits until its transcript is saved. */
export const endRun = (sessionId: string, userId: string) => activeRun(sessionId, userId)?.end() ?? Promise.resolve();

/** Writes the transcript into the session state (history) so /finish and the analysis use the examiner's real lines. */
export async function saveTranscript(run: Pick<Run, 'sessionId' | 'transcript'>) {
  if (!run.transcript.turns.length) return;
  const row = await db.query.liveSessions.findFirst({ where: eq(liveSessions.id, run.sessionId) });
  if (!row) return;
  await db.update(liveSessions).set({ state: { ...(row.state as LiveState), history: run.transcript.turns } }).where(eq(liveSessions.id, run.sessionId));
}

/** Registers a run (it supersedes this user's previous one) and, when `upstream` is given, wires its events in. `onEvent` also receives each raw server message. */
export function startRun(o: { userId: string; paidBy?: 'house' | 'own_key'; sessionId: string; test: SpeakingTest; upstream?: Upstream; onEvent?: (raw: string) => void; onClosed?: () => void }): Run {
  void byUser.get(o.userId)?.end();
  let done: Promise<void> | undefined;
  const t0 = Date.now();
  let billed = false;
  /** One `live_realtime` row per run: from the upstream `session.closed` usage when it arrives, else the wall clock (docs/admin/COSTS-AND-UI.md row 12; the usage shape is not confirmed, so the row is flagged estimated and keeps the raw usage). */
  const bill = (usage?: unknown) => {
    if (billed) return;
    billed = true;
    const seconds = Math.round((Date.now() - t0) / 1000);
    recordCost({ stage: 'live_realtime', provider: 'openai', model: env.OPENAI_LIVE_MODEL, costUsd: gptLiveUsd(seconds), audioSeconds: seconds, userId: o.userId, sessionId: o.sessionId, paidBy: o.paidBy ?? 'house', meta: { estimated: true, usage: usage ?? undefined, ...(usage === undefined && { wallClock: true }) } });
  };
  let timer: ReturnType<typeof setTimeout>;
  const run: Run = {
    sessionId: o.sessionId,
    userId: o.userId,
    paidBy: o.paidBy ?? 'house',
    test: o.test,
    transcript: new Transcript(),
    ready: false,
    send(ev) {
      if (run.ws?.readyState !== OPEN) return false;
      run.ws.send(JSON.stringify(ev));
      return true;
    },
    cue(c) {
      if (!run.ready) return false;
      run.transcript.setPhase(CUE_PHASE[c]);
      return run.send(cueEvent(c, o.test, candidateFacts(run.transcript.turns)));
    },
    end() {
      return (done ??= (async () => {
        clearTimeout(timer);
        if (run.ready || run.ws) bill(); // session.closed may not arrive (dropped socket): fall back to the wall clock
        if (runs.get(o.sessionId) === run) runs.delete(o.sessionId);
        if (byUser.get(o.userId) === run) byUser.delete(o.userId);
        const ws = run.ws;
        if (ws?.readyState === OPEN) {
          run.send({ type: 'session.close', event_id: 'close' });
          setTimeout(() => ws.terminate(), 3000).unref();
        }
        await saveTranscript(run).catch((e) => console.error('gpt-live: saving the transcript failed', e));
      })());
    },
  };
  runs.set(o.sessionId, run);
  byUser.set(o.userId, run);
  timer = setTimeout(() => void run.end(), MAX_RUN_MS);
  timer.unref();
  if (o.upstream) wire(run, o.upstream, o.onEvent, o.onClosed, bill);
  return run;
}

function wire(run: Run, ws: Upstream, onEvent?: (raw: string) => void, onClosed?: () => void, bill: (usage?: unknown) => void = () => {}) {
  run.ws = ws;
  ws.on('message', (data: Buffer | string) => {
    const raw = typeof data === 'string' ? data : data.toString('utf8');
    let ev: { type?: string; reason?: string; usage?: unknown; error?: { message?: string } } = {};
    try {
      ev = JSON.parse(raw);
    } catch {}
    if (ev.type === 'session.started') run.ready = true;
    else if (ev.type === 'session.closed') {
      console.log(`gpt-live closed ${run.sessionId} reason=${ev.reason} usage=${JSON.stringify(ev.usage)}`);
      bill(ev.usage ?? null);
    }
    else if (ev.type === 'error') console.warn('gpt-live error', ev.error?.message);
    run.transcript.feed(ev);
    onEvent?.(raw);
  });
  const gone = () => {
    run.ready = false;
    onClosed?.();
    void run.end();
  };
  ws.on('close', gone);
  ws.on('error', (e: Error) => console.warn('gpt-live socket', e.message));
}

/** Browser sessions: attach the sideband to a session OpenAI created from the browser's offer. A failure only costs the server-side transcript and cues. */
export function attachSideband(o: { userId: string; paidBy?: 'house' | 'own_key'; sessionId: string; test: SpeakingTest; liveId: string; apiKey: string }): Run {
  const ws = connect(`${LIVE_WS}/${encodeURIComponent(o.liveId)}/attach`, o.userId, o.apiKey);
  const run = startRun({ ...o, upstream: ws });
  // The attach connection is open once we may send; session.started was sent before we attached, so it is not awaited.
  ws.on('open', () => (run.ready = true));
  return run;
}

/** Native relay: the main upstream connection. Resolves with the run once `session.start` is sent. */
export function openRelay(o: { userId: string; paidBy?: 'house' | 'own_key'; sessionId: string; test: SpeakingTest; apiKey: string; onEvent: (raw: string) => void; onClosed: () => void }): Run {
  const ws = connect(LIVE_WS, o.userId, o.apiKey);
  const run = startRun({ ...o, upstream: ws });
  ws.on('open', () => run.send(sessionStart()));
  return run;
}
