import { computeTextMetrics, type RepeatedWord } from '@ielts/core';
import type { AnalysisError, AnalysisResult } from '@server/ai/types';
import { ArrowRight, ChevronDown, CircleCheck, Play, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { ErrorDetails } from '@/components/results';
import { InfoNote, Section, StatList } from '@/components/result';
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, ProgressBar } from '@/components/ui';
import { LeanChip } from '@/components/LeanPill';
import { answeredRelevance, categoryLabel, questionHead } from '@/lib/result';
import { plural } from '@/lib/format';
import type { AudioControls } from './AudioBar';

const ISSUE = { sound: 'Sound', stress: 'Word stress', intonation: 'Intonation', unclear: 'Unclear' };

/** Words worth listing as unclear: real words (letters only, 3+), not "-", "v" or "a...". Lowest confidence first. Pure for testing. */
export const isRealWord = (w: string) => /^[a-z']{3,}$/i.test(w);

const UNCLEAR_SHOWN = 6;

/** Language tab: errors by category, vocabulary upgrades, did you answer, word choice, pronunciation. */
export function LanguagePanel({ result, audio, lean, onLean }: { result: AnalysisResult; audio: AudioControls; lean?: RepeatedWord | null; onLean?: (w: RepeatedWord | null) => void }) {
  const words = result.words ?? [];
  const text = useMemo(() => computeTextMetrics(words.map((w) => w.w).join(' ')), [words]);
  const groups = useMemo(() => {
    const m = new Map<string, AnalysisError[]>();
    for (const e of result.errors) m.set(e.category, [...(m.get(e.category) ?? []), e]);
    return [...m].sort((a, b) => b[1].length - a[1].length);
  }, [result.errors]);
  const maxCount = groups[0]?.[1].length ?? 1;
  const bars = new Set(groups.map(([, e]) => e.length)).size > 1; // bars only say something when the counts differ
  const play = ({ time, end }: AnalysisError) => (time != null ? () => audio.seek(time, (words[end]?.end ?? time + 2) + 0.3) : undefined);
  // Same labels as the writing tab; spoken thresholds sit lower (around 70+ is typical of band 7 speech).
  const [mtldTone, mtldLabel] = text.mtld >= 70 ? (['good', 'Wide range'] as const) : text.mtld >= 50 ? (['warn', 'Adequate range'] as const) : (['bad', 'Limited range'] as const);
  const relevance = answeredRelevance(result);

  return (
    <div className="space-y-8 md:space-y-12">
      <Section title="Mistakes by type" caption={groups.length ? `${plural(result.errors.length, 'mistake')} in ${plural(groups.length, 'type')}. Select a type to see each one.` : undefined}>
        {groups.length ? (
          <ul className="max-w-[68ch] divide-y divide-line">
            {groups.map(([cat, errs]) => (
              <li key={cat}>
                <Collapsible className="group">
                  <CollapsibleTrigger className="flex min-h-12 w-full items-center gap-3 py-3 text-left">
                    <span className="type-body min-w-0 flex-1">{categoryLabel(cat)}</span>
                    {bars && <ProgressBar value={errs.length / Math.max(maxCount, 5)} label={`${errs.length} ${categoryLabel(cat)} mistakes`} className="w-24 shrink-0 sm:w-40" />}
                    <span className="type-body type-num w-8 text-right">{errs.length}</span>
                    <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="divide-y divide-line border-t border-line pl-3">
                      {errs.map((e) => (
                        <li key={e.id} className="py-4">
                          <ErrorDetails error={e} onPlay={play(e)} />
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body">No grammar or vocabulary mistakes were flagged in this answer.</p>
        )}
      </Section>

      {result.vocabUpgrades.length > 0 && (
        <Section title="Vocabulary upgrades">
          <ul className="max-w-[68ch] divide-y divide-line">
            {result.vocabUpgrades.map((v) => (
              <li key={v.original} className="space-y-2 py-4 first:pt-0">
                <p className="type-reading-sm flex flex-wrap items-center gap-2">
                  <span className="text-muted line-through decoration-muted/50">{v.original}</span>
                  <ArrowRight role="img" className="size-4 shrink-0 text-muted" aria-label="try" />
                  {v.better.map((b) => (
                    <span key={b} className="rounded-sm bg-accent-soft px-2 py-0.5 text-accent-text ring-1 ring-brand/15 ring-inset">
                      {b}
                    </span>
                  ))}
                </p>
                <p className="type-body">{v.note}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {relevance.length > 0 && (
        <Section id="relevance" title="Did you answer the question?" className="scroll-mt-20">
          <ul className="max-w-[68ch] divide-y divide-line">
            {relevance.map((r) => {
              // Cue-card text is title + body (which restates the title): show the title, then the rest muted.
              const q = questionHead(result.questions?.[r.questionIdx]?.text ?? `Question ${r.questionIdx + 1}`);
              return (
                <li key={r.questionIdx} className="flex gap-3 py-4 first:pt-0">
                  {r.onTopic ? <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-good-text" /> : <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warn-text" />}
                  <div className="min-w-0 space-y-1">
                    <p className="type-subheading">
                      Question {r.questionIdx + 1}: <span className={r.onTopic ? 'text-good-text' : 'text-warn-text'}>{r.onTopic ? 'On topic' : 'Off topic'}</span>
                    </p>
                    <p className="type-caption">{q.rest ? `${q.head} ${q.rest}` : q.head}</p>
                    <p className="type-body">{r.note}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Word choice">
        <StatList
          cols={2}
          items={[{ label: 'Lexical diversity (MTLD)', value: Math.round(text.mtld), status: { text: mtldLabel, tone: mtldTone }, info: <InfoNote label="About lexical diversity">MTLD: how long you keep using new words before repeating yourself. Higher means a wider range. Around 70+ is typical of band 7 speech.</InfoNote>, hint: text.words < 50 ? 'Short answer, so treat this number as rough.' : mtldTone !== 'good' ? 'Try synonyms and more precise words for repeated ideas.' : undefined }]}
        />
        <Section level={3} title="Words you leaned on">
          {text.repeated.length ? (
            <ul className="flex flex-wrap gap-2">
              {text.repeated.slice(0, 10).map((r) => (
                <li key={r.word}>
                  <LeanChip r={r} lean={lean} onLean={onLean} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body">No content word stood out as overused.</p>
          )}
        </Section>
      </Section>

      <Pronunciation result={result} audio={audio} />
    </div>
  );
}

function Pronunciation({ result, audio }: { result: AnalysisResult; audio: AudioControls }) {
  const words = result.words ?? [];
  const unclear = result.pronunciation?.unclear ?? [];
  const llm = result.pronunciation?.llm;
  // Lowest confidence first; the first few real words are shown, everything else sits behind a toggle.
  const ranked = [...unclear].sort((a, b) => a.conf - b.conf);
  const top = ranked.filter((u) => isRealWord(u.w)).slice(0, UNCLEAR_SHOWN);
  const rest = ranked.filter((u) => !top.includes(u));
  const row = (u: (typeof unclear)[number]) => {
    const w = words[u.wordIdx];
    return (
      <li key={u.wordIdx} className="flex items-center gap-3 py-1">
        <Button size="icon" variant="ghost" aria-label={`Play "${u.w}"`} disabled={!w} onClick={() => w && audio.seek(w.start, w.end + 0.4)}>
          <Play />
        </Button>
        <span className="type-body min-w-0 flex-1">{u.w}</span>
        <span className="type-body type-num w-12 text-right">{Math.round(u.conf * 100)}%</span>
      </li>
    );
  };
  // One badge per group instead of one per row.
  const grouped = (list: typeof unclear) =>
    ([3, 2] as const).map((tier) => ({ tier, items: list.filter((u) => (u.tier === 3 ? 3 : 2) === tier) })).filter((g) => g.items.length > 0);
  const groupBlock = (list: typeof unclear) =>
    grouped(list).map((g) => (
      <div key={g.tier} className="space-y-1">
        <Badge tone="warn">{g.tier === 3 ? 'Very low recognition confidence' : 'Lower recognition confidence'}</Badge>
        <ul className="max-w-[68ch]">{g.items.map(row)}</ul>
      </div>
    ));
  return (
    <Section title={llm ? 'Pronunciation' : 'Speech clarity hints'} caption="Low recognition confidence can reflect noise, microphone quality or unfamiliar words. It does not prove a pronunciation mistake.">
      {unclear.length === 0 && !llm && <p className="type-body">{words.some((w) => w.conf != null) ? 'No low-confidence words were flagged. This does not confirm correct pronunciation.' : 'The recogniser did not return confidence scores. Pronunciation cannot be checked from the transcript alone.'}</p>}
      {llm?.prosody && (
        <div className="max-w-[68ch] space-y-1">
          <h3 className="type-subheading">Rhythm and intonation</h3>
          <p className="type-body">{llm.prosody}</p>
        </div>
      )}
      {llm && llm.words.length > 0 && (
        <Section level={3} title="Word tips">
          <ul className="max-w-[68ch] divide-y divide-line">
            {llm.words.map((w) => (
              <li key={`${w.word}-${w.time}`} className="flex items-start gap-3 py-2 first:pt-0">
                <Button size="icon" variant="ghost" aria-label={`Play "${w.word}"`} onClick={() => audio.seek(w.time, w.time + 1.2)}>
                  <Play />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="type-subheading flex flex-wrap items-center gap-2">
                    {w.word} <Badge tone="neutral">{ISSUE[w.issue]}</Badge>
                  </p>
                  <p className="type-body mt-0.5">{w.tip}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {unclear.length > 0 && (
        <Section level={3} title="Possibly unclear words: listen again" caption="Lowest confidence first. Percentages are recognition confidence, not pronunciation accuracy, and may be approximated from a whole segment.">
          {groupBlock(top.length ? top : ranked)}
          {top.length > 0 && rest.length > 0 && (
            <Collapsible className="group">
              <CollapsibleTrigger className="type-body hit text-accent-text underline-offset-2 hover:underline">
                <span className="group-data-[state=open]:hidden">Show all {unclear.length}</span>
                <span className="hidden group-data-[state=open]:inline">Show fewer</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-3">{groupBlock(rest)}</CollapsibleContent>
            </Collapsible>
          )}
        </Section>
      )}
    </Section>
  );
}
