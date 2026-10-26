import { Card } from '@/components/ui';
import { type CoachWords, type Feedback, itemKey } from './data';
import { Wrong } from './Wrong';

/** Before your next test: up to 5 one-line checks, each from one of the student's own traps. */
export function CheatSheet({ cheat, fb }: { cheat: CoachWords['cheat']; fb: Feedback }) {
  const lines = cheat.filter((c, i) => !fb.hidden.has(itemKey('cheat', c.candidateId)) && cheat.findIndex((x) => x.text === c.text) === i); // template lines repeat across skills
  if (!lines.length) return null;
  return (
    <Card className="p-4 sm:p-5">
      <ol className="divide-y divide-line">
        {lines.map((c, i) => (
          <li key={c.candidateId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span aria-hidden className="type-num w-5 shrink-0 font-semibold text-accent-text">
              {i + 1}
            </span>
            <span className="type-body min-w-0 flex-1">{c.text}</span>
            <Wrong compact fb={fb} itemKey={itemKey('cheat', c.candidateId)} what={c.text} />
          </li>
        ))}
      </ol>
    </Card>
  );
}
