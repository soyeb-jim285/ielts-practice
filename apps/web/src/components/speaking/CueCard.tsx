import type { Prompt } from '@server/routes/prompts';
import { Card } from '@/components/ui';
import { stripLead } from '@/lib/result';

/** Part 2 cue card, set as reading material: the topic in the serif, the prompt text, and the "You should say" bullets. */
export function CueCard({ prompt }: { prompt: Pick<Prompt, 'title' | 'body' | 'bullets'> }) {
  const body = stripLead(prompt.title, prompt.body ?? '');
  return (
    <Card role="region" aria-label="Cue card" className="w-full text-left sm:p-7">
      <p className="type-caption">Cue card</p>
      <p className="mt-1.5 max-w-[30ch] type-title-sm text-balance">{prompt.title}</p>
      {body && <p className="mt-3 max-w-[68ch] text-body whitespace-pre-line text-muted">{body}</p>}
      {prompt.bullets?.length ? (
        <>
          <p className="mt-5 text-sm font-medium">You should say</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 type-reading-sm marker:text-muted">
            {prompt.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
