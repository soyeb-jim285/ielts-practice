import { Link } from '@tanstack/react-router';
import { ArrowRight, Layers, LibraryBig, MessagesSquare, Mic, PenLine, TriangleAlert, type LucideIcon } from 'lucide-react';
import { listStyles, PanelHeader, RowChevron, RowIcon, rowStyles, RowText } from '@/components/bank/ListRow';
import { Badge, buttonStyles, Card, PageContainer, PageHeader, ProgressBar } from '@/components/ui';
import { formatBand } from '@/lib/format';

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Mic, title: 'Speaking test', body: 'All three parts, recorded. Fluency, vocabulary, grammar and pronunciation are scored, with your pauses timed in the transcript.' },
  { icon: MessagesSquare, title: 'Live examiner', body: 'A spoken conversation: an AI examiner asks, listens and follows up on what you say.' },
  { icon: PenLine, title: 'Writing Task 1 and 2', body: 'Timed tasks marked against the public band descriptors, with each mistake underlined and corrected.' },
  { icon: TriangleAlert, title: 'Mistake log', body: 'The errors you repeat, grouped, so you know what to fix first.' },
  { icon: Layers, title: 'Review deck', body: 'Turn corrections into short flashcards that come back just before you forget them.' },
];

// Illustration only: fixed numbers that show the layout of a result, never a real score.
const EXAMPLE = [
  { label: 'Fluency and coherence', band: 6.5 },
  { label: 'Lexical resource', band: 7 },
  { label: 'Grammatical range and accuracy', band: 6 },
  { label: 'Pronunciation', band: 6.5 },
];

/** Dashboard for a signed-out visitor: what the product does, an example result (labelled), and the pages open without an account. */
export function GuestHome() {
  return (
    <PageContainer>
      <PageHeader
        title="Practise IELTS Speaking and Writing"
        description="Timed practice with a band for every criterion, and each mistake marked exactly where you made it."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row-reverse">
            <Link to="/signup" className={buttonStyles({ size: 'lg', className: 'h-11 sm:h-10' })}>
              Create account
            </Link>
            <Link to="/login" className={buttonStyles({ variant: 'outline', size: 'lg', className: 'h-11 sm:h-10' })}>
              Sign in
            </Link>
          </div>
        }
      />

      <div className="space-y-10 md:space-y-12">
        <section aria-labelledby="features-h">
          <PanelHeader id="features-h" title="What you get" />
          <ul className="grid gap-x-12 gap-y-7 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0">
                  <h3 className="type-subheading">{title}</h3>
                  <p className="type-lede mt-1 text-sm">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="example-h" className="grid gap-x-12 gap-y-6 border-t border-line pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <h2 id="example-h" className="type-heading">
              What a result looks like
            </h2>
            <p className="type-lede mt-1.5 max-w-[44ch]">After each attempt you see the band for every criterion, then the exact words behind it.</p>
          </div>
          <Card aria-label="Example result, not a real score">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge>Example, not a real score</Badge>
                <p className="type-caption mt-3">Speaking, Part 2</p>
              </div>
              <p className="type-band text-5xl">{formatBand(6.5)}</p>
            </div>
            <ul className="mt-5 space-y-4">
              {EXAMPLE.map((c) => (
                <li key={c.label}>
                  <p className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{c.label}</span>
                    <span className="type-band text-lg">{formatBand(c.band)}</span>
                  </p>
                  <ProgressBar value={c.band / 9} tone="neutral" label={`${c.label}: example band ${formatBand(c.band)} of 9`} className="mt-2 h-1.5" />
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section aria-labelledby="browse-h">
          <PanelHeader id="browse-h" title="Look around first" meta="No account needed" />
          <ul className={listStyles}>
            <li>
              <Link to="/speaking" className={rowStyles}>
                <RowIcon>
                  <Mic />
                </RowIcon>
                <RowText title="Speaking" meta="The three parts and the live examiner" />
                <RowChevron />
              </Link>
            </li>
            <li>
              <Link to="/writing" className={rowStyles}>
                <RowIcon>
                  <PenLine />
                </RowIcon>
                <RowText title="Writing" meta="Task 1 and Task 2, Academic and General" />
                <RowChevron />
              </Link>
            </li>
            <li>
              <Link to="/bank" className={rowStyles}>
                <RowIcon>
                  <LibraryBig />
                </RowIcon>
                <RowText title="Prompt bank" meta="Browse every question and task" />
                <RowChevron />
              </Link>
            </li>
          </ul>
          <p className="type-caption mt-4 flex flex-wrap items-center gap-x-2">
            Starting a test, or seeing your results, needs an account.
            <Link to="/signup" className="inline-flex items-center gap-1 font-medium text-accent-text underline-offset-4 hover:underline">
              Create one <ArrowRight className="size-4" aria-hidden />
            </Link>
          </p>
        </section>
      </div>
    </PageContainer>
  );
}
