import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui';
import { ACTION, type CoachWords } from './data';

/** Your week: 3-4 dated lines, each one tap from the practice it names. Minutes come from the action, never from the model. */
export function WeekPlan({ plan }: { plan: CoachWords['plan'] }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <ul className="divide-y divide-line">
        {plan.map((p, i) => {
          const a = ACTION[p.action];
          const body = (
            <>
              <span className="type-num w-20 shrink-0 font-semibold text-ink">{p.day}</span>
              <span className="type-body min-w-0 flex-1">{p.text}</span>
              <span className="type-caption type-num shrink-0">{a.minutes} min</span>
              {a.to && <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />}
            </>
          );
          return (
            <li key={i}>
              {a.to ? (
                <Link to={a.to} className="flex items-center gap-3 px-4 py-3 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
