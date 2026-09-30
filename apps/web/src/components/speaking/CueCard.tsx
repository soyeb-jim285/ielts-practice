import type { Prompt } from '@server/routes/prompts';
import { stripLead } from '@/lib/result';

/** Part 2 cue card: title, the body without its restated title, and the "You should say" bullets. */
export function CueCard({ prompt }: { prompt: Pick<Prompt, 'title' | 'body' | 'bullets'> }) {
  const body = stripLead(prompt.title, prompt.body ?? '');
  return (
    <section aria-label="Cue card" className="w-full rounded-card border border-line bg-surface p-5 text-left shadow-card sm:p-6">
      <p className="font-serif text-xl leading-snug text-balance">{prompt.title}</p>
      {body && <p className="mt-2 text-[0.9375rem] whitespace-pre-line text-muted">{body}</p>}
      {prompt.bullets?.length ? (
        <>
          <p className="mt-4 text-sm font-medium">You should say:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[0.9375rem]">
            {prompt.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
