import type { CriterionKey } from '@server/ai/types';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { speakingSession, StartWritingButton } from '@/components/bank/PracticeLink';
import { ActionRow, Section } from '@/components/result';
import { Button, buttonStyles, Card } from '@/components/ui';
import { useCurrentMock } from '@/components/mock/useMock';
import { SKILL_LABEL } from '@/lib/mock';
import { formatBand, plural } from '@/lib/format';
import { criterionLabel } from '@/lib/result';
import { CRITERION_SHORT, practiceTarget, type Progress } from './criteria';
import { useStartLr, type LrData } from './LrInsights';

const linkStyles = 'font-medium text-accent-text underline underline-offset-4 hover:no-underline';

/**
 * The one action the page asks for, in the one tinted surface. Priority: an open mock, then your weakest criterion, then a suggested Listening or Reading test, then a full speaking test.
 * Secondary text links: the review deck when cards are due, and the mock when it is not the main action.
 */
export function NextUp({ p, target, due, lr }: { p: Progress; target: number; due: number; lr?: LrData }) {
  const mock = useCurrentMock().data;
  const { start, busy } = useStartLr();
  const weakest = p.weakest && CRITERION_SHORT[p.weakest.key as CriterionKey] ? (p.weakest as { key: CriterionKey; avg: number; skill?: 'speaking' | 'writing' }) : null;
  const practice = weakest ? practiceTarget(weakest.key, p.trend, weakest.skill) : null;
  const avg = weakest ? Math.round(weakest.avg * 2) / 2 : 0;
  const suggested = !weakest ? lr?.suggested : null;

  let headline: string, lede: string, primary: React.ReactNode;
  if (mock) {
    headline = 'Continue your mock test';
    lede = `${mock.next ? `${SKILL_LABEL[mock.next]} next` : 'Open'}. Pick up where you stopped.`;
    primary = (
      <Link to="/mock/$id" params={{ id: mock.id }} className={buttonStyles({ size: 'lg' })}>
        Continue <ArrowRight aria-hidden />
      </Link>
    );
  } else if (weakest && practice) {
    const cta = `Practise ${practice.label} ${CRITERION_SHORT[weakest.key].toLowerCase()}`;
    headline = `${criterionLabel(weakest.key)} is holding your band back`;
    lede = `You average ${formatBand(avg)} here${avg < target ? `, ${formatBand(target - avg)} below your ${formatBand(target)} target` : ''}, and your lowest scores came in ${practice.label}. Focused practice there moves it fastest.`;
    primary =
      practice.skill === 'writing' ? (
        <StartWritingButton task={practice.part === 1 ? 1 : 2} size="lg" icon={<ArrowRight />}>
          {cta}
        </StartWritingButton>
      ) : (
        <Link {...speakingSession(`p${practice.part}` as 'p1' | 'p2' | 'p3')} className={buttonStyles({ size: 'lg' })}>
          {cta} <ArrowRight aria-hidden />
        </Link>
      );
  } else if (suggested) {
    headline = `${suggested.label} is your weakest question type`;
    lede = `${suggested.title} has ${suggested.count} ${suggested.label.toLowerCase()} questions. Practising them is the fastest way up.`;
    primary = (
      <Button size="lg" loading={busy} onClick={() => void start(suggested.id)}>
        Practise {suggested.label.toLowerCase()} <ArrowRight aria-hidden />
      </Button>
    );
  } else {
    headline = 'Ready for another round?';
    lede = 'A full test gives the most complete picture of your band.';
    primary = (
      <Link {...speakingSession('full')} className={buttonStyles({ size: 'lg' })}>
        Start a full speaking test <ArrowRight aria-hidden />
      </Link>
    );
  }

  const links = [
    due > 0 && (
      <Link key="r" to="/review" className={linkStyles}>
        Review deck, {plural(due, 'card')} due
      </Link>
    ),
  ].filter(Boolean);

  return (
    <Section title="Next up" id="next">
      <Card tone="hero" className="space-y-6 sm:p-7">
        <div className="space-y-2">
          <h3 className="type-subheading">{headline}</h3>
          <p className="type-lede max-w-[68ch]">{lede}</p>
        </div>
        <ActionRow primary={primary} links={links as React.ReactNode[]} />
      </Card>
    </Section>
  );
}
