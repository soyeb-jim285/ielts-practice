// Live examiner, turn-based: server TTS lines, local VAD turns, one recording per part sent to /live/finish.
import type { Phase } from '@server/ai/examiner';
import type { Prompt, SpeakingTest } from '@server/routes/prompts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCountdown } from '@/hooks/useCountdown';
import { useRecorder, type Recording } from '@/hooks/useRecorder';
import { useVad } from '@/hooks/useVad';
import { api } from '@/lib/api';
import { withDeadline } from './deadline';
import { recordMix, type MixRecording } from './mix';

export type { Phase };
export type ExaminerLine = { examinerText: string; audioUrl: string | null; voiceError?: string; phase: Phase; transcript?: string; prepSeconds?: number; cueCard?: Prompt };
export type LiveStarted = ExaminerLine & { sessionId: string; test: SpeakingTest };
/** Which bank /live/start draws the test from; undefined = the server default (any visible prompt). */
export type LiveSource = 'cambridge' | 'generated' | undefined;
/** The /live/start body: inside a mock test the server picks the questions from the mock, so only `mockId` is sent. */
export const liveStartBody = (source: LiveSource, mockId?: string) => (mockId ? { mockId } : { source });
type Part = 1 | 2 | 3;

export const PREP_S = 60;
export const TALK_S = 120;

/** What both examiner providers expose to the stage UI. */
export type LiveExaminer = {
  status: 'idle' | 'starting' | 'examiner' | 'candidate' | 'thinking' | 'waiting' | 'finishing' | 'error';
  phase: Phase;
  /** Examiner's current line (captions). */
  caption: string;
  cueCard?: Prompt;
  /** Seconds left: prep during p2-prep, talk during p2-talk. */
  prepLeft: number;
  talkLeft: number;
  talkRunning: boolean;
  /** Candidate mic level 0..1 while recording. */
  level: number;
  error?: string;
  /** Examiner voice failed: the test continues on captions only. */
  voiceError?: string;
  /** Browser blocked autoplay: show a tap-to-play control that calls resume(). */
  needsTap: boolean;
  resume(): void;
  retry?: () => void;
  /** Button text for retry (default "Try again"). */
  retryLabel?: string;
  /** Candidate finished speaking (the "I'm done" button); null when it doesn't apply. */
  endTurn: (() => void) | null;
  start(): Promise<void>;
  /** End the test now: score what was recorded. */
  end(): Promise<void>;
};

const message = (e: unknown) => (e instanceof Error && e.message) || 'Something went wrong. Check your connection and try again.';

/** Presigned upload of one candidate recording into this live session; returns the storage key. */
export async function uploadRecording(sessionId: string, r: Recording): Promise<string> {
  const { key, uploadUrl } = await withDeadline(api.post<{ key: string; uploadUrl: string }>('/live/upload-url', { sessionId, audioContentType: r.mime }));
  const res = await withDeadline(fetch(uploadUrl, { method: 'PUT', body: r.blob, headers: { 'content-type': r.mime }, signal: AbortSignal.timeout(45_000) })).catch(() => null);
  if (!res?.ok) throw new Error("Couldn't upload your recording. Check your connection and try again.");
  return key;
}

/** One answer window of a part recording, in the recording's own clock (paused examiner time does not count): `q` = the examiner line it answers,
 *  `question` = that line as the examiner actually said it (duplex examiners adapt the script, so the scripted question can differ). */
export type AnswerWindow = { q: number; startMs: number; endMs: number; question?: string };
/** Shorter windows (a breath, a "yes" over the examiner's tail) do not count as an answer and do not move to the next question. */
const MIN_ANSWER_MS = 1500;
/** An answer needs this much voiced audio: a silent wait before the examiner's first line (its captions run ahead of its audio) is not an answer. */
const MIN_VOICED_MS = 600;

/** Part-recorder bookkeeping, pure so it can be tested: examiner(on) pauses and closes the open window, examiner(off) opens one;
 *  a question index moves on only when the examiner speaks again after a real answer (the server's transcript alternates the same way).
 *  `voicedMs(from, to)`: how much of the window had the candidate's voice; without it every long enough window counts. */
