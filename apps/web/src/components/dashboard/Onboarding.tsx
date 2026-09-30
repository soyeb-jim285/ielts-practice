import { Link } from '@tanstack/react-router';
import { Mic, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { speakingSession, StartWritingButton } from '@/components/bank/PracticeLink';
import { TargetBandSlider } from '@/components/settings/TargetBandSlider';
import { buttonStyles, Card } from '@/components/ui';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-4 py-5 first:pt-0 last:pb-0">
      <span className="grid size-8 place-items-center rounded-full bg-card text-sm font-semibold text-brand-text tabular-nums ring-1 ring-brand/25" aria-hidden>
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="text-base leading-8 font-semibold">{title}</h3>
        <div className="space-y-4 text-[0.9375rem] text-ink/75 [&_p]:max-w-[60ch]">{children}</div>
      </div>
    </li>
  );
}

/** First-run dashboard hero: three steps to a first predicted band. One primary action at a time (step 2), step 3 is secondary. */
export function Onboarding() {
  return (
    <Card tone="hero" className="sm:p-6">
      <h2 className="text-lg font-semibold text-balance">Three steps to your first predicted band</h2>
      <p className="mt-1 max-w-[60ch] text-[0.9375rem] text-ink/75">Each answer is scored against the public IELTS band descriptors, with feedback you can act on.</p>
      <ol className="mt-6 divide-y divide-brand/15">
        <Step n={1} title="Set your target band">
          <p>Scores at or above it show green. You can change it any time in Settings.</p>
          <div className="max-w-sm text-ink">
            <TargetBandSlider />
          </div>
        </Step>
        <Step n={2} title="Answer a few Part 1 questions">
          <p>About 4 minutes of everyday questions. You'll get fluency, vocabulary, grammar and pronunciation feedback.</p>
          <Link {...speakingSession('p1')} className={buttonStyles({ className: 'max-sm:w-full' })}>
            <Mic aria-hidden /> Try Speaking Part 1
          </Link>
        </Step>
        <Step n={3} title="Write a Task 2 essay">
          <p>40 minutes, at least 250 words. Every mistake is marked in your text with a correction.</p>
          <StartWritingButton variant="secondary" icon={<PenLine />} className="max-sm:w-full">
            Try Writing Task 2
          </StartWritingButton>
        </Step>
      </ol>
    </Card>
  );
}
