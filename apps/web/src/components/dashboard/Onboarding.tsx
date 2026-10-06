import { Link } from '@tanstack/react-router';
import { ArrowRight, Mic, PenLine } from 'lucide-react';
import { speakingSession, StartWritingButton } from '@/components/bank/PracticeLink';
import { Section } from '@/components/result';
import { TargetBandSlider } from '@/components/settings/TargetBandSlider';
import { buttonStyles, Card } from '@/components/ui';

/**
 * First-run dashboard: the two ways to get a first band (speaking is the primary one, the only tinted block, the essay sits beside it on the plain page),
 * a text link to the unlimited Listening and Reading tests, and the target band as a compact control underneath. No steps, no numbers.
 */
export function Onboarding() {
  return (
    <Section title="Get your first band" id="first" caption="Answer once and every criterion is scored against the public IELTS band descriptors, with each mistake marked where you made it.">
      <div className="stagger grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card tone="hero" className="flex flex-col justify-between gap-8 sm:p-7">
          <div className="space-y-2">
            <Mic className="size-5 text-accent-text" aria-hidden />
            <h3 className="type-subheading pt-2">Speak for four minutes</h3>
            <p className="type-lede max-w-[46ch]">Part 1 is everyday questions. You get fluency, vocabulary, grammar and pronunciation feedback, with your pauses timed.</p>
          </div>
          <Link {...speakingSession('p1')} className={buttonStyles({ size: 'lg', className: 'w-fit max-sm:w-full' })}>
            Start Speaking Part 1 <ArrowRight aria-hidden />
          </Link>
        </Card>

        <div className="flex flex-col justify-between gap-8 lg:py-7">
          <div className="space-y-2">
            <PenLine className="size-5 text-muted" aria-hidden />
            <h3 className="type-subheading pt-2">Or write an essay</h3>
            <p className="type-lede max-w-[46ch]">Task 2, 40 minutes, at least 250 words. Every mistake is underlined in your text with a correction.</p>
          </div>
          <StartWritingButton variant="outline" size="lg" className="w-fit max-sm:w-full">
            Start Writing Task 2
          </StartWritingButton>
        </div>
      </div>

      <p className="type-body">
        <Link to="/listening" className="font-medium text-accent-text underline underline-offset-4 hover:no-underline">Or take a free Listening or Reading test</Link>
      </p>

      <div className="grid items-center gap-x-10 gap-y-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <p className="type-caption max-w-[52ch]">Scores at or above your target band show green. You can change it any time in Settings.</p>
        <TargetBandSlider />
      </div>
    </Section>
  );
}
