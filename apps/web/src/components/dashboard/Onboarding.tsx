import { Link } from '@tanstack/react-router';
import { ArrowRight, Mic, PenLine } from 'lucide-react';
import { speakingSession, StartWritingButton } from '@/components/bank/PracticeLink';
import { TargetBandSlider } from '@/components/settings/TargetBandSlider';
import { buttonStyles, Card } from '@/components/ui';

/**
 * First-run dashboard: one title, the two ways to get a first band as asymmetric tiles (speaking is the primary one, the only tinted block),
 * and the target band as a compact control underneath. No steps, no numbers.
 */
export function Onboarding() {
  return (
    <section aria-labelledby="first-h">
      <h2 id="first-h" className="type-heading">
        Get your first band
      </h2>
      <p className="type-lede mt-1.5 max-w-[56ch]">Answer once and every criterion is scored against the public IELTS band descriptors, with each mistake marked where you made it.</p>

      <div className="stagger mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card tone="hero" className="flex flex-col justify-between gap-10 sm:p-7">
          <div>
            <Mic className="size-5 text-accent-text" aria-hidden />
            <h3 className="type-title-sm mt-4">Speak for four minutes</h3>
            <p className="type-lede mt-3 max-w-[46ch]">Part 1 is everyday questions. You get fluency, vocabulary, grammar and pronunciation feedback, with your pauses timed.</p>
          </div>
          <Link {...speakingSession('p1')} className={buttonStyles({ size: 'lg', className: 'w-fit max-sm:w-full' })}>
            Start Speaking Part 1 <ArrowRight aria-hidden />
          </Link>
        </Card>

        <Card className="flex flex-col justify-between gap-10 sm:p-7">
          <div>
            <PenLine className="size-5 text-muted" aria-hidden />
            <h3 className="type-heading mt-4">Or write an essay</h3>
            <p className="type-lede mt-3">Task 2, 40 minutes, at least 250 words. Every mistake is underlined in your text with a correction.</p>
          </div>
          <StartWritingButton variant="outline" size="lg" className="w-fit max-sm:w-full">
            Start Writing Task 2
          </StartWritingButton>
        </Card>
      </div>

      <div className="mt-8 grid items-center gap-x-10 gap-y-4 border-t border-line pt-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <p className="type-caption max-w-[52ch]">Scores at or above your target band show green. You can change it any time in Settings.</p>
        <TargetBandSlider />
      </div>
    </section>
  );
}