export function answerWindows(clock: () => number, voicedMs?: (fromMs: number, toMs: number) => number, line?: () => string) {
  const w: AnswerWindow[] = [];
  let open: number | null = null, q = 0, asked = '';
  const close = () => {
    if (open == null) return false;
    const end = Math.round(clock()), kept = end - open >= MIN_ANSWER_MS && (!voicedMs || voicedMs(open, end) >= MIN_VOICED_MS);
    if (kept) w.push({ q, startMs: open, endMs: end, ...(asked && { question: asked.slice(0, 2000) }) });
    open = null;
    return kept;
  };
  return {
    examiner(on: boolean) {
      if (on) { if (close()) q++; }
      // The examiner's caption when its voice stops is the whole line just heard (captions run ahead of the audio, never behind it).
      else if (open == null) (open = Math.round(clock())), (asked = line?.().trim() ?? '');
    },
    finish: () => (close(), w),
  };
}

/**
 * Whole-part recordings (one MediaRecorder per part). The recorder pauses while the examiner is audible (examiner(true/false)), so the
 * recording holds the candidate only and each answer window is sent as a segment. Recordings stay in memory until /live/finish succeeds,
 * so a failed upload can be retried without losing audio.
 */
export function usePartRecorder() {
  const rec = useRecorder();
  const { start: recStart, stop: recStop, pause: recPause, resume: recResume, clock, stream, voicedMs } = rec;
  const cur = useRef<{ part: Part; windows: ReturnType<typeof answerWindows>; mix: MixRecording | null } | null>(null);
  const examinerOn = useRef(false);
  const examinerStream = useRef<MediaStream | null>(null);
  const line = useRef(''); // the examiner's current caption
  type Conversation = { blob: Blob; mime: string; key?: string };
  type Stored = { rec: Recording; segments?: AnswerWindow[]; key?: string; conversation?: Conversation };
  const parts = useRef(new Map<Part, Stored>());
  const sessionId = useRef('');
  /** Parts already sent with /live/part while the test went on (their analysis is running): resolves to the attempt id, or null to resend at finish. */
  const sent = useRef(new Map<Part, Promise<string | null>>());

  /** Uploads what is missing (the playback copy is best effort) and returns the part's /live body. */
  const prepare = useCallback(async (sid: string, part: Part, p: Stored) => {
    p.key ??= await uploadRecording(sid, p.rec);
    if (p.conversation) p.conversation.key ??= await uploadRecording(sid, { ...p.conversation, durationMs: 0, energy: [] }).catch(() => undefined);
    return {
      part, audioKey: p.key, durationMs: p.rec.durationMs, energy: p.rec.energy,
      ...(p.segments && { segments: p.segments.slice(0, 200), marks: p.segments.slice(0, 200).map((w) => w.startMs) }),
      ...(p.conversation?.key && { conversationKey: p.conversation.key }),
    };
  }, []);

  /** Sends a finished part now, so its analysis runs while the test goes on. Best effort: a failure leaves it to finish(). */
  const send = useCallback(
    (part: Part) => {
      const sid = sessionId.current, p = parts.current.get(part);
      if (!sid || !p?.rec.blob.size || sent.current.has(part)) return;
      sent.current.set(part, prepare(sid, part, p).then((body) => api.post<{ attemptId: string }>('/live/part', { sessionId: sid, part: body })).then((r) => r.attemptId, () => null));
    },
    [prepare],
  );

  const stop = useCallback(async () => {
    const c = cur.current;
    if (!c) return;
    cur.current = null;
    const segments = c.windows.finish();
    const [r, mix] = await Promise.all([withDeadline(recStop(), 10_000).catch(() => null), c.mix ? withDeadline(c.mix.stop(), 10_000).catch(() => null) : null]);
    if (r) parts.current.set(c.part, { rec: r, segments: segments.length ? segments : undefined, conversation: mix ?? undefined });
    if (r) send(c.part);
  }, [recStop, send]);

  const start = useCallback(
    async (part: Part) => {
      if (cur.current?.part === part) return;
      await stop();
      const windows = answerWindows(clock, voicedMs, () => line.current);
      const c = (cur.current = { part, windows, mix: null as MixRecording | null });
      try {
        if (!(await recStart({ paused: examinerOn.current }))) throw new Error('Could not start recording. Check your microphone permissions and retry.');
      } catch (e) {
        cur.current = null;
        throw e;
      }
      if (!examinerOn.current) windows.examiner(false);
      // the playback copy runs only with an examiner stream to mix in (the duplex examiners); the part works without it
      if (examinerStream.current) c.mix = recordMix([stream(), examinerStream.current]);
    },
    [stop, recStart, clock, stream, voicedMs],
  );

  /** The examiner's caption as it grows (duplex examiners): the next answer window records it as the question it answers. */
  const question = useCallback((text: string) => void (line.current = text), []);

  /** The examiner's voice as a stream (duplex examiners): mixed into the conversation recording of the next part. */
  const output = useCallback((s: MediaStream) => void (examinerStream.current = s), []);

  /** The examiner became audible (true) or silent (false): pause the part recording over the examiner and open an answer window after. */
  const examiner = useCallback(
    (on: boolean) => {
      examinerOn.current = on;
      const c = cur.current;
      if (!c) return;
      if (on) recPause();
      c.windows.examiner(on);
      if (!on) recResume();
    },
    [recPause, recResume],
  );

  /** Use an existing recording as a part (the Part 2 long turn is a single turn); with its upload key it is complete, so it is sent now. */
  const add = useCallback(
    (part: Part, r: Recording, key?: string) => {
      parts.current.set(part, { rec: r, key });
      if (key) send(part);
    },
    [send],
  );

  /** Stops, waits for the parts already sent, sends the rest and closes the session. Returns the session's attempt ids ([] when nothing was recorded). */
  const finish = useCallback(
    async (sid: string): Promise<string[]> => {
      await stop();
      const list = [...parts.current].filter(([, p]) => p.rec.blob.size > 0);
      if (!list.length) return [];
      const done = new Set<Part>();
      for (const [part, job] of sent.current) if (await job) done.add(part);
      const body = await Promise.all(list.filter(([part]) => !done.has(part)).map(([part, p]) => prepare(sid, part, p)));
      return (await withDeadline(api.post<{ attemptIds: string[] }>('/live/finish', { sessionId: sid, parts: body }))).attemptIds;
    },
    [stop, prepare],
  );

  /** The live session the parts belong to: set once it exists, so finished parts can be sent during the test. */
  const session = useCallback((sid: string) => void (sessionId.current = sid), []);

  return { start, stop, examiner, question, output, add, finish, session, level: rec.level, state: rec.state, error: rec.error };
}

