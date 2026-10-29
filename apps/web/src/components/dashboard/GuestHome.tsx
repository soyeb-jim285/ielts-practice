import { bdt, PAID_PLANS } from '@ielts/core';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ClipboardCheck, LibraryBig } from 'lucide-react';
import { listStyles, RowChevron, RowIcon, rowStyles, RowText } from '@/components/bank/ListRow';
import { speakingSession, StartWritingButton } from '@/components/bank/PracticeLink';
import { QuotaStrip } from '@/components/community/QuotaNote';
import { GuestRecent } from '@/components/dashboard/GuestRecent';
import { FREE, PlanCards } from '@/components/pricing/Plans';
import { CriteriaStrip, ScoreHero, Section, SkillBandStrip, type SkillBandItem } from '@/components/result';
import { Badge, buttonStyles, Card, PageContainer } from '@/components/ui';

const link = 'font-medium text-accent-text underline underline-offset-4 hover:no-underline';

const SKILLS: SkillBandItem[] = [
  { skill: 'listening', band: null, to: { to: '/listening' }, offer: 'Full 40-question tests or one part, marked at once with a band. Free.' },
  { skill: 'reading', band: null, to: { to: '/reading' }, offer: 'Academic and General Training, with where each answer sits in the passage. Free.' },
  { skill: 'writing', band: null, to: { to: '/writing' }, offer: 'Task 1 and Task 2, marked by criterion, every mistake corrected.' },
  { skill: 'speaking', band: null, to: { to: '/speaking' }, offer: 'A live AI examiner, or recorded parts you can replay.' },
];

// Illustration only: fixed numbers that show the layout of a result, never a real score.
const EXAMPLE = [
  { key: 'fc', label: 'Fluency and coherence', band: 6.5, target: 7 },
  { key: 'lr', label: 'Lexical resource', band: 7, target: 7 },
  { key: 'gra', label: 'Grammar', band: 6, target: 7 },
  { key: 'p', label: 'Pronunciation', band: 6.5, target: 7 },
];

const STEPS = [
  { title: 'Take a timed test', body: 'The same parts, timings and question types as the real exam, on your laptop or phone.' },
  { title: 'See exactly where the band went', body: 'A band for each criterion against the public descriptors, and every mistake underlined in your own words with the fix beside it.' },
  { title: 'Fix what you repeat', body: 'Your mistakes are grouped across tests, turned into review cards, and your coach tells you what to work on this week.' },
];

/** The example result that stands in for a product shot: built from the same components as a real result page. */
function ExampleResult() {
  return (
    <Card role="group" aria-label="Example Speaking result, not a real score" className="space-y-6 p-6 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-subheading">Speaking, Part 2</h2>
        <Badge>Example result</Badge>
      </div>
      <ScoreHero value={6.5} label="Example Speaking band" secondary="Target 7" />
      <CriteriaStrip cols={2} items={EXAMPLE} />
      <figure className="rounded-lg bg-surface-2 p-4">
        <figcaption className="type-caption">From your answer, 0:42</figcaption>
        <p className="type-reading-sm mt-2 text-ink">
          Last summer I{' '}
          <del className="text-bad-text decoration-bad decoration-2">have visited</del>{' '}
          <ins className="rounded-sm bg-good-soft px-1 text-good-text no-underline">visited</ins> my grandmother in Sylhet.
        </p>
        <p className="type-caption mt-2">A finished time in the past takes the past simple.</p>
      </figure>
    </Card>
  );
}

/** Home for a signed-out visitor or a guest: what NextBand does, a free test one click away, and the paid plans in BDT. Built from the same components as the signed-in pages. */
export function GuestHome() {
  return (
    <PageContainer>
      <div className="grid items-center gap-10 pt-2 pb-12 md:pb-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14">
        <div className="stagger">
          <h1 className="type-display max-w-[16ch] text-balance">Know your IELTS band before test day</h1>
          <p className="type-lede mt-5 max-w-[52ch] text-pretty">
            Timed Listening, Reading, Writing and Speaking tests, marked against the band descriptors. You see every mistake where you made it, with the fix.
          </p>
          <div className="mt-8 flex flex-col gap-2 sm:flex-row">
            <Link {...speakingSession('p1')} className={buttonStyles({ size: 'lg', className: 'h-11' })}>
              Take a free Speaking test
            </Link>
            <StartWritingButton variant="outline" size="lg" className="h-11">
              Try a Writing task
            </StartWritingButton>
          </div>
          <p className="type-caption mt-4">
            Free to start: no account, no card.{' '}
            <Link to="/listening" className={link}>
              Listening and Reading tests are free
            </Link>
            .
          </p>
        </div>
        <div className="animate-[rise-in_var(--dur-slow)_var(--ease-out-expo)_120ms_backwards]">
          <ExampleResult />
        </div>
      </div>

      <div className="space-y-12 md:space-y-16">
        <GuestRecent />

        <Section title="Start with a free test" id="skills">
          <SkillBandStrip variant="guest" items={SKILLS} />
          <ul className={listStyles}>
            <li>
              <Link to="/mock" className={rowStyles}>
                <RowIcon>
                  <ClipboardCheck />
                </RowIcon>
                <RowText title="Full mock test" meta="All four skills back to back, with an overall band at the end" />
                <RowChevron />
              </Link>
            </li>
            <li>
              <Link to="/bank" className={rowStyles}>
                <RowIcon>
                  <LibraryBig />
                </RowIcon>
                <RowText title="Question bank" meta="Every Speaking topic and Writing task, open without an account" />
                <RowChevron />
              </Link>
            </li>
          </ul>
        </Section>

        <Section title="How it works" id="how">
          <ol className="grid gap-x-10 gap-y-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="space-y-2">
                <span aria-hidden className="font-serif text-3xl leading-none text-accent-text">
                  {i + 1}
                </span>
                <h3 className="type-subheading pt-2">{s.title}</h3>
                <p className="type-lede">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section title={`Free, or unlimited from ${bdt(PAID_PLANS.month.bdt)} a month`} id="plans" caption="Prices in BDT. One payment, no auto-renewal. Pay with bKash, Nagad, Rocket, Upay or card.">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)] lg:gap-10">
            <div>
              <h3 className="type-heading">Free</h3>
              <p className="type-lede mt-2">With a free account you get:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm marker:text-accent">
                {FREE.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="type-caption mt-4">As a guest you can already try a few tests. Your tests left:</p>
              <QuotaStrip className="mt-2 border-0 py-0" />
              <Link to="/signup" className={buttonStyles({ variant: 'outline', className: 'mt-5 w-full sm:w-auto' })}>
                Create a free account
              </Link>
            </div>
            <PlanCards />
          </div>
          <p className="type-body">
            <Link to="/pricing" className={`inline-flex min-h-11 items-center gap-1 ${link}`}>
              Pricing, refunds and delivery <ArrowRight className="size-4" aria-hidden />
            </Link>
          </p>
        </Section>

        <Card tone="hero" className="flex flex-col items-start gap-5 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <h2 className="type-title-sm text-balance">Your first test is free</h2>
            <p className="type-lede mt-2 max-w-[52ch]">Fifteen minutes, and you will know which criterion is holding your band back.</p>
          </div>
          <Link {...speakingSession('p1')} className={buttonStyles({ size: 'lg', className: 'h-11 shrink-0 max-md:w-full' })}>
            Start now
          </Link>
        </Card>
      </div>
    </PageContainer>
  );
}
