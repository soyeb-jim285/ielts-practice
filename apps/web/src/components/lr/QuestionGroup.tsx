import { Check, X } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { controlStyles } from '@/components/ui';
import { multiPicks, parseContent, parseInline, setMultiPicks, type Block, type Inline, type LrGroup, type LrQuestion, type LrResponses } from '@/lib/lr';
import { cn } from '@/lib/utils';

export type Mark = { n: number; given: string; correct: boolean; answer: string[] };
export type GroupProps = {
  group: LrGroup;
  responses: LrResponses;
  onChange: (next: LrResponses) => void;
  /** asset key → URL (map / diagram images) */
  assets?: Record<string, string>;
  /** Submitted attempt: inputs are read-only and show right/wrong. */
  review?: Map<number, Mark>;
  /** Question to ring (jump from the navigator or the answer table). */
  active?: number | null;
};

const stateRing = (mark: Mark | undefined, active: boolean) =>
  mark ? (mark.correct ? 'border-good ring-1 ring-good bg-good-soft' : 'border-bad ring-1 ring-bad bg-bad-soft') : active ? 'border-brand ring-2 ring-brand' : '';

/** Number chip in front of an item; teal once answered. */
export function QNum({ n, done, mark }: { n: number; done?: boolean; mark?: Mark }) {
  return (
    <span
      aria-hidden
      className={cn(
        'type-num inline-grid h-7 min-w-7 shrink-0 place-items-center rounded-md px-1.5 text-sm font-semibold',
        mark ? (mark.correct ? 'bg-good-soft text-good-text' : 'bg-bad-soft text-bad-text') : done ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-muted',
      )}
    >
      {n}
    </span>
  );
}

const answerText = (m: Mark) => m.answer.join(' / ');

/** After a wrong answer: what was expected. */
function Expected({ mark }: { mark?: Mark }) {
  if (!mark || mark.correct) return null;
  return (
    <span className="type-caption inline-flex items-center gap-1 font-medium text-good-text">
      <Check className="size-3.5" aria-hidden />
      <span className="sr-only">Correct answer: </span>
      {answerText(mark)}
    </span>
  );
}

function Status({ mark }: { mark?: Mark }) {
  if (!mark) return null;
  return mark.correct ? <Check className="size-4 shrink-0 text-good-text" aria-label="Correct" /> : <X className="size-4 shrink-0 text-bad-text" aria-label="Wrong" />;
}

// ---------- gap: inline text input, sized to its content ----------
export function GapInput({ n, value, onChange, mark, active, wordLimit }: { n: number; value: string; onChange: (v: string) => void; mark?: Mark; active?: boolean; wordLimit?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-baseline">
      <input
        id={`q-${n}`}
        data-q={n}
        type="text"
        value={value}
        readOnly={!!mark}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        placeholder={String(n)}
        aria-label={`Question ${n}${wordLimit ? `, ${wordLimit.toLowerCase()}` : ''}`}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{ width: `${Math.min(28, Math.max(8, value.length + 3))}ch` }}
        className={cn(controlStyles, 'type-num mx-0.5 h-8 px-2 text-center font-medium max-md:h-10', stateRing(mark, !!active))}
      />
      {mark && <Status mark={mark} />}
      <Expected mark={mark} />
    </span>
  );
}

