import type { TextMetrics } from '@ielts/core';
import type { AnalysisResult, VocabUpgrade } from '@server/ai/types';
import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Card, InfoTip, TONE_STYLES, type Tone } from '@/components/ui';
import { categoryLabel } from '@/lib/result';

const FILL: Record<Tone, string> = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', accent: 'bg-accent', neutral: 'bg-muted' };

/** MTLD bands are heuristic (typical ranges for exam essays), shown as a hint, not a score. */
const mtldTone = (m: number): [Tone, string] => (m >= 80 ? ['good', 'Wide range'] : m >= 55 ? ['warn', 'Adequate range'] : ['bad', 'Limited range']);

function BarList({ rows, label }: { rows: { key: string; label: string; count: number; tone?: Tone; badge?: string }[]; label: string }) {
  // Scale to the top count, but never below 3 so a list of singletons doesn't render as a wall of full bars.
  const max = Math.max(3, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-2 rounded-full bg-ink/6">
            <span className={clsx('block h-full rounded-full', FILL[r.tone ?? 'accent'])} style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} />
          </span>
          <span className="flex items-center gap-2 tabular-nums">
            {r.badge && <Badge tone={r.tone}>{r.badge}</Badge>}
            {r.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Deterministic text metrics + LLM vocabulary upgrades. */
export function LanguagePanel({ r }: { r: AnalysisResult }) {
  const m: TextMetrics | undefined = r.textMetrics;
  const byCat = Object.entries(
    r.errors.reduce<Record<string, number>>((acc, e) => ((acc[e.category] = (acc[e.category] ?? 0) + 1), acc), {}),
  ).sort((a, b) => b[1] - a[1]);
  const linkers = [...(m?.linkers ?? [])].sort((a, b) => b.count - a.count);
  // ponytail: optional until every stored analysis carries it (older ones predate the field).
  const opening = (m as (TextMetrics & { linkerOpeningRatio?: number }) | undefined)?.linkerOpeningRatio;
  const templated = m && opening != null && m.sentences >= 5 && opening > 0.4;
  const upgrades = r.vocabUpgrades
    .map((v) => ({ ...v, better: v.better.filter((b) => b.trim().toLowerCase() !== v.original.trim().toLowerCase()) }))
    .filter((v) => v.better.length > 0);
  return (
    <div className="space-y-8">
      {m && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">At a glance</h2>
          <Card padded={false} className="overflow-hidden">
            <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
              <Stat label="Words" value={m.words} />
              <Stat label="Paragraphs" value={m.paragraphs} />
              <Stat label="Sentences" value={m.sentences} />
              <Stat label="Avg sentence" value={`${m.avgSentenceLen.toFixed(1)} words`} tip="Band 7+ essays usually mix short and long sentences, averaging roughly 15–25 words." />
              <Stat
                label="Lexical diversity"
                value={
                  <span className="flex flex-wrap items-center gap-2">
                    MTLD {Math.round(m.mtld)}
                    <Badge tone={mtldTone(m.mtld)[0]}>{mtldTone(m.mtld)[1]}</Badge>
                  </span>
                }
                tip="MTLD: how long you keep using new words before repeating yourself. Higher is more varied. Ranges here are rough guides, not band cut-offs."
              />
              <Stat label="Unique-word ratio" value={`${Math.round(m.ttr * 100)}%`} tip="Type–token ratio. It naturally falls as essays get longer, so compare like with like." />
            </dl>
          </Card>
        </section>
      )}

      {byCat.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Mistakes by type</h2>
          <Card>
            <BarList label="Mistakes by type" rows={byCat.map(([c, n]) => ({ key: c, label: categoryLabel(c), count: n, tone: 'bad' }))} />
          </Card>
        </section>
      )}

      {linkers.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">Linking words</h2>
          <p className="mb-3 text-sm text-muted">Examiners penalise mechanical linking. Overused ones are flagged; swap some for referencing (“this trend”, “such policies”).</p>
          {templated && (
            <p className="mb-3 rounded-control bg-warn-soft px-4 py-2.5 text-sm text-warn-text">
              {Math.round(opening * m.sentences)} of {m.sentences} sentences start with a linking word. Vary your openings.
            </p>
          )}
          <Card>
            <BarList
              label="Linking words"
              rows={linkers.map((l) => {
                const over = l.overused && l.count >= 2; // a word used once is never "overused", whatever older analyses say
                return { key: l.word, label: l.word, count: l.count, tone: over ? 'warn' : 'accent', badge: over ? 'Overused' : undefined };
              })}
            />
          </Card>
        </section>
      )}

      {m && m.repeated.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Repeated words</h2>
          <ul className="flex flex-wrap gap-2">
            {m.repeated.map((w) => (
              <li key={w.word} className={clsx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm', TONE_STYLES.neutral)}>
                <span className="text-ink">{w.word}</span>
                <span className="tabular-nums">×{w.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upgrades.length > 0 && <VocabList items={upgrades} />}
    </div>
  );
}

function Stat({ label, value, tip }: { label: string; value: ReactNode; tip?: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="flex items-center gap-1 text-sm text-muted">
        {label}
        {tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function VocabList({ items }: { items: VocabUpgrade[] }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Vocabulary upgrades</h2>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {items.map((v) => (
            <li key={v.original} className="px-5 py-4">
              <p className="flex flex-wrap items-center gap-2 font-serif text-[1.0625rem]">
                <span className="text-muted">{v.original}</span>
                <ArrowRight className="size-4 text-muted" aria-label="try" />
                {v.better.map((b, i) => (
                  <span key={b} className="text-good-text">
                    {b}
                    {i < v.better.length - 1 && <span className="text-muted">,</span>}
                  </span>
                ))}
              </p>
              {v.note && <p className="mt-1 text-sm text-muted">{v.note}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
