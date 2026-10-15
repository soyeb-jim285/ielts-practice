// Live examiner over a duplex voice model (OpenAI GPT-Live or Gemini Live). The model runs the script; client timers drive the part changes
// with cues, and local per-part recordings go to /live/finish like the turn-based examiner. A Duplex is the provider-specific transport.
import { CUE_TEXT, DUPLEX_PART, nudgeText } from '@ielts/core';
import type { Prompt } from '@server/routes/prompts';

export { nudgeText };
import { useEffect, useRef, useState } from 'react';
import { useCountdown } from '@/hooks/useCountdown';
import { api, ApiError } from '@/lib/api';
import { withDeadline } from './deadline';
import { watchExaminer } from './examinerVoice';
import { PREP_S, TALK_S, usePartRecorder, type LiveExaminer, type LiveSource, type LiveStarted, type Phase, liveStartBody } from './turn';

const PART_MS = 270_000; // Parts 1 and 3: 4.5 min each
const CUE_TIMEOUT_MS = 45_000; // a cue whose examiner line never starts or ends must not stall the test
/** The examiner's own closing line (examiner.ts LINES.closing): said in Part 3 without our cue, it still ends the test. */
const CLOSING = /\bend of the (speaking )?test\b/i;
/** The examiner's own Part 2 instructions (examiner.ts LINES.prep): said in Part 1 without our cue, the page still moves to the cue card. */
const PART2 = /\bgoing to give you a topic\b|\bone minute to think\b/i;
/** The examiner's Part 1 lead (examiner.ts P1_START): the introduction (one to three questions, picked per session) is over. */
const P1_START = /\bfirst part\b|\bquestions about yourself\b/i;
/** Ends the test this long after the closing line is heard if the examiner's "stopped speaking" never arrives. */
const CLOSING_GRACE_MS = 8000;

export type CueKey = 'part2' | 'talk' | 'follow' | 'follow-timeup' | 'closing' | 'continue' | 'repeat';

