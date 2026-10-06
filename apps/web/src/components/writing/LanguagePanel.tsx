import type { RepeatedWord, TextMetrics } from '@ielts/core';
import type { AnalysisResult, VocabUpgrade } from '@server/ai/types';
import { ArrowRight } from 'lucide-react';
import { Chip } from '@/components/ui';
import { CountChips, InfoNote, RankedList, Section, StatList, type StatItem } from '@/components/result';
import { categoryLabel } from '@/lib/result';

/** MTLD bands are heuristic (typical ranges for exam essays), shown as a hint, not a score. */
const mtldTone = (m: number): ['good' | 'warn' | 'bad', string] => (m >= 80 ? ['good', 'Wide range'] : m >= 55 ? ['warn', 'Adequate range'] : ['bad', 'Limited range']);

const tip = (label: string, text: string) => <InfoNote label={`About ${label}`}>{text}</InfoNote>;

/** A "words you leaned on" toggle: highlights every use of the word's forms in the essay. */
function RepeatedChip({ r, lean, onLean }: { r: RepeatedWord; lean?: RepeatedWord | null; onLean?: (w: RepeatedWord | null) => void }) {
  const on = lean?.word === r.word;
  return (
    <Chip selected={on} disabled={!onLean} onClick={() => onLean?.(on ? null : r)} title={r.forms && r.forms.length > 1 ? r.forms.join(', ') : undefined} className="type-body h-9 gap-1.5 px-3 data-[state=on]:border-ink/30 data-[state=on]:bg-ink/15 data-[state=on]:text-ink">
      <span className="text-ink">{r.word}</span> <span className="type-num">×{r.count}</span>
    </Chip>
  );
}

/** Deterministic text metrics + LLM vocabulary upgrades. */
export function LanguagePanel({ r, lean, onLean }: { r: AnalysisResult; lean?: RepeatedWord | null; onLean?: (w: RepeatedWord | null) => void }) {
  const m: TextMetrics | undefined = r.textMetrics;
  const byCat = Object.entries(
    r.errors.reduce<Record<string, number>>((acc, e) => ((acc[e.category] = (acc[e.category] ?? 0) + 1), acc), {}),
  );
  const linkers = [...(m?.linkers ?? [])].sort((a, b) => b.count - a.count);
  const overused = linkers.filter((l) => l.overused && l.count >= 2); // a word used once is never "overused", whatever older analyses say
  // ponytail: optional until every stored analysis carries it (older ones predate the field).
  const opening = (m as (TextMetrics & { linkerOpeningRatio?: number }) | undefined)?.linkerOpeningRatio;
  const templated = m && opening != null && m.sentences >= 5 && opening > 0.4;
  const upgrades = r.vocabUpgrades
    .map((v) => ({ ...v, better: v.better.filter((b) => b.trim().toLowerCase() !== v.original.trim().toLowerCase()) }))
    .filter((v) => v.better.length > 0);
  return (
    <>
      {m && (
        <Section title="At a glance">
          <StatList
            cols={3}
            items={[
              { label: 'Words', value: m.words },
              { label: 'Paragraphs', value: m.paragraphs },
              { label: 'Sentences', value: m.sentences },
              { label: 'Avg sentence', value: `${m.avgSentenceLen.toFixed(1)} words`, info: tip('Avg sentence', 'Band 7+ essays usually mix short and long sentences, averaging roughly 15–25 words.') },
              {
                label: 'Lexical diversity',
                value: `MTLD ${Math.round(m.mtld)}`,
                status: { tone: mtldTone(m.mtld)[0], text: mtldTone(m.mtld)[1] },
                info: tip('Lexical diversity', 'MTLD: how long you keep using new words before repeating yourself. Higher is more varied. Ranges here are rough guides, not band cut-offs.'),
              },
              { label: 'Unique-word ratio', value: `${Math.round(m.ttr * 100)}%`, info: tip('Unique-word ratio', 'Type–token ratio. It naturally falls as essays get longer, so compare like with like.') },
            ]}
          />
        </Section>
      )}

      {byCat.length > 0 && (
        <Section title="Mistakes by type">
          <RankedList mode="count" rows={byCat.map(([c, n]) => ({ label: categoryLabel(c), right: n, total: n }))} />
        </Section>
      )}

      {linkers.length > 0 && (
        <Section
          title="Linking words"
          caption={
            <>
              Examiners penalise mechanical linking. Overused ones are tinted; swap some for referencing (“this trend”, “such policies”).
              {templated && <span className="mt-1 block text-warn-text">{Math.round(opening * m.sentences)} of {m.sentences} sentences start with a linking word. Vary your openings.</span>}
            </>
          }
        >
          <CountChips items={linkers.map((l) => ({ label: l.word, count: l.count, tone: overused.includes(l) ? 'warn' : 'neutral' }))} />
          {overused.length > 0 && <p className="type-body">Overused: {overused.map((l) => l.word).join(', ')}</p>}
        </Section>
      )}

      {m && m.repeated.length > 0 && (
        <Section title="Repeated words" caption="Select a word to highlight every use in your essay.">
          <ul className="flex flex-wrap gap-2">
            {m.repeated.map((w) => (
              <li key={w.word}>
                <RepeatedChip r={w} lean={lean} onLean={onLean} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {upgrades.length > 0 && <VocabList items={upgrades} />}
    </>
  );
}

function VocabList({ items }: { items: VocabUpgrade[] }) {
  return (
    <Section title="Vocabulary upgrades">
      <ul className="max-w-[68ch] divide-y divide-line">
        {items.map((v) => (
          <li key={v.original} className="space-y-1 py-3">
            <p className="type-reading-sm flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-muted">{v.original}</span>
              <ArrowRight role="img" className="size-4 shrink-0 translate-y-0.5 text-muted" aria-label="try" />
              <span>{v.better.join(', ')}</span>
            </p>
            {v.note && <p className="type-caption">{v.note}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
