import { createFileRoute, Link } from '@tanstack/react-router';
import { AudioLines, ChevronRight, MessageCircleQuestion, MessagesSquare, Mic, NotebookPen, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, buttonStyles, Card, PageHeader } from '@/components/ui';

export const Route = createFileRoute('/_app/speaking/')({ component: SpeakingHome });

const PARTS: { mode: 'p1' | 'p2' | 'p3'; title: string; desc: string; time: string; icon: ReactNode }[] = [
  { mode: 'p1', title: 'Part 1 · Interview', desc: 'Everyday questions about you, your home, work or studies.', time: '4–5 min', icon: <MessageCircleQuestion /> },
  { mode: 'p2', title: 'Part 2 · Long turn', desc: 'A cue card, one minute to prepare with notes, then up to two minutes.', time: '3–4 min', icon: <NotebookPen /> },
  { mode: 'p3', title: 'Part 3 · Discussion', desc: 'Abstract follow-up questions. Develop ideas with reasons and examples.', time: '4–5 min', icon: <MessagesSquare /> },
];

const ROW = 'flex min-h-16 items-center gap-4 px-5 py-4 transition-colors hover:bg-hover focus-visible:-outline-offset-2';

function SpeakingHome() {
  return (
    <div className="space-y-10">
      <PageHeader title="Speaking" description="Record your answers and get a band for each criterion, with every mistake and pause located in your transcript." />

      <Card tone="hero" className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-brand-ink [&_svg]:size-5">
            <Mic aria-hidden />
          </span>
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold">Full practice test</h2>
            <p className="mt-1 text-[0.9375rem] text-muted-foreground">All three parts in order, like test day. Each part is scored, plus an overall for the test.</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Timer className="size-4" aria-hidden /> 11–14 min
            </p>
          </div>
        </div>
        <Link to="/speaking/session" search={{ mode: 'full' }} className={buttonStyles({ size: 'lg', className: 'w-full md:w-auto md:px-8' })}>
          Start full test
        </Link>
      </Card>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Or practise one thing</h2>
        <Card padded={false} className="divide-y divide-line overflow-hidden">
          {PARTS.map((p) => (
            <Link key={p.mode} to="/speaking/session" search={{ mode: p.mode }} className={ROW}>
              <Icon>{p.icon}</Icon>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.title}</span>
                <span className="block max-w-[68ch] text-sm text-muted-foreground">{p.desc}</span>
              </span>
              <span className="hidden text-sm text-muted-foreground tabular-nums sm:block">{p.time}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          ))}
          <Link to="/speaking/live" className={ROW}>
            <Icon>
              <AudioLines />
            </Icon>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                Live examiner <Badge tone="accent">Voice</Badge>
              </span>
              <span className="block max-w-[68ch] text-sm text-muted-foreground">An AI examiner asks the questions aloud and follows up on what you say, then scores the whole test.</span>
            </span>
            <span className="hidden text-sm text-muted-foreground tabular-nums sm:block">11–14 min</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </Card>
      </section>
    </div>
  );
}

const Icon = ({ children }: { children: ReactNode }) => (
  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground [&_svg]:size-5" aria-hidden>
    {children}
  </span>
);