/** Native select used for match items and word-box gaps. */
export function MatchSelect({ n, value, options, onChange, mark, active, className }: { n: number; value: string; options: { key: string; text: string }[]; onChange: (v: string) => void; mark?: Mark; active?: boolean; className?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        id={`q-${n}`}
        data-q={n}
        value={value}
        disabled={!!mark}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Question ${n}`}
        className={cn(controlStyles, 'type-num h-8 w-auto min-w-[5.5rem] pr-2 font-medium max-md:h-10', stateRing(mark, !!active), mark && 'opacity-100 disabled:opacity-100', className)}
      >
        <option value="">{n}</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.key}
          </option>
        ))}
      </select>
      {mark && <Status mark={mark} />}
      <Expected mark={mark} />
    </span>
  );
}

// ---------- radio-style choices (mcq cards, tfng/ynng segmented) ----------
type Choice = { key: string; label: ReactNode };
export function ChoiceGroup({ name, label, choices, value, onChange, layout, mark, active }: { name: string; label: string; choices: Choice[]; value: string; onChange: (v: string) => void; layout: 'cards' | 'segmented'; mark?: Mark; active?: boolean }) {
  const correct = new Set((mark?.answer ?? []).map((a) => a.toUpperCase()));
  return (
    <div role="radiogroup" aria-label={label} className={cn(layout === 'cards' ? 'grid gap-2' : 'inline-grid w-full max-w-md grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1 ring-1 ring-line ring-inset', active && 'rounded-lg ring-2 ring-brand')}>
      {choices.map((c) => {
        const checked = value.toUpperCase() === c.key.toUpperCase();
        const isRight = !!mark && correct.has(c.key.toUpperCase());
        return (
          <label
            key={c.key}
            className={cn(
              'relative flex cursor-pointer items-center gap-3 text-body transition-colors duration-[120ms] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              layout === 'cards'
                ? 'rounded-lg border border-line bg-card px-3.5 py-2.5 hover:border-input has-[:checked]:border-brand has-[:checked]:bg-accent-soft'
                : 'min-h-10 justify-center rounded-md px-2 text-center text-sm font-medium text-muted hover:text-ink has-[:checked]:bg-card has-[:checked]:text-ink has-[:checked]:shadow-card has-[:checked]:ring-1 has-[:checked]:ring-line',
              mark && checked && !mark.correct && 'border-bad bg-bad-soft text-bad-text has-[:checked]:border-bad has-[:checked]:bg-bad-soft has-[:checked]:text-bad-text',
              mark && checked && mark.correct && 'border-good bg-good-soft text-good-text has-[:checked]:border-good has-[:checked]:bg-good-soft has-[:checked]:text-good-text',
              mark && !checked && isRight && 'border-good',
            )}
          >
            <input
              type="radio"
              name={name}
              value={c.key}
              checked={checked}
              disabled={!!mark}
              // a radio cannot be cleared natively: clicking the chosen one again unselects it
              onClick={() => !mark && onChange(checked ? '' : c.key)}
              onChange={() => {}}
              className="sr-only"
            />
            {layout === 'cards' && (
              <span aria-hidden className={cn('type-num grid size-6 shrink-0 place-items-center rounded-md text-sm font-semibold', checked ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted')}>
                {c.key}
              </span>
            )}
            <span className="min-w-0 flex-1 text-pretty">{c.label}</span>
            {mark && isRight && !checked && <Check className="size-4 shrink-0 text-good-text" aria-label="Correct answer" />}
          </label>
        );
      })}
    </div>
  );
}

// ---------- gap content: markdown with {{n}} placeholders ----------
function Inlines({ inline, render }: { inline: Inline[]; render: (n: number) => ReactNode }) {
  return (
    <>
      {inline.map((p, i) =>
        p.kind === 'gap' ? <Fragment key={i}>{render(p.n)}</Fragment> : p.kind === 'bold' ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </>
  );
}

function Content({ blocks, render }: { blocks: Block[]; render: (n: number) => ReactNode }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.kind === 'p') return <p key={i} className="type-body leading-10 max-md:leading-[3rem]"><Inlines inline={b.inline} render={render} /></p>;
        if (b.kind === 'list')
          return (
            <ul key={i} className="space-y-1.5 border-l-2 border-line pl-4">
              {b.items.map((it, j) => (
                <li key={j} className="type-body leading-10 max-md:leading-[3rem]">
                  {b.ordered && <span className="type-num mr-2 font-semibold text-muted">{j + 1}.</span>}
                  <Inlines inline={it} render={render} />
                </li>
              ))}
            </ul>
          );
        return (
          <div key={i} className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[20rem] border-collapse text-left text-body">
              {b.head.some((h) => h.length) && (
                <thead className="bg-surface-2">
                  <tr>
                    {b.head.map((h, j) => (
                      <th key={j} scope="col" className="border-b border-line px-3 py-2 text-sm font-semibold">
                        <Inlines inline={h} render={render} />
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody className="divide-y divide-line">
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k} className={cn('px-3 py-2 align-middle', k === 0 && 'font-medium')}>
                        <Inlines inline={c} render={render} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/** The option list of a match / word-box group, shown once. Keys that carry no text (map letters) are not listed. */
export function OptionList({ title, options }: { title: string; options: { key: string; text: string }[] }) {
  if (!options.some((o) => o.text)) return null;
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-4">
      <p className="type-subheading mb-2.5">{title}</p>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {options.map((o) => (
          <li key={o.key} className="flex gap-2.5 text-body">
            <span className="type-num min-w-6 font-semibold text-accent-text">{o.key}</span>
            <span className="min-w-0 text-pretty">{o.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ q, children, done, mark, active }: { q: LrQuestion; children: ReactNode; done: boolean; mark?: Mark; active: boolean }) {
  return (
    <li data-q={q.n} id={`qrow-${q.n}`} className={cn('flex items-start gap-3 rounded-lg py-3 max-md:flex-wrap', active && 'bg-accent-soft/60 px-2 -mx-2')}>
      <QNum n={q.n} done={done} mark={mark} />
      {children}
    </li>
  );
}

/** One group of questions: instructions, optional figure/word box, then the items in the shape of its type. */
export function QuestionGroup({ group: g, responses: r, onChange, assets, review, active }: GroupProps) {
  const val = (n: number) => r[String(n)] ?? '';
  const set = (n: number, v: string) => {
    const next = { ...r };
    if (v) next[String(n)] = v;
    else delete next[String(n)];
    onChange(next);
  };
  const mark = (n: number) => review?.get(n);
  const act = (n: number) => active === n;
  const range = g.from === g.to ? `Question ${g.from}` : `Questions ${g.from} to ${g.to}`;
  const opts = g.options ?? [];
  const wordBox = g.type === 'gap' && opts.length > 0;

  const gapNode = (n: number) =>
    wordBox ? (
      <MatchSelect n={n} value={val(n)} options={opts} onChange={(v) => set(n, v)} mark={mark(n)} active={act(n)} />
    ) : (
      <GapInput n={n} value={val(n)} onChange={(v) => set(n, v)} mark={mark(n)} active={act(n)} wordLimit={g.wordLimit} />
    );

  let body: ReactNode;
  if (g.type === 'gap' && g.content) {
    body = <Content blocks={parseContent(g.content)} render={gapNode} />;
  } else if (g.type === 'gap') {
    body = (
      <ol className="divide-y divide-line">
        {g.questions.map((q) => (
          <Row key={q.n} q={q} done={!!val(q.n)} mark={mark(q.n)} active={act(q.n)}>
            <p className="type-body min-w-0 flex-1 leading-10 max-md:leading-[3rem]">
              {q.text?.includes(`{{${q.n}}}`) ? <Inlines inline={parseInline(q.text)} render={gapNode} /> : (<>{q.text} {gapNode(q.n)}</>)}
            </p>
          </Row>
        ))}
      </ol>
    );
  } else if (g.type === 'mcq') {
    body = (
      <ol className="space-y-5">
        {g.questions.map((q) => (
          <li key={q.n} data-q={q.n} id={`qrow-${q.n}`} className="flex items-start gap-3">
            <QNum n={q.n} done={!!val(q.n)} mark={mark(q.n)} />
            <div className="min-w-0 flex-1 space-y-2.5">
              <p id={`q-${q.n}`} className="type-body font-medium text-pretty">{q.text}</p>
              <ChoiceGroup name={`q${q.n}`} label={`Question ${q.n}`} layout="cards" choices={(q.options ?? []).map((o) => ({ key: o.key, label: o.text }))} value={val(q.n)} onChange={(v) => set(q.n, v)} mark={mark(q.n)} active={act(q.n)} />
            </div>
          </li>
        ))}
      </ol>
    );
  } else if (g.type === 'mcq-multi') {
    const picks = multiPicks(g, r);
    const max = g.questions.length;
    const correct = new Set((g.questions[0]?.answer ?? []).map((a) => a.toUpperCase()));
    body = (
      <fieldset className="space-y-2.5" data-q={g.from} id={`q-${g.from}`}>
        <legend className="type-body mb-1 flex items-center gap-2 font-medium">
          <span className="inline-flex gap-1">{g.questions.map((q) => <QNum key={q.n} n={q.n} done={!!val(q.n)} mark={mark(q.n)} />)}</span>
          <span className="text-pretty">{g.questions[0]?.text ?? `Choose ${max} answers`}</span>
        </legend>
        <p className={cn('type-caption', picks.length >= max && !review && 'font-medium text-accent-text')} role="status">
          Choose {max}. {review ? '' : `${picks.length} of ${max} selected${picks.length >= max ? '; untick one to change' : ''}.`}
        </p>
        <div className={cn('grid gap-2', active != null && g.questions.some((q) => q.n === active) && 'rounded-lg ring-2 ring-brand')}>
          {opts.map((o) => {
            const on = picks.includes(o.key);
            const full = picks.length >= max && !on;
            const right = !!review && correct.has(o.key.toUpperCase());
            return (
              <label
                key={o.key}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3.5 py-2.5 text-body transition-colors duration-[120ms] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                  on ? 'border-brand bg-accent-soft' : 'border-line hover:border-input',
                  full && 'cursor-not-allowed opacity-60',
                  review && on && (right ? 'border-good bg-good-soft' : 'border-bad bg-bad-soft'),
                  review && !on && right && 'border-good',
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={full || !!review}
                  onChange={() => onChange(setMultiPicks(g, r, on ? picks.filter((p) => p !== o.key) : [...picks, o.key]))}
                />
                <span aria-hidden className={cn('type-num grid size-6 shrink-0 place-items-center rounded-md text-sm font-semibold', on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted')}>{o.key}</span>
                <span className="min-w-0 flex-1 text-pretty">{o.text}</span>
                {right && <Check className="size-4 text-good-text" aria-label="Correct answer" />}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  } else if (g.type === 'tfng' || g.type === 'ynng') {
    const choices = (g.type === 'tfng' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN']).map((k) => ({ key: k, label: k === 'NOT GIVEN' ? 'Not given' : k.charAt(0) + k.slice(1).toLowerCase() }));
    body = (
      <ol className="space-y-5">
        {g.questions.map((q) => (
          <li key={q.n} data-q={q.n} id={`qrow-${q.n}`} className="flex items-start gap-3">
            <QNum n={q.n} done={!!val(q.n)} mark={mark(q.n)} />
            <div className="min-w-0 flex-1 space-y-2.5">
              <p id={`q-${q.n}`} className="type-body text-pretty">{q.text}</p>
              <ChoiceGroup name={`q${q.n}`} label={`Question ${q.n}`} layout="segmented" choices={choices} value={val(q.n)} onChange={(v) => set(q.n, v)} mark={mark(q.n)} active={act(q.n)} />
            </div>
          </li>
        ))}
      </ol>
    );
  } else {
    // match: items on the left, one select each; the option list is shown once above
    body = (
      <ol className="divide-y divide-line">
        {g.questions.map((q) => (
          <Row key={q.n} q={q} done={!!val(q.n)} mark={mark(q.n)} active={act(q.n)}>
            <span className="type-body min-w-0 flex-1 self-center text-pretty">{q.text}</span>
            <MatchSelect n={q.n} value={val(q.n)} options={opts} onChange={(v) => set(q.n, v)} mark={mark(q.n)} active={act(q.n)} className="max-md:w-full" />
          </Row>
        ))}
      </ol>
    );
  }

  const image = g.image ? assets?.[g.image] : undefined;
  return (
    <section data-group={`${g.from}-${g.to}`} className="space-y-4">
      <header className="space-y-1">
        <h3 className="type-subheading">{range}</h3>
        <p className="type-caption max-w-[62ch] text-pretty text-ink/80">{g.instructions.replace(/^Questions? [\d\s–\-and]+\.\s*/i, '')}</p>
        {g.wordLimit && !g.instructions.toUpperCase().includes(g.wordLimit.toUpperCase()) && <p className="type-caption font-medium text-ink">Write {g.wordLimit}.</p>}
      </header>
      {g.title && <h4 className="type-reading-sm font-medium">{g.title}</h4>}
      {image && (
        // The one literal white of the system: raster exam figures are drawn on white.
        <figure className="overflow-x-auto rounded-lg border border-line bg-white p-2">
          <img src={image} alt={g.title ?? 'Figure for the questions below'} className="mx-auto max-h-[26rem] w-full max-w-xl object-contain" />
        </figure>
      )}
      {(g.type === 'match' || wordBox) && opts.length > 0 && <OptionList title={wordBox ? 'Word box' : g.options?.some((o) => /^[ivx]+$/i.test(o.key)) ? 'List of headings' : 'Options'} options={opts} />}
      {body}
    </section>
  );
}
