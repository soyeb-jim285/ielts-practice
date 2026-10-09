// Live examiner over a duplex voice model (OpenAI GPT-Live or Gemini Live). The model runs the script; client timers drive the part changes
// with cues, and local per-part recordings go to /live/finish like the turn-based examiner. A Duplex is the provider-specific transport.
import type { Prompt } from '@server/routes/prompts';
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
/** Ends the test this long after the closing line is heard if the examiner's "stopped speaking" never arrives. */
const CLOSING_GRACE_MS = 8000;

export type CueKey = 'part2' | 'talk' | 'follow' | 'follow-timeup' | 'closing';

/** What a transport reports back. */
export type Handlers = {
  /** The examiner's voice started (true) or stopped (false) playing. */
  speaking(on: boolean): void;
  /** Examiner caption text: replaces the caption, or extends it with `append`. */
  caption(text: string, append?: boolean): void;
  /** The candidate finished an answer (the examiner is about to reply). */
  answered(): void;
  /** Candidate transcript activity: arm a reply watchdog without cutting off a long answer. */
  pending?(): void;
  /** The connection dropped for good. */
  lost(): void;
  /** The examiner's output audio, as soon as it exists: the part recorder pauses while it is audible. */
  output?(stream: MediaStream): void;
};

export type Duplex = {
  /** Opens the mic and the connection and starts the test (the examiner opens with the introduction). Rejects if it can't connect. */
  connect(h: Handlers, sessionId: string): Promise<void>;
  /** Interrupt the examiner and give it an instruction. `key` names the script moment (GPT-Live: the server owns the wording and ignores `text`). */
  cue(text: string, heard?: boolean, key?: CueKey): void;
  /** false: the examiner must not hear the candidate (preparation); `fresh` marks where the long turn starts (Gemini stops streaming, GPT-Live hears it and stays silent by instruction). */
  listen(on: boolean, fresh?: boolean): void;
  close(): void;
};

export function useDuplexExaminer(
  make: () => Duplex,
  onFinished: (sessionId: string, attemptIds: string[]) => void,
  /** Called instead of showing an error when the examiner can't connect, so the page can fall back to the turn-based one. */
  onUnavailable?: (reason: string) => void,
  source?: LiveSource,
  mockId?: string,
): LiveExaminer {
  const [status, setStatus] = useState<LiveExaminer['status']>('idle');
  const [phase, setPhase] = useState<Phase>('intro');
  const [caption, setCaption] = useState('');
  const [cueCard, setCueCard] = useState<Prompt>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState<() => void>();
  const [retryLabel, setRetryLabel] = useState<string>();
  const parts = usePartRecorder();
  const r = useRef({
    x: undefined as Duplex | undefined,
    sessionId: '',
    cueCard: undefined as Prompt | undefined,
    phase: 'intro' as Phase,
    ended: false,
    // After a cue, wait for the examiner to finish that line: 'cued' → 'speaking' → run `after`.
    wait: null as null | 'cued' | 'speaking',
    after: () => {},
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    waitTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    responseTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    unwatch: undefined as (() => void) | undefined,
    line: '', // the examiner's current caption
    output: false,
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
  const cue = (key: CueKey, text: string, after?: () => void, heard = false) => {
    const c = r.current;
    clearTimeout(c.waitTimer);
    clearTimeout(c.responseTimer);
    // cue() can synchronously emit speaking(false) while cutting off the old line.
    c.wait = null;
    c.x?.cue(text, heard, key);
    if (!c.x || c.ended) return;
    c.wait = after ? 'cued' : null;
    c.after = after ?? (() => {});
    setStatus('thinking');
    if (after) c.waitTimer = setTimeout(runAfter, CUE_TIMEOUT_MS);
    else watchResponse();
  };

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

  /** The examiner moved to Part 2 by itself (it ran out of Part 1 questions): show the cue card and start the preparation once it stops talking, without cueing it again. */
  function part2Heard() {
    const c = r.current;
    if (c.ended) return;
    c.phase = 'p2-prep';
    setPhase('p2-prep');
    clearTimeout(c.timer);
    c.x?.listen(false);
    void parts.stop();
    setCueCard(c.cueCard);
    clearTimeout(c.waitTimer);
    c.wait = 'speaking';
    c.after = prep.start;
    c.waitTimer = setTimeout(runAfter, CUE_TIMEOUT_MS);
  }

  async function go(next: Phase, timeUp = false) {
    const c = r.current;
    if (c.ended || c.phase === next) return;
    c.phase = next;
    setPhase(next);
    clearTimeout(c.timer);
    try {
      switch (next) {
        case 'p1': // the model moves from the introduction into Part 1 by itself
          void parts.start(1).catch(() => handlers.lost());
          c.timer = setTimeout(() => void go('p2-prep'), PART_MS);
          break;
        case 'p2-prep':
          c.x?.listen(false);
          await parts.stop();
          if (c.ended) return;
          setCueCard(c.cueCard);
          cue('part2', 'Part 1 is over. Move to Part 2 now: give the Part 2 instructions and the topic, then stay silent while the candidate prepares.', prep.start);
          break;
        case 'p2-talk':
          prep.stop();
          await parts.start(2);
          if (c.ended) return;
          c.x?.listen(false, true);
          cue('talk', 'The preparation minute is over. Ask the candidate to start speaking now, then stay silent until you are told the talk is over.', talk.start);
          break;
        case 'p2-follow':
          talk.stop();
          await parts.stop();
          if (c.ended) return;
          cue(
            timeUp ? 'follow-timeup' : 'follow',
            timeUp
              ? `The two minutes are up. Say "Thank you. That's the end of your time." and ask the rounding-off question.`
              : 'The candidate has finished their talk. Say "Thank you." and ask the rounding-off question.',
            undefined,
            true,
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
          cue('closing', 'The test is over. Say the closing line now and nothing more.', () => void finish());
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
      if (on) {
        c.output = true;
        clearTimeout(c.responseTimer);
        if (c.wait === 'cued') c.wait = 'speaking';
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
      if (c.phase === 'p1' && PART2.test(c.line)) part2Heard();
      if (c.phase === 'p3' && CLOSING.test(c.line)) closingHeard();
    },
    output(stream) {
      const c = r.current;
      c.unwatch?.();
      c.unwatch = watchExaminer(stream, parts.examiner);
      parts.output(stream);
    },
    answered() {
      const c = r.current;
      if (c.ended) return;
      if (c.phase === 'intro') void go('p1');
      else if (c.phase === 'p2-follow') void go('p3');
      if (c.phase !== 'p2-talk') setStatus('thinking');
    },
    pending() {
      const c = r.current;
      if (!c.ended && !c.wait && c.phase !== 'p2-prep' && c.phase !== 'p2-talk') watchResponse();
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
      }
      c.x = make();
      await withDeadline(c.x.connect(handlers, c.sessionId));
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
