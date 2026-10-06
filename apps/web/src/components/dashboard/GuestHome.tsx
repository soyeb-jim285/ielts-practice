import { Link } from '@tanstack/react-router';
import { ArrowRight, ClipboardCheck, Layers, LibraryBig, MessagesSquare, Mic, PenLine, type LucideIcon } from 'lucide-react';
import { listStyles, RowChevron, RowIcon, rowStyles, RowText } from '@/components/bank/ListRow';
import { speakingSession, StartWritingButton } from '@/components/bank/PracticeLink';
import { GuestRecent } from '@/components/dashboard/GuestRecent';
import { QuotaStrip } from '@/components/community/QuotaNote';
import { CriteriaStrip, ScoreHero, Section, SkillBandStrip, type SkillBandItem } from '@/components/result';
import { Badge, buttonStyles, PageContainer, PageHeader } from '@/components/ui';

const link = 'font-medium text-accent-text underline underline-offset-4 hover:no-underline';

const SKILLS: SkillBandItem[] = [
  { skill: 'listening', band: null, to: { to: '/listening' }, offer: 'Unlimited free practice tests, 40 questions or one part, marked at once with a band' },
  { skill: 'reading', band: null, to: { to: '/reading' }, offer: 'Unlimited free practice tests, 40 questions or one passage, marked at once with a band' },
  { skill: 'writing', band: null, to: { to: '/writing' }, offer: 'Task 1 and Task 2, feedback by criterion' },
  { skill: 'speaking', band: null, to: { to: '/speaking' }, offer: 'Full test 11-14 min, or one part; live examiner with your own key' },
];

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Mic, title: 'Speaking test', body: 'All three parts, recorded. Four criteria scored, with your pauses timed in the transcript.' },
  { icon: MessagesSquare, title: 'Live examiner', body: 'A spoken conversation: an AI examiner asks, listens and follows up. Runs on your own API key.' },
  { icon: PenLine, title: 'Writing marked by criterion', body: 'Timed tasks marked against the public band descriptors, each mistake underlined and corrected.' },
  { icon: Layers, title: 'Fix what you repeat', body: 'The mistake log groups the errors you repeat. The review deck turns corrections into flashcards that return just before you forget.' },
];

const MOCK_EXAMPLE: SkillBandItem[] = [
  { skill: 'listening', band: 7.5, target: 7 },
  { skill: 'reading', band: 6.5, target: 7 },
  { skill: 'writing', band: 7, target: 7 },
  { skill: 'speaking', band: 7, target: 7 },
];

// Illustration only: fixed numbers that show the layout of a result, never a real score.
const EXAMPLE = [
  { key: 'fc', label: 'Fluency and coherence', band: 6.5 },
  { key: 'lr', label: 'Lexical resource', band: 7 },
  { key: 'gra', label: 'Grammatical range and accuracy', band: 6 },
  { key: 'p', label: 'Pronunciation', band: 6.5 },
];

/** Dashboard for a signed-out visitor: the four skills and the mock, an example result (labelled) built from the same components as the signed-in page, and the pages open without an account. */
export function GuestHome() {
  return (
    <PageContainer>
      <PageHeader
        className="mb-6 md:mb-6"
        title="Practise all four IELTS skills"
        description="Listening, Reading, Writing and Speaking, plus a full mock test. Free to try, no account. Timed practice with a band for every criterion, and each mistake marked exactly where you made it."
      />
      <div className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-3 md:mb-12">
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link {...speakingSession('p1')} className={buttonStyles({ size: 'lg', className: 'h-11 sm:h-10' })}>
            Try a speaking test
          </Link>
          <StartWritingButton variant="outline" size="lg" className="h-11 sm:h-10">
            Try a writing test
          </StartWritingButton>
        </div>
        <Link to="/listening" className={`type-body inline-flex min-h-11 items-center ${link}`}>
          Take a free Listening or Reading test
        </Link>
      </div>

      <div className="space-y-8 md:space-y-12">
        <GuestRecent />

        <Section title="Four skills, one mock test" id="skills">
          <SkillBandStrip variant="guest" items={SKILLS} />
          <ul className={listStyles}>
            <li>
            <Link to="/mock" className={rowStyles}>
            <RowIcon>
              <ClipboardCheck />
            </RowIcon>
            <RowText title="Full mock test" meta="All four back to back, overall band at the end" />
            <RowChevron />
            </Link>
            </li>
            <li>
            <Link to="/bank" className={rowStyles}>
            <RowIcon>
              <LibraryBig />
            </RowIcon>
            <RowText title="Prompt bank" meta="Browse every question and task, no account needed" />
            <RowChevron />
            </Link>
            </li>
          </ul>
        </Section>

        <Section title="What a result looks like" id="example" caption="After each attempt you see the band for every criterion, then the exact words behind it.">
          <div role="group" aria-label="Example full mock result, not a real score" className="space-y-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="type-subheading">Full mock test</h3>
              <Badge>Example, not a real score</Badge>
            </div>
            <ScoreHero value={7} label="Example mock overall band" secondary="Mean of four sections" />
            <SkillBandStrip items={MOCK_EXAMPLE} />
          </div>
          <div role="group" aria-label="Example speaking result, not a real score" className="space-y-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="type-subheading">Speaking, Part 2</h3>
              <Badge>Example, not a real score</Badge>
            </div>
            <ScoreHero value={6.5} label="Example Speaking Part 2 band" secondary="Speaking, Part 2" />
            <CriteriaStrip items={EXAMPLE.map((c) => ({ ...c, target: 7 }))} />
          </div>
        </Section>

        <Section title="Free to try" id="free">
          <p className="type-lede max-w-[60ch]">One speaking test and one writing test a week, paid from a balance the community shares. Create an account for one of each a day, or add your own key for unlimited tests and the live examiner. Listening and Reading are unlimited.</p>
          <QuotaStrip className="border-0 py-0" />
          <p className="type-body flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>History, mistakes and the review deck need an account.</span>
            <Link to="/signup" className={`inline-flex min-h-11 items-center gap-1 ${link}`}>
              Create one <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to="/login" className={`inline-flex min-h-11 items-center ${link}`}>
              Sign in
            </Link>
          </p>
        </Section>

        <Section title="What you get" id="features">
          <ul className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="space-y-2">
                <Icon className="size-5 text-muted" aria-hidden />
                <h3 className="type-subheading mt-3">{title}</h3>
                <p className="type-lede">{body}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </PageContainer>
  );
}