// Stall watchdog. Real sessions (2026-10-10/11 recordings) showed the examiner going quiet with nobody talking: it announced "let's move on to the next
// part" and waited for a cue that only the part timer sends, ended a turn on "Thank you for explaining that." with no question, or never answered a
// finished answer (40+ s). Whoever owes the next turn, the app notices the silence and tells the examiner where it is and what to do.
/** The examiner owes a turn (the candidate finished, or its last line asked nothing): nudge after this much silence. */
export const OWE_MS = 6000;
/** The examiner asked a question and the candidate has said nothing for this long: ask it to repeat the question once. */
export const ANSWER_MS = 20_000;
/** Nudges in a row without the candidate speaking; past this, an examiner that stayed silent through them counts as lost. */
const MAX_NUDGES = 3;
/** A candidate turn longer than this without a "stopped" event is a stuck voice detector (noise), not speech. */
const TALK_MAX_MS = 90_000;
export type StallState = { phase: Phase; examinerOn: boolean; talking: boolean; line: string; examinerEnd: number; candidateAt: number; now: number };
/** Who is stuck, if anyone: 'continue' (the examiner owes a turn) or 'repeat' (a question went unanswered). Only in the conversational parts. */
export function stalled(s: StallState): 'continue' | 'repeat' | null {
  if (!DUPLEX_PART[s.phase] || s.examinerOn) return null;
  if (s.talking && s.now - s.candidateAt < TALK_MAX_MS) return null;
  const owes = s.candidateAt > s.examinerEnd || !/\?["'”’)]*\s*$/.test(s.line.trim());
  return s.now - Math.max(s.examinerEnd, s.candidateAt) < (owes ? OWE_MS : ANSWER_MS) ? null : owes ? 'continue' : 'repeat';
}

/** What a transport reports back. */
export type Handlers = {
  /** The examiner's voice started (true) or stopped (false) playing. */
  speaking(on: boolean): void;
  /** Examiner caption text: replaces the caption, or extends it with `append`. */
  caption(text: string, append?: boolean): void;
  /** The candidate finished an answer (the examiner is about to reply). */
  answered(): void;
  /** Candidate activity (speech or transcript). `talking`: true while the provider's voice detector says they are mid-turn, so the stall watchdog waits. */
  pending?(talking?: boolean): void;
  /** The provider's transcript of the candidate (debug views; the scored transcript comes from the recording). */
  heard?(text: string): void;
  /** The connection dropped for good. */
  lost(): void;
  /** The examiner's output audio, as soon as it exists: the part recorder pauses while it is audible. */
  output?(stream: MediaStream): void;
};

export type Duplex = {
  /** Opens the mic and the connection and starts the test (the examiner opens with the introduction). Rejects if it can't connect. */
  connect(h: Handlers, sessionId: string): Promise<void>;
  /** Interrupt the examiner and give it an instruction. `key` names the script moment (GPT-Live: the server owns the wording and ignores `text`).
   *  `heard`: keep the candidate's unanswered speech, so the examiner's next words still count as the answer being taken (a nudge). */
  cue(text: string, heard?: boolean, key?: CueKey): void;
  /** false: the examiner must not hear the candidate (preparation); `fresh` marks where the long turn starts (Gemini stops streaming, GPT-Live hears it and stays silent by instruction). */
  listen(on: boolean, fresh?: boolean): void;
  /** Apply the stored part profile before subsequent cues. Async transports serialize controls. */
  configurePart?(part: 1 | 2 | 3): void | Promise<void>;
  close(): void;
};

export function useDuplexExaminer(
  make: () => Duplex,
  onFinished: (sessionId: string, attemptIds: string[]) => void,
  /** Called instead of showing an error when the examiner can't connect, so the page can fall back to the turn-based one. */
  onUnavailable?: (reason: string) => void,
  source?: LiveSource,
  mockId?: string,
  /** `record: false` (admin playground): no part recordings, so nothing is uploaded, scored or added to the history. `debug` sees every transport event. */
  opts: { record?: boolean; debug?: Partial<Handlers> } = {},
): LiveExaminer {
  const [status, setStatus] = useState<LiveExaminer['status']>('idle');
  const [phase, setPhase] = useState<Phase>('intro');
  const [caption, setCaption] = useState('');
  const [cueCard, setCueCard] = useState<Prompt>();
  const [voice, setVoice] = useState<MediaStream>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState<() => void>();
  const [retryLabel, setRetryLabel] = useState<string>();
  const recorder = usePartRecorder();
  const parts = opts.record === false ? { ...recorder, start: async () => {}, stop: async () => {}, finish: async () => [] as string[] } : recorder;
  const r = useRef({
    x: undefined as Duplex | undefined,
    sessionId: '',
    cueCard: undefined as Prompt | undefined,
    phase: 'intro' as Phase,
    ended: false,
    // After a cue, wait for the examiner to finish that line: 'cued' → 'speaking' → run `after`.
    wait: null as null | 'cued' | 'speaking',
    after: () => {},
    onStart: undefined as (() => void) | undefined,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    waitTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    responseTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    unwatch: undefined as (() => void) | undefined,
    line: '', // the examiner's current caption
    output: false,
    // stall watchdog (see stalled())
    examinerOn: false,
    examinerEnd: 0,
    candidateAt: 0,
    talking: false,
    nudges: 0,
    introAnswers: 0,
    /** The session's introduction lines: an examiner that skips the Part 1 lead still gets to Part 1 (and its timer) after this many answers. */
    introLen: 1,
    spokeSinceNudge: true,
    watchdog: undefined as ReturnType<typeof setInterval> | undefined,
  });

  const prep = useCountdown(PREP_S, { onEnd: () => void go('p2-talk') });
  const talk = useCountdown(TALK_S, { onEnd: () => void go('p2-follow', true) });

  const runAfter = () => {
    const c = r.current;
    clearTimeout(c.waitTimer);
    if (!c.wait) return;
    c.wait = null;
    if (c.ended) return;
    setStatus(c.phase === 'p2-prep' ? 'waiting' : 'candidate');
    c.after();
  };
  /** `onStart`: runs when the examiner starts saying the cued line (the page changes with the voice, not before it). */
  const cue = (key: CueKey, text: string, after?: () => void, heard = false, onStart?: () => void) => {
    const c = r.current;
    clearTimeout(c.waitTimer);
    clearTimeout(c.responseTimer);
    // cue() can synchronously emit speaking(false) while cutting off the old line.
    c.wait = null;
    c.x?.cue(text, heard, key);
    c.examinerEnd = Date.now(); // the watchdog counts silence from the cue
    if (!c.x || c.ended) return;
    c.wait = after ? 'cued' : null;
    c.after = after ?? (() => {});
    c.onStart = onStart;
    setStatus('thinking');
    if (after) c.waitTimer = setTimeout(runAfter, CUE_TIMEOUT_MS);
    else watchResponse();
  };

  /** Once a second: if nobody is talking and the examiner should be, tell it where it is and what to do; an examiner that ignores every nudge is lost. */
  function tick() {
    const c = r.current;
    if (c.ended || !c.x || !c.output || c.wait) return;
    const now = Date.now();
    // An ignored nudge still leaves the examiner owing a turn, whatever its last line was.
    const a = stalled({ phase: c.phase, examinerOn: c.examinerOn, talking: c.talking, line: c.spokeSinceNudge ? c.line : '', examinerEnd: c.examinerEnd, candidateAt: c.candidateAt, now });
    if (!a) return;
    if (c.nudges >= MAX_NUDGES) {
      if (!c.spokeSinceNudge) handlers.lost();
      return; // it answers the nudges but the candidate is silent: leave the floor to the candidate
    }
    c.nudges++;
    c.spokeSinceNudge = false;
    console.info('live examiner stalled', c.phase, a);
    c.x.cue(nudgeText(c.phase, a), a === 'continue', a);
    c.examinerEnd = now;
    c.talking = false;
    setStatus('thinking');
  }

  function watchResponse() {
    const c = r.current;
    clearTimeout(c.responseTimer);
    c.responseTimer = setTimeout(() => handlers.lost(), CUE_TIMEOUT_MS);
  }

  function close() {
    const c = r.current;
    clearTimeout(c.timer);
    clearTimeout(c.waitTimer);
    clearTimeout(c.responseTimer);
    clearInterval(c.watchdog);
    c.wait = null;
    c.unwatch?.();
    c.unwatch = undefined;
    c.x?.close();
    c.x = undefined;
  }
  useEffect(() => () => { r.current.ended = true; close(); }, []);

  async function finish() {
    const c = r.current;
    c.ended = true;
    close();
    prep.stop();
    talk.stop();
    setStatus('finishing');
    try {
      onFinished(c.sessionId, await parts.finish(c.sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish the test.');
      setRetry(() => () => (setError(undefined), void finish()));
      setStatus('error');
    }
  }

  /** The examiner said the closing line by itself (it ran out of Part 3 questions): stop recording and finish once it stops talking, without cueing it again. */
  function closingHeard() {
    const c = r.current;
    if (c.ended) return;
    c.phase = 'closing';
    setPhase('closing');
    clearTimeout(c.timer);
    void parts.stop();
    clearTimeout(c.waitTimer);
    c.wait = 'speaking';
    c.after = () => void finish();
    c.waitTimer = setTimeout(runAfter, CLOSING_GRACE_MS);
  }

  /** As in the real test, the card comes once the examiner has given the Part 2 instructions, and the minute starts with it. */
  function showCard() {
    setPhase('p2-prep'); // already shown when the instructions started; a cue that never got a voice still lands here
    setCueCard(r.current.cueCard);
    prep.start();
  }

  /** The examiner moved to Part 2 by itself (it ran out of Part 1 questions): show the cue card and start the preparation once it stops talking, without cueing it again. */
  function part2Heard() {
    const c = r.current;
    if (c.ended) return;
    c.phase = 'p2-prep';
    void Promise.resolve(c.x?.configurePart?.(2)).catch(() => handlers.lost());
    setPhase('p2-prep');
    clearTimeout(c.timer);
    c.x?.listen(false);
    void parts.stop();
    clearTimeout(c.waitTimer);
    c.wait = 'speaking';
    c.after = showCard;
    c.waitTimer = setTimeout(runAfter, CUE_TIMEOUT_MS);
  }

  async function go(next: Phase, timeUp = false) {
    const c = r.current;
    if (c.ended || c.phase === next) return;
    c.phase = next;
    if (next !== 'p2-prep') setPhase(next); // Part 2 shows once the examiner starts its instructions (go's p2-prep cue)
    clearTimeout(c.timer);
    try {
      const part = next === 'p1' ? 1 : next === 'p2-prep' ? 2 : next === 'p3' ? 3 : undefined;
      if (part && c.x?.configurePart) await c.x.configurePart(part);
      if (c.ended) return;
      switch (next) {
        case 'p1': // the model moves from the introduction into Part 1 by itself (heard as its Part 1 lead)
          void parts.start(1).catch(() => handlers.lost());
          c.timer = setTimeout(() => void go('p2-prep'), PART_MS);
          break;
        case 'p2-prep':
          c.x?.listen(false);
          await parts.stop();
          if (c.ended) return;
          cue('part2', CUE_TEXT.part2, showCard, false, () => setPhase('p2-prep'));
          break;
        case 'p2-talk':
          prep.stop();
          await parts.start(2);
          if (c.ended) return;
          c.x?.listen(false, true);
          cue('talk', CUE_TEXT.talk, talk.start);
          break;
        case 'p2-follow':
          talk.stop();
          await parts.stop();
          if (c.ended) return;
          cue(
            timeUp ? 'follow-timeup' : 'follow',
            timeUp ? CUE_TEXT['follow-timeup'] : CUE_TEXT.follow,
          );
          c.x?.listen(true);
          break;
        case 'p3': // the model moves from the rounding-off answer into Part 3 by itself
          void parts.start(3).catch(() => handlers.lost());
          c.timer = setTimeout(() => void go('closing'), PART_MS);
          break;
        case 'closing':
          await parts.stop();
          if (c.ended) return;
          cue('closing', CUE_TEXT.closing, () => void finish());
          break;
      }
    } catch {
      handlers.lost();
    }
  }

  const handlers: Handlers = {
    speaking(on) {
      const c = r.current;
      if (c.ended) return;
      c.examinerOn = on;
      if (!on) c.examinerEnd = Date.now();
      if (on) {
        c.output = true;
        c.spokeSinceNudge = true;
        c.talking = false;
        clearTimeout(c.responseTimer);
        if (c.wait === 'cued') {
          c.wait = 'speaking';
          c.onStart?.();
          c.onStart = undefined;
        }
        setStatus('examiner');
      } else {
        setStatus(c.phase === 'p2-prep' ? 'waiting' : 'candidate');
        if (c.wait === 'speaking') runAfter();
      }
    },
    caption(text, append) {
      const c = r.current;
      c.line = append ? c.line + text : text;
      setCaption(c.line);
      parts.question(c.line);
      if (c.phase === 'intro' && P1_START.test(c.line)) void go('p1');
      if (c.phase === 'p1' && PART2.test(c.line)) part2Heard();
      if (c.phase === 'p3' && CLOSING.test(c.line)) closingHeard();
    },
    output(stream) {
      const c = r.current;
      c.unwatch?.();
      c.unwatch = watchExaminer(stream, parts.examiner);
      parts.output(stream);
      setVoice(stream);
    },
    answered() {
      const c = r.current;
      if (c.ended) return;
      if (c.phase === 'intro') {
        if (++c.introAnswers >= c.introLen) void go('p1'); // normally its Part 1 lead (caption) moves it earlier
      } else if (c.phase === 'p2-follow') void go('p3');
      if (c.phase !== 'p2-talk') setStatus('thinking');
    },
    pending(talking) {
      const c = r.current;
      c.candidateAt = Date.now();
      c.talking = !!talking;
      c.nudges = 0;
      if (!c.ended && !c.output) watchResponse(); // before the examiner's first words the watchdog is off: keep the connect deadline
    },
    lost() {
      const c = r.current;
      if (c.ended) return;
      close();
      prep.stop();
      talk.stop();
      setError('The connection to the examiner dropped. The parts you recorded are safe.');
      setRetryLabel(c.output ? 'Score what I recorded' : 'Reconnect examiner');
      setRetry(() => () => (setError(undefined), c.output ? void finish() : void start()));
      setStatus('error');
    },
  };

  /** Transport handlers with the debug taps in front (each tap sees the event first). */
  const tapped = (): Handlers => {
    const d = opts.debug;
    if (!d) return handlers;
    const out = { ...handlers } as Record<string, unknown>;
    for (const k of Object.keys(d) as (keyof Handlers)[])
      out[k] = (...a: unknown[]) => ((d[k] as (...x: unknown[]) => void)(...a), (handlers[k] as ((...x: unknown[]) => void) | undefined)?.(...a));
    return out as Handlers;
  };

  async function start() {
    const c = r.current;
    c.ended = false;
    setStatus('starting');
    try {
      if (!c.sessionId) {
        const st = await withDeadline(api.post<LiveStarted>('/live/start', { skipTts: true, ...liveStartBody(source, mockId) }));
        if (c.ended) return;
        c.sessionId = st.sessionId;
        parts.session(st.sessionId);
        c.cueCard = st.test.part2;
        c.introLen = st.test.script?.intro.length ?? 1;
      }
      c.x = make();
      await withDeadline(c.x.connect(tapped(), c.sessionId));
      clearInterval(c.watchdog);
      c.watchdog = setInterval(tick, 1000);
      if (!c.output && !c.ended) {
        setStatus('thinking');
        watchResponse();
      }
    } catch (e) {
      close();
      const denied = (e as DOMException)?.name === 'NotAllowedError';
      const msg = denied ? "Microphone blocked — allow it in the browser's site settings and retry" : e instanceof Error ? e.message : 'Could not start the test.';
      // A refusal with a reason (no key, no quota) is not an outage: falling back to the turn-based examiner would hit the same wall.
      if (!denied && !(e instanceof ApiError && e.code) && onUnavailable) return onUnavailable(msg);
      setError(msg);
      setRetry(() => () => (setError(undefined), void start()));
      setStatus('error');
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
    level: parts.level,
    voice,
    error,
    needsTap: false,
    resume: () => {},
    retry,
    retryLabel,
    endTurn: phase === 'p2-talk' && talk.running ? () => void go('p2-follow') : null,
    start,
    end: finish,
  };
}
