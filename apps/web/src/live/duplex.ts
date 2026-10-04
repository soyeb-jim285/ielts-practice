// Live examiner over a duplex voice model (OpenAI GPT-Live or Gemini Live). The model runs the script; client timers drive the part changes
// with cues, and local per-part recordings go to /live/finish like the turn-based examiner. A Duplex is the provider-specific transport.
import type { Prompt } from '@server/routes/prompts';
import { useEffect, useRef, useState } from 'react';
import { useCountdown } from '@/hooks/useCountdown';
import { api, ApiError } from '@/lib/api';
import { PREP_S, TALK_S, usePartRecorder, type LiveExaminer, type LiveSource, type LiveStarted, type Phase } from './turn';

const PART_MS = 270_000; // Parts 1 and 3: 4.5 min each
const CUE_TIMEOUT_MS = 45_000; // a cue whose examiner line never starts or ends must not stall the test

export type CueKey = 'part2' | 'talk' | 'follow' | 'follow-timeup' | 'closing';

/** What a transport reports back. */
export type Handlers = {
  /** The examiner's voice started (true) or stopped (false) playing. */
  speaking(on: boolean): void;
  /** Examiner caption text: replaces the caption, or extends it with `append`. */
  caption(text: string, append?: boolean): void;
  /** The candidate finished an answer (the examiner is about to reply). */
  answered(): void;
  /** The connection dropped for good. */
  lost(): void;
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
  });

  const prep = useCountdown(PREP_S, { onEnd: () => void go('p2-talk') });
  const talk = useCountdown(TALK_S, { onEnd: () => void go('p2-follow', true) });

  const runAfter = () => {
    const c = r.current;
    clearTimeout(c.waitTimer);
    if (!c.wait) return;
    c.wait = null;
    c.after();
  };
  const cue = (key: CueKey, text: string, after?: () => void, heard = false) => {
    const c = r.current;
    clearTimeout(c.waitTimer);
    c.x?.cue(text, heard, key);
    c.wait = after ? 'cued' : null;
    c.after = after ?? (() => {});
    if (after) c.waitTimer = setTimeout(runAfter, CUE_TIMEOUT_MS);
  };

  function close() {
    const c = r.current;
    clearTimeout(c.timer);
    clearTimeout(c.waitTimer);
    c.x?.close();
    c.x = undefined;
  }
  useEffect(() => close, []);

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

  async function go(next: Phase, timeUp = false) {
    const c = r.current;
    if (c.ended || c.phase === next) return;
    c.phase = next;
    setPhase(next);
    clearTimeout(c.timer);
    switch (next) {
      case 'p1': // the model moves from the introduction into Part 1 by itself
        void parts.start(1);
        c.timer = setTimeout(() => void go('p2-prep'), PART_MS);
        break;
      case 'p2-prep':
        await parts.stop();
        setCueCard(c.cueCard);
        c.x?.listen(false);
        cue('part2', 'Part 1 is over. Move to Part 2 now: give the Part 2 instructions and the topic, then stay silent while the candidate prepares.', prep.start);
        break;
      case 'p2-talk':
        prep.stop();
        void parts.start(2);
        c.x?.listen(false, true);
        cue('talk', 'The preparation minute is over. Ask the candidate to start speaking now, then stay silent until you are told the talk is over.', talk.start);
        break;
      case 'p2-follow':
        talk.stop();
        await parts.stop();
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
        void parts.start(3);
        c.timer = setTimeout(() => void go('closing'), PART_MS);
        break;
      case 'closing':
        await parts.stop();
        cue('closing', 'The test is over. Say the closing line now and nothing more.', () => void finish());
        break;
    }
  }

  const handlers: Handlers = {
    speaking(on) {
      const c = r.current;
      if (c.ended) return;
      if (on) {
        if (c.wait === 'cued') c.wait = 'speaking';
        setStatus('examiner');
      } else {
        setStatus(c.phase === 'p2-prep' ? 'waiting' : 'candidate');
        if (c.wait === 'speaking') runAfter();
      }
    },
    caption: (text, append) => setCaption((t) => (append ? t + text : text)),
    answered() {
      const c = r.current;
      if (c.ended) return;
      if (c.phase === 'intro') void go('p1');
      else if (c.phase === 'p2-follow') void go('p3');
      if (c.phase !== 'p2-talk') setStatus('thinking');
    },
    lost() {
      const c = r.current;
      if (c.ended) return;
      close();
      setError('The connection to the examiner dropped. The parts you recorded are safe.');
      setRetryLabel('Score what I recorded');
      setRetry(() => () => (setError(undefined), void finish()));
      setStatus('error');
    },
  };

  async function start() {
    const c = r.current;
    setStatus('starting');
    try {
      if (!c.sessionId) {
        const st = await api.post<LiveStarted>('/live/start', { skipTts: true, source });
        c.sessionId = st.sessionId;
        c.cueCard = st.test.part2;
      }
      c.x = make();
      await c.x.connect(handlers, c.sessionId);
      setStatus('thinking');
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
