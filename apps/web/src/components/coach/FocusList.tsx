import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { buttonStyles, Card } from '@/components/ui';
import { plural } from '@/lib/format';
import { ACTION, actionLink, type Candidate, type CoachWords, evidenceLink, type Feedback, itemKey, SKILL_LABEL } from './data';
import { Wrong } from './Wrong';

/** "a -> b" from a candidate's facts.example1/2. */
export const examples = (c: Candidate) =>
  [c.facts.example1, c.facts.example2].flatMap((e) => (typeof e === 'string' && e.includes(' -> ') ? [e.split(' -> ') as [string, string]] : []));

export function Example({ pair: [was, fix] }: { pair: [string, string] }) {
  return (
    <span>
      <s className="text-muted">{was}</s> → <b className="font-semibold text-ink">{fix}</b>
    </span>
  );
}

/** This week's focus: up to 3 items, in the order the server ranked them, each with its evidence and one action. */
export function FocusList({ focus, candidates, fb }: { focus: CoachWords['focus']; candidates: Candidate[]; fb: Feedback }) {
  const items = focus.flatMap((f) => {
    const c = candidates.find((x) => x.id === f.candidateId);
    return c && !fb.hidden.has(itemKey('focus', f.candidateId)) ? [{ f, c }] : [];
  });
  if (!items.length) return <p className="type-body text-muted">Nothing to focus on right now. Keep practising and new patterns will show up here.</p>;
  return (
    <ol className="space-y-3">
      {items.map(({ f, c }, i) => {
        const ev = f.action === 'see-evidence' ? null : evidenceLink(c);
        const act = actionLink(f.action, c);
        const outOf = Number(c.facts.outOf) || c.tests;
        return (
          <li key={f.candidateId}>
            <Card className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 max-sm:grid-cols-1" role="article" aria-labelledby={`focus-${i}`}>
              <span aria-hidden className="type-num grid size-8 place-items-center rounded-full bg-accent-soft font-semibold text-accent-text max-sm:hidden">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="type-overline">{SKILL_LABEL[c.skill]}</p>
                  <h3 id={`focus-${i}`} className="type-subheading mt-1">
                    {f.title}
                  </h3>
                  <p className="type-body mt-1 text-muted">{f.why}</p>
                </div>
                <div className="rounded-md bg-surface-2 px-3.5 py-3 type-body">
                  <p className="type-overline mb-1">From your tests</p>
                  <p>
                    {examples(c).length > 0 ? (
                      <>
                        {'For example '}
                        {examples(c).map((p, k) => (
                          <span key={k}>
                            {k > 0 && ', '}
                            <Example pair={p} />
                          </span>
                        ))}
                      </>
                    ) : c.tests > 1 ? (
                      `In ${c.tests} of your last ${plural(outOf, 'test')}`
                    ) : (
                      `${plural(c.count, 'time')} so far`
                    )}
                    .{' '}
                    {ev && (
                      <Link {...ev} className="font-medium text-accent-text underline underline-offset-2">
                        See where it happened
                      </Link>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {act && (
                    <Link {...act} className={buttonStyles({ variant: f.action === 'see-evidence' ? 'outline' : 'primary', size: 'sm' })}>
                      {f.label}
                      {f.action !== 'see-evidence' && <span className="font-normal opacity-80">({ACTION[f.action].minutes} min)</span>}
                      <ArrowRight aria-hidden />
                    </Link>
                  )}
                  <Wrong fb={fb} itemKey={itemKey('focus', f.candidateId)} what={f.title} />
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
