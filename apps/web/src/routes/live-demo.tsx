import type { Prompt } from '@server/routes/prompts';
import { createFileRoute } from '@tanstack/react-router';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LiveStage } from '@/components/live/LiveStage';
import { Button, Switch } from '@/components/ui';
import { cn } from '@/lib/utils';
import { PREP_S, TALK_S, type LiveExaminer, type Phase } from '@/live/turn';

// A simulated live test for checking the live screen and its animations: no server, no microphone. The examiner's voice is a synthetic buzz
// (so the bars have real audio to follow); your voice is a made-up level. Prep and talk minutes run ten times faster.
export const Route = createFileRoute('/live-demo')({ staticData: { exam: true }, component: LiveDemo });

const CARD = { title: 'Describe a book you enjoyed reading.', body: 'Describe a book you enjoyed reading.', bullets: ['what the book was', 'when you read it', 'what it was about', 'and explain why you enjoyed it'] } as unknown as Prompt;
type Step = { label: string; status: LiveExaminer['status']; phase: Phase; ms: number; caption?: string; card?: boolean; prep?: boolean; talk?: boolean };
const STEPS: Step[] = [
  { label: 'Connecting', status: 'starting', phase: 'intro', ms: 2500 },
  { label: 'Examiner greets', status: 'examiner', phase: 'intro', ms: 4000, caption: "Good evening. My name's Robin, and I'll be your examiner today. Can you tell me your full name, please?" },
  { label: 'You answer', status: 'candidate', phase: 'intro', ms: 3500 },
  { label: 'Examiner thinks', status: 'thinking', phase: 'intro', ms: 1500 },
  { label: 'Part 1 question', status: 'examiner', phase: 'p1', ms: 4000, caption: "Thank you. Now, in this first part, I'd like to ask you some questions about yourself. Let's talk about where you live." },
  { label: 'You answer', status: 'candidate', phase: 'p1', ms: 5000 },
  { label: 'Examiner thinks', status: 'thinking', phase: 'p1', ms: 1200 },
  { label: 'Part 2 instructions', status: 'examiner', phase: 'p2-prep', ms: 5000, caption: "Now, I'm going to give you a topic, and I'd like you to talk about it for one to two minutes. Here is your topic." },
  { label: 'Preparation minute', status: 'waiting', phase: 'p2-prep', ms: PREP_S * 100, card: true, prep: true },
  { label: 'Examiner: start talking', status: 'examiner', phase: 'p2-talk', ms: 3000, card: true, caption: "All right? Remember you have one to two minutes for this. Please start speaking now." },
  { label: 'Your long turn', status: 'candidate', phase: 'p2-talk', ms: TALK_S * 100, card: true, talk: true },
  { label: 'Rounding-off question', status: 'examiner', phase: 'p2-follow', ms: 3500, caption: 'Thank you. Do you often read books?' },
  { label: 'You answer', status: 'candidate', phase: 'p2-follow', ms: 3000 },
  { label: 'Part 3 question', status: 'examiner', phase: 'p3', ms: 4500, caption: "We've been talking about a book you enjoyed. Why do you think some people prefer e-books to printed books?" },
  { label: 'You answer', status: 'candidate', phase: 'p3', ms: 6000 },
  { label: 'Closing', status: 'examiner', phase: 'closing', ms: 3000, caption: 'Thank you. That is the end of the speaking test.' },
  { label: 'Uploading', status: 'finishing', phase: 'done', ms: 3000 },
];

/** A synthetic examiner voice: a buzz through a formant filter, chopped into syllables while `on`. Silent unless `audible`. */
function useSyntheticVoice(on: boolean, audible: boolean) {
  const [stream, setStream] = useState<MediaStream>();
  const nodes = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode; out: GainNode } | null>(null);
  const start = () => {
    if (nodes.current) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), formant = ctx.createBiquadFilter(), gain = ctx.createGain(), out = ctx.createGain(), dest = ctx.createMediaStreamDestination();
    osc.type = 'sawtooth';
    osc.frequency.value = 140;
    formant.type = 'bandpass';
    formant.frequency.value = 900;
    formant.Q.value = 1.2;
    gain.gain.value = 0;
    out.gain.value = 0;
    osc.connect(formant).connect(gain);
    gain.connect(dest);
    gain.connect(out).connect(ctx.destination);
    osc.start();
    nodes.current = { ctx, osc, gain, out };
    setStream(dest.stream);
  };
  useEffect(() => {
    const n = nodes.current;
    if (n) n.out.gain.value = audible ? 0.15 : 0;
  }, [audible]);
  useEffect(() => {
    const n = nodes.current;
    if (!n || !on) return;
    const syllable = () => {
      const t = n.ctx.currentTime, len = 0.1 + Math.random() * 0.16;
      n.osc.frequency.setValueAtTime(110 + Math.random() * 70, t);
      n.gain.gain.cancelScheduledValues(t);
      n.gain.gain.setTargetAtTime(0.35 + Math.random() * 0.5, t, 0.02);
      n.gain.gain.setTargetAtTime(Math.random() < 0.15 ? 0 : 0.05, t + len, 0.04); // now and then a word gap
    };
    const id = setInterval(syllable, 170);
    return () => {
      clearInterval(id);
      n.gain.gain.setTargetAtTime(0, n.ctx.currentTime, 0.05);
    };
  }, [on]);
  useEffect(() => () => void nodes.current?.ctx.close().catch(() => {}), []);
  return { stream, start };
}

