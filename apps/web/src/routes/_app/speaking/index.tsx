import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, Headphones, MessagesSquare, Mic, NotebookPen, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, buttonStyles, Card, PageHeader } from '@/components/ui';

export const Route = createFileRoute('/_app/speaking/')({ component: SpeakingHome });

const PARTS: { mode: 'p1' | 'p2' | 'p3'; title: string; desc: string; time: string; icon: ReactNode }[] = [
  { mode: 'p1', title: 'Part 1 · Interview', desc: 'Everyday questions about you, your home, work or studies.', time: '4–5 min', icon: <MessagesSquare /> },
  { mode: 'p2', title: 'Part 2 · Long turn', desc: 'A cue card, one minute to prepare with notes, then up to two minutes.', time: '3–4 min', icon: <NotebookPen /> },
  { mode: 'p3', title: 'Part 3 · Discussion', desc: 'Abstract follow-up questions. Develop ideas with reasons and examples.', time: '4–5 min', icon: <Headphones /> },
];

function SpeakingHome() {
  return (
    <div className="space-y-8">
      <PageHeader title="Speaking" description="Record your answers and get a band for each criterion, with every mistake and pause located in your transcript." />

      <Card className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text [&_svg]:size-5">
            <Mic aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Full practice test</h2>
            <p className="mt-1 text-[0.9375rem] text-muted">All three parts in order, like test day. Each part is scored, plus an overall for the test.</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
              <Timer className="size-4" aria-hidden /> 11–14 min
            </p>
          </div>
        </div>
        <Link to="/speaking/session" search={{ mode: 'full' }} className={buttonStyles({ size: 'lg', className: 'w-full sm:w-auto' })}>
          Start full test
        </Link>
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Practise one part</h2>
        <Card padded={false} className="divide-y divide-line overflow-hidden">
          {PARTS.map((p) => (
            <Link key={p.mode} to="/speaking/session" search={{ mode: p.mode }} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-ink/[0.03]">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted [&_svg]:size-4.5" aria-hidden>
                {p.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.title}</span>
                <span className="block text-sm text-muted">{p.desc}</span>
              </span>
              <span className="hidden text-sm text-muted tabular-nums sm:block">{p.time}</span>
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
            </Link>
          ))}
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Talk to an examiner</h2>
        <Link to="/speaking/live" className="block rounded-card focus-visible:outline-offset-2">
          <Card interactive className="flex items-center gap-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden>
              <MessagesSquare className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                Live examiner <Badge tone="accent">Voice</Badge>
              </span>
              <span className="block text-sm text-muted">An AI examiner asks the questions aloud and follows up on what you say, then scores the whole test.</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
          </Card>
        </Link>
      </section>
    </div>
  );
}
