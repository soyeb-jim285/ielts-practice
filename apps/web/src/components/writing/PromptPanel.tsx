import { asChart, letterOpening, minWords, taskLabel } from '@/lib/writing';
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
  const opening = letterOpening(prompt);
  return (
    <article className="mx-auto max-w-[68ch] space-y-6 lg:mx-0">
      <header className="space-y-2">
        <p className="type-caption">
          {taskLabel(prompt)}. You should spend about {time} minutes on this task.
        </p>
        {/* Seeded titles are the body's first sentence (cut with "…" past 120 chars); the figure repeats its own title. Don't print either twice. */}
        {!prompt.body.startsWith(prompt.title.replace(/…$/, '')) && chart?.title !== prompt.title && <h2 className="type-heading text-balance">{prompt.title}</h2>}
      </header>
      <div className="type-reading space-y-4 whitespace-pre-line text-ink">{prompt.body}</div>
      {prompt.bullets?.length ? (
        <div className="type-reading">
          <p className="mb-2">In your letter</p>
          <ul className="list-disc space-y-1.5 pl-6 marker:text-muted">
            {prompt.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {chart && <ChartRenderer spec={chart} />}
      {/* Raster exam figures are drawn on white, so the frame stays white in dark mode on purpose (see DESIGN.md, Surfaces). */}
      {!chart && prompt.imageUrl && (
        <figure className="overflow-hidden rounded-card border border-line bg-white p-2">
          <img src={prompt.imageUrl} alt={`Figure for: ${prompt.title}`} className="mx-auto h-auto max-w-full" loading="eager" />
        </figure>
      )}
      <p className="type-caption border-t border-line pt-4">
        Write at least <span className="type-num font-medium text-ink">{minWords(prompt.part)}</span> words.
      </p>
      {opening && (
        <div className="type-reading space-y-1">
          <p>You do NOT need to write any addresses.</p>
          <p>Begin your letter as follows:</p>
          <p>{opening}</p>
        </div>
      )}
    </article>
  );
}
