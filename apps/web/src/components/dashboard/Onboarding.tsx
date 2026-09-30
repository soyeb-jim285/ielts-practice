import { Link } from '@tanstack/react-router';
import { Mic, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { speakingSession, StartWritingButton } from '@/components/bank/PracticeLink';
import { TargetBandSlider } from '@/components/settings/TargetBandSlider';
import { buttonStyles, Card } from '@/components/ui';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-4 py-5 first:pt-0 last:pb-0">
      <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text tabular-nums" aria-hidden>
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="mt-1.5 space-y-4 text-sm text-muted">{children}</div>
      </div>
    </li>
  );
}

/** First-run dashboard: three steps to a first predicted band. */
export function Onboarding() {
  return (
    <Card className="sm:p-7">
      <h2 className="text-lg font-semibold">Three steps to your first predicted band</h2>
      <p className="mt-1 text-sm text-muted">Each answer is scored against the public IELTS band descriptors, with feedback you can act on.</p>
      <ol className="mt-6 divide-y divide-line">
        <Step n={1} title="Set your target band">
          <p>Scores at or above it show green. You can change it any time in Settings.</p>
          <div className="max-w-sm text-ink">
            <TargetBandSlider />
          </div>
        </Step>
        <Step n={2} title="Answer a few Part 1 questions">
          <p>About 4 minutes of everyday questions. You'll get fluency, vocabulary, grammar and pronunciation feedback.</p>
          <Link {...speakingSession('p1')} className={buttonStyles()}>
            <Mic aria-hidden /> Try Speaking Part 1
          </Link>
        </Step>
        <Step n={3} title="Write a Task 2 essay">
          <p>40 minutes, at least 250 words. Every mistake is marked in your text with a correction.</p>
          <StartWritingButton variant="secondary" icon={<PenLine />}>
            Try Writing Task 2
          </StartWritingButton>
        </Step>
      </ol>
    </Card>
  );
}
