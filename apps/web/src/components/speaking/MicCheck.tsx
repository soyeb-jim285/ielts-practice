import { clsx } from 'clsx';
import { Mic } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { useRecorder } from '@/hooks/useRecorder';
import { micVerdict, tallyMic, type MicTally } from '@/hooks/useVad';
import { MicProblem } from './MicProblem';

const NONE: MicTally = { loud: 0, soft: 0 };
const VERDICT = {
  listening: { text: 'Say a few words, like your name…', cls: 'text-muted', bar: 'bg-accent' },
  quiet: { text: 'Very quiet — move closer to the microphone or speak up.', cls: 'font-medium text-warn-text', bar: 'bg-warn' },
  clear: { text: 'We can hear you clearly.', cls: 'font-medium text-good-text', bar: 'bg-good' },
};

/** Test button, then a live level meter that only says "clearly" after ~1 s of speech-level input. `mic` is the caller's recorder. */
export function MicCheck({ mic }: { mic: ReturnType<typeof useRecorder> }) {
  const live = mic.state === 'recording';
  const [tally, setTally] = useState(NONE);
  // One step per 50 ms recorder frame (elapsedMs changes every frame); a new test starts from zero.
  useEffect(() => {
    setTally((t) => (live ? tallyMic(t, mic.level) : NONE));
  }, [live, mic.elapsedMs]);
  const v = VERDICT[micVerdict(tally)];

  return (
    <>
      {live ? (
        <div className="space-y-2">
          <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mic.level * 100)} className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <div className={clsx('h-full transition-[width] duration-75', v.bar)} style={{ width: `${Math.min(100, mic.level * 180)}%` }} />
          </div>
          <p className={clsx('text-sm', v.cls)} aria-live="polite">
            {v.text}
          </p>
        </div>
      ) : (
        <Button variant="secondary" icon={<Mic />} onClick={() => void mic.start()} loading={mic.state === 'requesting'}>
          Test microphone
        </Button>
      )}
      <MicProblem state={mic.state} error={mic.error} onRetry={() => void mic.start()} />
    </>
  );
}