/** A made-up microphone level while you "speak": bursts of words with short pauses. */
function useFakeLevel(on: boolean) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!on) return void setLevel(0);
    let v = 0, pause = 0;
    const id = setInterval(() => {
      if (pause > 0) pause--;
      else if (Math.random() < 0.05) pause = 4 + Math.floor(Math.random() * 6);
      v += ((pause ? 0.02 : 0.25 + Math.random() * 0.45) - v) * 0.5;
      setLevel(v);
    }, 80);
    return () => clearInterval(id);
  }, [on]);
  return level;
}

function LiveDemo() {
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hear, setHear] = useState(false);
  const [open, setOpen] = useState(true);
  const [elapsed, setElapsed] = useState(0); // ms into the current step
  const at = useRef(0); // the same, for the timer (kept across pause and resume, reset on a new step)
  const step = STEPS[i]!;
  const voice = useSyntheticVoice(started && step.status === 'examiner', hear);
  const level = useFakeLevel(started && step.status === 'candidate');

  useEffect(() => {
    at.current = 0;
    setElapsed(0);
  }, [i]);
  useEffect(() => {
    if (!started || !playing) return;
    const t0 = Date.now() - at.current;
    const id = setInterval(() => {
      at.current = Date.now() - t0;
      if (at.current >= step.ms) setI((n) => (n + 1) % STEPS.length);
      else setElapsed(at.current);
    }, 100);
    return () => clearInterval(id);
  }, [started, playing, i]);

  const left = (s: number) => Math.max(0, Math.ceil(s - (elapsed / step.ms) * s));
  const ex: LiveExaminer = {
    status: started ? step.status : 'idle',
    phase: step.phase,
    caption: step.caption ?? '',
    cueCard: step.card ? CARD : undefined,
    prepLeft: step.prep ? left(PREP_S) : PREP_S,
    talkLeft: step.talk ? left(TALK_S) : TALK_S,
    talkRunning: !!step.talk,
    level,
    voice: voice.stream,
    endTurn: step.talk ? () => setI((n) => n + 1) : null,
    start: async () => {},
    end: async () => setI(STEPS.length - 1),
  };

  return (
    <>
      <LiveStage ex={ex} />
      <aside
        aria-label="Demo controls"
        className={cn(
          'fixed right-[max(1rem,env(safe-area-inset-right,0px))] z-50 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface shadow-lg',
          // hidden: a pill at the top, clear of the live screen's pinned "I'm done" bar
          open || !started ? 'bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] p-3' : 'top-[calc(4rem+env(safe-area-inset-top,0px))] p-1',
        )}
      >
        {started && !open ? (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
            Show demo controls · {step.label}
          </Button>
        ) : !started ? (
          <div className="space-y-2">
            <p className="type-caption">A simulated test: no server, no microphone. Prep and talk run ten times faster.</p>
            <Button className="w-full" icon={<Play />} onClick={() => (voice.start(), setStarted(true))}>
              Start the demo
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="Previous step" onClick={() => setI((n) => Math.max(0, n - 1))}>
                <SkipBack />
              </Button>
              <Button variant="ghost" size="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button variant="ghost" size="icon" aria-label="Next step" onClick={() => setI((n) => (n + 1) % STEPS.length)}>
                <SkipForward />
              </Button>
              <span className="type-caption ml-1 min-w-0 flex-1 truncate">
                {i + 1}/{STEPS.length} · {step.label}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Hide
              </Button>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-brand" style={{ width: `${Math.min(100, (elapsed / step.ms) * 100)}%` }} />
            </div>
            <ol className="max-h-40 space-y-0.5 overflow-y-auto">
              {STEPS.map((s, k) => (
                <li key={k}>
                  <button type="button" onClick={() => setI(k)} className={cn('w-full rounded px-2 py-1 text-left text-sm hover:bg-hover', k === i && 'bg-accent-soft font-medium text-accent-text')}>
                    {s.label}
                  </button>
                </li>
              ))}
            </ol>
            <Switch label="Hear the examiner" description="Plays the synthetic voice the bars follow." checked={hear} onChange={setHear} />
          </div>
        )}
      </aside>
    </>
  );
}
