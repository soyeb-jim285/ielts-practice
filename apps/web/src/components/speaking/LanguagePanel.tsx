import { computeTextMetrics } from '@ielts/core';
import type { AnalysisError, AnalysisResult } from '@server/ai/types';
import { ArrowRight, ChevronDown, CircleCheck, Play, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { ErrorDetails } from '@/components/results';
import { Badge, Button, Card, InfoTip } from '@/components/ui';
import { categoryLabel } from '@/lib/result';
import type { AudioControls } from './AudioBar';

const ISSUE = { sound: 'Sound', stress: 'Word stress', intonation: 'Intonation', unclear: 'Unclear' };

/** Language tab: errors by category, vocabulary upgrades, lexical diversity, relevance, pronunciation hints. */
export function LanguagePanel({ result, audio }: { result: AnalysisResult; audio: AudioControls }) {
  const words = result.words ?? [];
  const text = useMemo(() => computeTextMetrics(words.map((w) => w.w).join(' ')), [words]);
  const groups = useMemo(() => {
    const m = new Map<string, AnalysisError[]>();
    for (const e of result.errors) m.set(e.category, [...(m.get(e.category) ?? []), e]);
    return [...m].sort((a, b) => b[1].length - a[1].length);
  }, [result.errors]);
  const maxCount = groups[0]?.[1].length ?? 1;
  const play = ({ time, end }: AnalysisError) => (time != null ? () => audio.seek(time, (words[end]?.end ?? time + 2) + 0.3) : undefined);
  const mtldTone = text.mtld >= 70 ? 'good' : text.mtld >= 50 ? 'warn' : 'bad';

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Mistakes by type</h2>
        {groups.length ? (
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {groups.map(([cat, errs]) => (
              <details key={cat} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 hover:bg-ink/[0.03] [&::-webkit-details-marker]:hidden">
                  <span className="w-40 shrink-0 truncate text-sm font-medium sm:w-56">{categoryLabel(cat)}</span>
                  <span className="h-2 min-w-0 flex-1 rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(errs.length / maxCount) * 100}%` }} />
                  </span>
                  <span className="w-6 text-right text-sm tabular-nums">{errs.length}</span>
                  <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="divide-y divide-line bg-surface-2">
                  {errs.map((e) => (
                    <li key={e.id} className="px-5 py-4">
                      <ErrorDetails error={e} onPlay={play(e)} />
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </Card>
        ) : (
          <p className="text-sm text-muted">No grammar or vocabulary mistakes were flagged.</p>
        )}
      </section>

      {result.vocabUpgrades.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Vocabulary upgrades</h2>
          <Card padded={false} className="divide-y divide-line">
            {result.vocabUpgrades.map((v) => (
              <div key={v.original} className="space-y-2 px-5 py-4">
                <p className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
                  <span className="text-muted">{v.original}</span>
                  <ArrowRight className="size-4 text-muted" aria-label="try" />
                  {v.better.map((b) => (
                    <Badge key={b} tone="accent" className="h-7 text-sm">
                      {b}
                    </Badge>
                  ))}
                </p>
                <p className="text-sm text-muted">{v.note}</p>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-1 text-base font-semibold">
            Lexical diversity
            <InfoTip label="About lexical diversity">MTLD: how long you keep using new words before repeating yourself. Higher means a wider range. Around 70+ is typical of band 7 speech.</InfoTip>
          </h2>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{Math.round(text.mtld)}</p>
          <div className="mt-3 h-2 rounded-full bg-surface-2" role="meter" aria-label="Lexical diversity" aria-valuemin={0} aria-valuemax={120} aria-valuenow={Math.round(text.mtld)}>
            <div className={`h-full rounded-full ${mtldTone === 'good' ? 'bg-good' : mtldTone === 'warn' ? 'bg-warn' : 'bg-bad'}`} style={{ width: `${Math.min(100, (text.mtld / 120) * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">{text.words < 50 ? 'Short answer — treat this number as rough.' : mtldTone === 'good' ? 'Wide range for spoken English.' : 'Try synonyms and more precise words for repeated ideas.'}</p>
        </Card>
        <Card>
          <h2 className="text-base font-semibold">Words you leaned on</h2>
          {text.repeated.length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {text.repeated.slice(0, 10).map((r) => (
                <li key={r.word}>
                  <Badge tone="warn" className="h-7 text-sm">
                    {r.word} <span className="tabular-nums">×{r.count}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">No content word stood out as overused.</p>
          )}
        </Card>
      </section>

      {result.relevance && result.relevance.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Did you answer the question?</h2>
          <Card padded={false} className="divide-y divide-line">
            {result.relevance.map((r) => (
              <div key={r.questionIdx} className="flex gap-3 px-5 py-4">
                {r.onTopic ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-good-text" aria-label="On topic" /> : <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn-text" aria-label="Off topic" />}
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-medium">{result.questions?.[r.questionIdx]?.text ?? `Question ${r.questionIdx + 1}`}</p>
                  <p className="mt-0.5 text-sm text-muted">{r.note}</p>
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}

      <Pronunciation result={result} audio={audio} />
    </div>
  );
}

function Pronunciation({ result, audio }: { result: AnalysisResult; audio: AudioControls }) {
  const words = result.words ?? [];
  const unclear = result.pronunciation?.unclear ?? [];
  const llm = result.pronunciation?.llm;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Pronunciation</h2>
      <p className="mb-3 text-sm text-muted">Pronunciation hints are estimates from speech recognition, not a phoneme-level assessment.</p>
      <Card padded={false} className="divide-y divide-line">
        {unclear.length === 0 && !llm && <p className="px-5 py-4 text-sm text-muted">Speech recognition understood every word clearly.</p>}
        {unclear.map((u) => {
          const w = words[u.wordIdx];
          return (
            <div key={u.wordIdx} className="flex items-center gap-3 px-5 py-3">
              <Button size="icon" variant="ghost" aria-label={`Play "${u.w}"`} disabled={!w} onClick={() => w && audio.seek(w.start, w.end + 0.4)}>
                <Play />
              </Button>
              <span className="min-w-0 flex-1 font-medium">{u.w}</span>
              <Badge tone={u.tier === 3 ? 'bad' : 'warn'}>{u.tier === 3 ? 'Hard to recognise' : 'Slightly unclear'}</Badge>
              <span className="w-12 text-right text-xs text-muted tabular-nums">{Math.round(u.conf * 100)}%</span>
            </div>
          );
        })}
        {llm?.words.map((w) => (
          <div key={`${w.word}-${w.time}`} className="flex items-start gap-3 px-5 py-3">
            <Button size="icon" variant="ghost" aria-label={`Play "${w.word}"`} onClick={() => audio.seek(w.time, w.time + 1.2)}>
              <Play />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {w.word} <Badge tone="neutral">{ISSUE[w.issue]}</Badge>
              </p>
              <p className="mt-0.5 text-sm text-muted">{w.tip}</p>
            </div>
          </div>
        ))}
        {llm?.prosody && (
          <div className="px-5 py-4">
            <p className="text-sm font-medium">Rhythm and intonation</p>
            <p className="mt-1 text-sm text-muted">{llm.prosody}</p>
          </div>
        )}
      </Card>
    </section>
  );
}
