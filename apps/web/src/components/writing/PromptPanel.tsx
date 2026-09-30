import { asChart, minWords, taskLabel } from '@/lib/writing';
import { ChartRenderer } from './ChartRenderer';

/** The subset of the server `Prompt` / `AttemptPrompt` the writing screens use. */
export type WritingPrompt = {
  id: string;
  part: number;
  variant: 'academic' | 'general' | null;
  type: string;
  topic: string;
  title: string;
  body: string;
  bullets: string[] | null;
  chart: unknown;
  imageUrl: string | null;
  done?: boolean;
};

/** Exam-paper rendering of a writing prompt: instructions, the figure (chart JSON or Cambridge image), letter bullets. */
export function PromptPanel({ prompt }: { prompt: WritingPrompt }) {
  const chart = asChart(prompt.chart);
  const time = prompt.part === 1 ? 20 : 40;
  return (
    <article className="space-y-5">
      <header className="space-y-1.5">
        <p className="text-sm font-medium text-muted">
          {taskLabel(prompt)} · about {time} minutes
        </p>
        {/* Seeded titles are the body's first sentence (cut with "…" past 120 chars); the figure repeats its own title. Don't print either twice. */}
        {!prompt.body.startsWith(prompt.title.replace(/…$/, '')) && chart?.title !== prompt.title && <h2 className="text-lg font-semibold text-balance">{prompt.title}</h2>}
      </header>
      <div className="prose-serif space-y-3 whitespace-pre-line text-ink">{prompt.body}</div>
      {prompt.bullets?.length ? (
        <div>
          <p className="prose-serif mb-1.5">In your letter:</p>
          <ul className="prose-serif list-disc space-y-1 pl-6">
            {prompt.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {chart && <ChartRenderer spec={chart} />}
      {!chart && prompt.imageUrl && (
        <figure className="overflow-hidden rounded-card border border-line bg-white p-2">
          <img src={prompt.imageUrl} alt={`Figure for: ${prompt.title}`} className="mx-auto h-auto max-w-full" loading="eager" />
        </figure>
      )}
      <p className="border-t border-line pt-4 text-sm text-muted">Write at least {minWords(prompt.part)} words.</p>
    </article>
  );
}
