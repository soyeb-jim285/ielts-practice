// Live examiner over OpenAI Realtime (WebRTC). The model runs the script; client timers drive part changes
// with system messages, and local per-part recordings go to /live/finish like the turn-based examiner.
import type { Prompt } from '@server/routes/prompts';
import { useEffect, useRef, useState } from 'react';
import { useCountdown } from '@/hooks/useCountdown';
import { api } from '@/lib/api';
import { PREP_S, TALK_S, usePartRecorder, type LiveExaminer, type LiveStarted, type Phase } from './turn';

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const PART_MS = 270_000; // Parts 1 and 3: 4.5 min each
// Low eagerness so the examiner waits for the candidate to finish rather than jumping into pauses.
const TURN_DETECTION = { type: 'semantic_vad', eagerness: 'low' } as const;

type ServerEvent = { type: string; delta?: string; error?: { message?: string } };

export function useRealtimeExaminer(onFinished: (sessionId: string, attemptIds: string[]) => void): LiveExaminer {
  const [status, setStatus] = useState<LiveExaminer['status']>('idle');
  const [phase, setPhase] = useState<Phase>('intro');
  const [caption, setCaption] = useState('');
  const [cueCard, setCueCard] = useState<Prompt>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState<() => void>();
  const [retryLabel, setRetryLabel] = useState<string>();
  const parts = usePartRecorder();
  const r = useRef({
    sessionId: '',
    cueCard: undefined as Prompt | undefined,
    phase: 'intro' as Phase,
    ended: false,
    // After a nudge, wait for the examiner to finish that line: 'nudged' → 'speaking' → run `after`.
    wait: null as null | 'nudged' | 'speaking',
    after: () => {},
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    pc: undefined as RTCPeerConnection | undefined,
    dc: undefined as RTCDataChannel | undefined,
    mic: undefined as MediaStream | undefined,
    audio: undefined as HTMLAudioElement | undefined,
  });

  const prep = useCountdown(PREP_S, { onEnd: () => void go('p2-talk') });
  const talk = useCountdown(TALK_S, { onEnd: () => void go('p2-follow', true) });

  const send = (ev: object) => r.current.dc?.readyState === 'open' && r.current.dc.send(JSON.stringify(ev));
  const detect = (on: boolean) => send({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: on ? TURN_DETECTION : null } } } });
  /** System instruction + a fresh response; cancels whatever the examiner was saying (a real examiner cuts in too). */
  const nudge = (text: string, after?: () => void) => {
    send({ type: 'response.cancel' });
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
    send({ type: 'response.create' });
    r.current.wait = after ? 'nudged' : null;
    r.current.after = after ?? (() => {});
  };

  function close() {
    const c = r.current;
    clearTimeout(c.timer);
    c.dc?.close();
    c.pc?.close();
    c.mic?.getTracks().forEach((t) => t.stop());
    c.audio?.pause();
    c.pc = c.dc = c.mic = undefined;
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
        detect(false);
        nudge('Part 1 is over. Move to Part 2 now: give the Part 2 instructions and the topic, then stay silent while the candidate prepares.', prep.start);
        break;
      case 'p2-talk':
        prep.stop();
        void parts.start(2);
        nudge('The preparation minute is over. Ask the candidate to start speaking now, then stay silent until you are told the talk is over.', talk.start);
        break;
      case 'p2-follow':
        talk.stop();
        await parts.stop();
        detect(true);
        nudge(
          timeUp
            ? `The two minutes are up. Say "Thank you. That's the end of your time." and ask the rounding-off question.`
            : 'The candidate has finished their talk. Say "Thank you." and ask the rounding-off question.',
        );
        break;
      case 'p3': // the model moves from the rounding-off answer into Part 3 by itself
        void parts.start(3);
        c.timer = setTimeout(() => void go('closing'), PART_MS);
        break;
      case 'closing':
        await parts.stop();
        nudge('The test is over. Say the closing line now and nothing more.', () => void finish());
        break;
    }
  }

  function onEvent(ev: ServerEvent) {
    const c = r.current;
    switch (ev.type) {
      case 'response.created':
        setCaption('');
        break;
      case 'response.output_audio_transcript.delta':
        setCaption((t) => t + (ev.delta ?? ''));
        break;
      case 'output_audio_buffer.started':
        if (c.wait === 'nudged') c.wait = 'speaking';
        setStatus('examiner');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        setStatus(c.phase === 'p2-prep' ? 'waiting' : 'candidate');
        if (c.wait === 'speaking') {
          c.wait = null;
          c.after();
        }
        break;
      case 'input_audio_buffer.speech_stopped':
        if (c.phase === 'intro') void go('p1');
        else if (c.phase === 'p2-follow') void go('p3');
        if (c.phase !== 'p2-talk') setStatus('thinking');
        break;
      case 'error':
        // Cancelling when nothing is playing is expected; everything else is logged, the session carries on.
        if (!/no active response|cancel/i.test(ev.error?.message ?? '')) console.warn('realtime', ev.error?.message);
        break;
    }
  }

  async function start() {
    const c = r.current;
    c.audio ??= Object.assign(new Audio(), { autoplay: true });
    setStatus('starting');
    try {
      const st = c.sessionId ? null : await api.post<LiveStarted>('/live/start', {});
      if (st) {
        c.sessionId = st.sessionId;
        c.cueCard = st.test.part2;
      }
      const token = await api.post<{ value: string }>('/live/realtime-token', { sessionId: c.sessionId });
      const pc = new RTCPeerConnection();
      c.pc = pc;
      pc.ontrack = (e) => (c.audio!.srcObject = e.streams[0] ?? null);
      c.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      pc.addTrack(c.mic.getAudioTracks()[0]!, c.mic);
      const dc = pc.createDataChannel('oai-events');
      c.dc = dc;
      dc.onmessage = (e) => onEvent(JSON.parse(e.data as string) as ServerEvent);
      dc.onopen = () => {
        detect(true);
        send({ type: 'response.create' }); // the examiner opens with the introduction
        setStatus('thinking');
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== 'failed' || c.ended) return;
        close();
        setError('The connection to the examiner dropped. The parts you recorded are safe.');
        setRetryLabel('Score what I recorded');
        setRetry(() => () => (setError(undefined), void finish()));
        setStatus('error');
      };
      await pc.setLocalDescription(await pc.createOffer());
      const res = await fetch(CALLS_URL, {
        method: 'POST',
        body: pc.localDescription!.sdp,
        headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/sdp' },
      });
      if (!res.ok) throw new Error('Could not connect to the realtime examiner. Try again, or switch to the turn-based examiner in Settings.');
      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    } catch (e) {
      close();
      const denied = (e as DOMException)?.name === 'NotAllowedError';
      setError(denied ? "Microphone blocked — allow it in the browser's site settings and retry" : e instanceof Error ? e.message : 'Could not start the test.');
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