/** Plays examiner audio on one element (created on the Start click so autoplay is allowed). */
function useExaminerAudio() {
  const el = useRef<HTMLAudioElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const pending = useRef<() => void>(() => {});
  const complete = useRef<() => void>(() => {});
  useEffect(() => () => { el.current?.pause(); complete.current(); }, []);
  return {
    needsTap,
    prime: () => (el.current ??= new Audio()),
    stop: () => { el.current?.pause(); complete.current(); },
    resume: () => {
      setNeedsTap(false);
      pending.current();
    },
    play: (url: string) =>
      new Promise<void>((resolve) => {
        const a = (el.current ??= new Audio());
        complete.current();
        const timer = setTimeout(() => { a.pause(); done(); }, 30_000);
        const done = () => {
          clearTimeout(timer);
          a.onended = a.onerror = null;
          complete.current = pending.current = () => {};
          setNeedsTap(false);
          resolve();
        };
        complete.current = done;
        a.onended = a.onerror = done;
        a.src = url;
        a.play().catch(() => {
          pending.current = () => void a.play().catch(done);
          setNeedsTap(true);
        });
      }),
  };
}

export function useTurnExaminer(onFinished: (sessionId: string, attemptIds: string[]) => void, source?: LiveSource, mockId?: string): LiveExaminer {
  const [status, setStatus] = useState<LiveExaminer['status']>('idle');
  const [phase, setPhase] = useState<Phase>('intro');
  const [caption, setCaption] = useState('');
  const [cueCard, setCueCard] = useState<Prompt>();
  const [error, setError] = useState<string>();
  const [voiceError, setVoiceError] = useState<string>();
  const [retry, setRetry] = useState<() => void>();
  const turn = useRecorder();
  const parts = usePartRecorder();
  const audio = useExaminerAudio();
  const s = useRef({ sessionId: '', phase: 'intro' as Phase, busy: false, ended: false, prepTimer: undefined as ReturnType<typeof setTimeout> | undefined });

  const fail = (e: unknown, again: () => void) => {
    setError(message(e));
    setRetry(() => () => {
      setError(undefined);
      setRetry(undefined);
      again();
    });
    setStatus('error');
  };

  const prep = useCountdown(PREP_S, { onEnd: () => void submit(null) });
  const talk = useCountdown(TALK_S, { onEnd: () => endTurn() });

  async function finish() {
    const c = s.current;
    c.ended = true;
    clearTimeout(c.prepTimer);
    audio.stop();
    prep.stop();
    talk.stop();
    setStatus('finishing');
    if (turn.state === 'recording') {
      const r = await withDeadline(turn.stop(), 10_000).catch(() => null);
      if (r && c.phase === 'p2-talk') parts.add(2, r);
    }
    try {
      onFinished(c.sessionId, await parts.finish(c.sessionId));
    } catch (e) {
      fail(e, () => void finish());
    }
  }

  async function play(line: ExaminerLine) {
    const c = s.current;
    if (c.ended) return;
    c.phase = line.phase;
    setPhase(line.phase);
    setCaption(line.examinerText);
    if (line.voiceError) setVoiceError(line.voiceError);
    // Part recorders follow the phase; the Part 2 long turn reuses its turn recording.
    if (line.phase === 'p1' || line.phase === 'p3') {
      parts.examiner(true); // the examiner line plays now: not part of the candidate's recording
      await parts.start(line.phase === 'p1' ? 1 : 3);
    } else await parts.stop();
    if (line.phase === 'p2-prep') {
      setCueCard(line.cueCard);
    }
    setStatus('examiner');
    if (line.audioUrl) await audio.play(line.audioUrl); // null = TTS failed: captions only, go straight to listening
    parts.examiner(false);
    if (c.ended) return;
    if (line.phase === 'done') return void finish();
    if (line.phase === 'p2-prep') {
      setStatus('waiting');
      if (prep.left === PREP_S) prep.start();
      else c.prepTimer = setTimeout(() => void submit(null), Math.max(1, line.prepSeconds ?? 5) * 1000);
      return;
    }
    if (!(await turn.start())) throw new Error('Could not start recording. Check your microphone permissions and retry.');
    if (c.ended) return;
    setStatus('candidate');
    if (line.phase === 'p2-talk') talk.start();
  }

  /** Upload the candidate's turn (null = no answer / prep over) and play the examiner's reply. */
  async function submit(r: Recording | null) {
    const c = s.current;
    if (c.ended) return;
    parts.examiner(true); // the wait for the examiner's reply is not the candidate's pause: close the answer window now
    setStatus('thinking');
    try {
      if (r && c.phase === 'p2-talk') parts.add(2, r);
      const audioKey = r && r.blob.size ? await uploadRecording(c.sessionId, r) : undefined;
      if (c.ended) return;
      if (r && audioKey && c.phase === 'p2-talk') parts.add(2, r, audioKey);
      const line = await withDeadline(api.post<ExaminerLine>('/live/turn', { sessionId: c.sessionId, audioKey, skipped: !audioKey }), 90_000);
      c.busy = false;
      await play(line);
    } catch (e) {
      if (!c.ended) fail(e, () => void submit(r));
    }
  }

  function endTurn() {
    const c = s.current;
    if (c.busy || c.ended || turn.state !== 'recording') return;
    c.busy = true;
    talk.stop();
    setStatus('thinking');
    void withDeadline(turn.stop(), 10_000).then(submit, () => submit(null));
  }

  // The Part 2 long turn is ended by the candidate or the 2:00 hard stop, never by a pause.
  useVad(turn.level, { active: status === 'candidate' && phase !== 'p2-talk', onTurnEnd: endTurn });

  useEffect(() => {
    if ((turn.state === 'denied' || turn.state === 'unsupported') && !s.current.ended) fail(new Error(turn.error), () => void turn.start().then(() => setStatus('candidate')));
  }, [turn.state]);

  useEffect(() => () => { s.current.ended = true; clearTimeout(s.current.prepTimer); }, []);

  async function start() {
    s.current.ended = false;
    audio.prime();
    setStatus('starting');
    try {
      const st = await withDeadline(api.post<LiveStarted>('/live/start', liveStartBody(source, mockId)));
      if (s.current.ended) return;
      s.current.sessionId = st.sessionId;
      parts.session(st.sessionId);
      await play(st);
    } catch (e) {
      fail(e, () => void start());
    }
  }

  return {
    status,
    phase,
    caption,
    cueCard,
    prepLeft: prep.left,
    talkLeft: talk.left,
    talkRunning: talk.running,
    level: turn.level,
    error,
    voiceError,
    needsTap: audio.needsTap,
    resume: audio.resume,
    retry,
    endTurn: status === 'candidate' ? endTurn : null,
    start,
    end: finish,
  };
}
