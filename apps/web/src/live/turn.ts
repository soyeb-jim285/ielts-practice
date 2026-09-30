// Live examiner, turn-based: server TTS lines, local VAD turns, one recording per part sent to /live/finish.
import type { Phase } from '@server/ai/examiner';
import type { Prompt, SpeakingTest } from '@server/routes/prompts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCountdown } from '@/hooks/useCountdown';
import { useRecorder, type Recording } from '@/hooks/useRecorder';
import { useVad } from '@/hooks/useVad';
import { api } from '@/lib/api';

export type { Phase };
export type ExaminerLine = { examinerText: string; audioUrl: string | null; voiceError?: string; phase: Phase; transcript?: string; prepSeconds?: number; cueCard?: Prompt };
export type LiveStarted = ExaminerLine & { sessionId: string; test: SpeakingTest };
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
  const { key, uploadUrl } = await api.post<{ key: string; uploadUrl: string }>('/live/upload-url', { sessionId, audioContentType: r.mime });
  const res = await fetch(uploadUrl, { method: 'PUT', body: r.blob, headers: { 'content-type': r.mime } }).catch(() => null);
  if (!res?.ok) throw new Error("Couldn't upload your recording. Check your connection and try again.");
  return key;
}

/**
 * Whole-part recordings (one MediaRecorder per part). Recordings stay in memory until /live/finish succeeds,
 * so a failed upload can be retried without losing audio.
 */
export function usePartRecorder() {
  const rec = useRecorder();
  const { start: recStart, stop: recStop } = rec;
  const cur = useRef<{ part: Part; t0: number; marks: number[] } | null>(null);
  const parts = useRef(new Map<Part, { rec: Recording; marks?: number[]; key?: string }>());

  const stop = useCallback(async () => {
    const c = cur.current;
    if (!c) return;
    cur.current = null;
    const r = await recStop().catch(() => null);
    if (r) parts.current.set(c.part, { rec: r, marks: c.marks.length ? c.marks : undefined });
  }, [recStop]);

  const start = useCallback(
    async (part: Part) => {
      if (cur.current?.part === part) return;
      await stop();
      cur.current = { part, t0: performance.now(), marks: [] };
      await recStart();
      if (cur.current) cur.current.t0 = performance.now();
    },
    [stop, recStart],
  );

  /** Question start offset within the current part. */
  const mark = useCallback(() => {
    const c = cur.current;
    if (c) c.marks.push(Math.max(0, Math.round(performance.now() - c.t0)));
  }, []);

  /** Use an existing recording as a part (the Part 2 long turn is a single turn). */
  const add = useCallback((part: Part, r: Recording, key?: string) => void parts.current.set(part, { rec: r, key }), []);

  /** Stops, uploads what's missing and creates the attempts. Returns [] when nothing was recorded. */
  const finish = useCallback(
    async (sessionId: string): Promise<string[]> => {
      await stop();
      const list = [...parts.current].filter(([, p]) => p.rec.blob.size > 0);
      if (!list.length) return [];
      await Promise.all(list.map(async ([, p]) => (p.key ??= await uploadRecording(sessionId, p.rec))));
      const body = list.map(([part, p]) => ({ part, audioKey: p.key!, durationMs: p.rec.durationMs, energy: p.rec.energy, marks: p.marks?.slice(0, 200) }));
      return (await api.post<{ attemptIds: string[] }>('/live/finish', { sessionId, parts: body })).attemptIds;
    },
    [stop],
  );

  return { start, stop, mark, add, finish, level: rec.level, state: rec.state, error: rec.error };
}

/** Plays examiner audio on one element (created on the Start click so autoplay is allowed). */
function useExaminerAudio() {
  const el = useRef<HTMLAudioElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const pending = useRef<() => void>(() => {});
  useEffect(() => () => el.current?.pause(), []);
  return {
    needsTap,
    prime: () => (el.current ??= new Audio()),
    stop: () => el.current?.pause(),
    resume: () => {
      setNeedsTap(false);
      pending.current();
    },
    play: (url: string) =>
      new Promise<void>((resolve) => {
        const a = (el.current ??= new Audio());
        a.onended = a.onerror = () => resolve();
        a.src = url;
        a.play().catch(() => {
          pending.current = () => void a.play().catch(() => resolve());
          setNeedsTap(true);
        });
      }),
  };
}

export function useTurnExaminer(onFinished: (sessionId: string, attemptIds: string[]) => void): LiveExaminer {
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
      const r = await turn.stop().catch(() => null);
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
      await parts.start(line.phase === 'p1' ? 1 : 3);
      parts.mark();
    } else await parts.stop();
    if (line.phase === 'p2-prep') {
      setCueCard(line.cueCard);
      if (!prep.running && prep.left === PREP_S) prep.start();
      else c.prepTimer = setTimeout(() => void submit(null), (line.prepSeconds ?? 5) * 1000);
    }
    setStatus(line.phase === 'p2-prep' ? 'waiting' : 'examiner');
    if (line.audioUrl) await audio.play(line.audioUrl); // null = TTS failed: captions only, go straight to listening
    if (c.ended) return;
    if (line.phase === 'done') return void finish();
    if (line.phase === 'p2-prep') return;
    await turn.start();
    setStatus('candidate');
    if (line.phase === 'p2-talk') talk.start();
  }

  /** Upload the candidate's turn (null = no answer / prep over) and play the examiner's reply. */
  async function submit(r: Recording | null) {
    const c = s.current;
    if (c.ended) return;
    setStatus('thinking');
    try {
      const audioKey = r && r.blob.size ? await uploadRecording(c.sessionId, r) : undefined;
      if (r && audioKey && c.phase === 'p2-talk') parts.add(2, r, audioKey);
      const line = await api.post<ExaminerLine>('/live/turn', { sessionId: c.sessionId, audioKey, skipped: !audioKey });
      c.busy = false;
      await play(line);
    } catch (e) {
      fail(e, () => void submit(r));
    }
  }

  function endTurn() {
    const c = s.current;
    if (c.busy || c.ended || turn.state !== 'recording') return;
    c.busy = true;
    talk.stop();
    setStatus('thinking');
    void turn.stop().then(submit, () => submit(null));
  }

  // The Part 2 long turn is ended by the candidate or the 2:00 hard stop, never by a pause.
  useVad(turn.level, { active: status === 'candidate' && phase !== 'p2-talk', onTurnEnd: endTurn });

  useEffect(() => {
    if ((turn.state === 'denied' || turn.state === 'unsupported') && !s.current.ended) fail(new Error(turn.error), () => void turn.start().then(() => setStatus('candidate')));
  }, [turn.state]);

  useEffect(() => () => clearTimeout(s.current.prepTimer), []);

  async function start() {
    audio.prime();
    setStatus('starting');
    try {
      const st = await api.post<LiveStarted>('/live/start', {});
      s.current.sessionId = st.sessionId;
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
