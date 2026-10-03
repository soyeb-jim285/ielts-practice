import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, RotateCcw, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { audioWindow, evidenceSpan, sectionParagraphs, type GapEntry, type LrTimings } from '@ielts/core';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, buttonStyles, CountUp, PageContainer, PageHeader, ProgressBar, Segmented, Tabs, type Tone } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, formatDate, formatDuration } from '@/lib/format';
import { accuracyBy, flatQuestions, lrProgressQuery, typeLabel, type LrAttempt } from '@/lib/lr';
import { useMe } from '@/lib/query';
import { bandColor } from '@/lib/result';
import { cn } from '@/lib/utils';
import { PracticeAudio } from './Audio';
import { Passage, Transcript } from './Passage';
import { Dictation, PacingPanel, QuestionDetail, TfngPanel, VocabList } from './ReviewPanels';
import { GroupsPane } from './Runner';
import type { Mark } from './QuestionGroup';

const TONE_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };
const ratioTone = (r: number): Tone => (r >= 0.75 ? 'good' : r >= 0.5 ? 'warn' : 'bad');

function Accuracy({ title, rows }: { title: string; rows: { label: string; right: number; total: number }[] }) {
  return (
    <section>
      <h2 className="type-heading mb-3">{title}</h2>
      <ul className="divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3">
            <span className="type-body min-w-0">{r.label}</span>
            <span className="type-num type-subheading">
              {r.right}/{r.total}
            </span>
            <ProgressBar label={`${r.label}: ${r.right} of ${r.total} correct`} value={r.total ? r.right / r.total : 0} tone={ratioTone(r.total ? r.right / r.total : 0)} className="col-span-2 h-1.5" />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Results({ attempt }: { attempt: LrAttempt }) {
  const { test, assets } = attempt;
  const listening = test.skill === 'listening';
  const navigate = useNavigate();
  const target = useMe().data?.settings.targetBand ?? 7;
  const marks = useMemo(() => new Map<number, Mark>((attempt.marks ?? []).map((m) => [m.n, m])), [attempt.marks]);
  const flat = useMemo(() => flatQuestions(test), [test]);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [partIdx, setPartIdx] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const ctx = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [cue, setCue] = useState<{ part: number; from: number; to: number; id: number } | null>(null);
  const [dict, setDict] = useState<number | null>(null);
  const insights = useQuery(lrProgressQuery);
  const entries = useMemo(() => new Map<number, GapEntry>((attempt.analysis?.gaps ?? []).map((g) => [g.n, g as GapEntry])), [attempt.analysis]);
  const section = test.sections[partIdx]!;
  const band = attempt.band ?? 0;
  const gap = target - band;
  const noun = listening ? 'Part' : 'Passage';

  const byPart = test.sections.map((s) => {
    const qs = s.groups.flatMap((g) => g.questions.map((q) => marks.get(q.n)));
    return { label: `${noun} ${s.part}`, right: qs.filter((m) => m?.correct).length, total: qs.length };
  });
  const byType = accuracyBy(test, attempt.marks ?? [], (f) => typeLabel(f.group));

  const jump = (n: number) => {
    const f = flat.find((x) => x.n === n);
    if (!f) return;
    setPartIdx(test.sections.findIndex((s) => s.part === f.part));
    setActive(n);
    setSelected(n);
    ctx.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setTimeout(() => setActive((a) => (a === n ? null : a)), 3000);
  };

  const retake = async () => {
    setBusy(true);
    try {
      const a = await call(client.POST('/api/lr/tests/{id}/attempts', { params: { path: { id: attempt.testId } }, body: { mode: attempt.mode } }));
      await navigate({ to: '/lr/run/$attemptId', params: { attemptId: a.id } });
    } finally {
      setBusy(false);
    }
  };

  const sel = selected != null ? flat.find((f) => f.n === selected) : undefined;
  const selSection = sel ? test.sections.find((s) => s.part === sel.part) : undefined;
  const span = useMemo(() => (sel && selSection ? evidenceSpan(sectionParagraphs(selSection), sel.q, sel.group.type === 'gap') : null), [sel, selSection]);
  const mark = span && selSection?.part === section.part ? span : null;
  // bring the evidence into view inside its own pane (not the whole page)
  useEffect(() => {
    if (!mark) return;
    const t = setTimeout(() => {
      // each pane scrolls on its own: the passage / transcript to the evidence, the question list to the question
      for (const m of [document.querySelector<HTMLElement>('[data-evidence]'), selected ? (document.getElementById(`q-${selected}`) ?? document.getElementById(`qrow-${selected}`)) : null]) {
        const pane = m?.closest<HTMLElement>('[data-scrollpane]');
        if (m && pane) pane.scrollTop += m.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 3;
      }
    }, 500);
    return () => clearTimeout(t);
  }, [mark, partIdx, selected]);
  const play = (n: number) => {
    const f = flat.find((x) => x.n === n);
    const s = test.sections.find((x) => x.part === f?.part);
    const w = f && s && audioWindow({ timings: s.timings as LrTimings | undefined }, f.q);
    if (!w || !s) return;
    setPartIdx(test.sections.indexOf(s));
    setCue({ part: s.part, from: w.from, to: w.to, id: Date.now() });
    ctx.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const blank = flat.filter((f) => !marks.get(f.n)?.given).map((f) => f.n);
  const rows = flat.filter((f) => !wrongOnly || !marks.get(f.n)?.correct);
  const time = attempt.elapsedS ? formatDuration(attempt.elapsedS * 1000) : null;

  return (
    <PageContainer>
      <PageHeader
        back={
          <Link to={listening ? '/listening' : '/reading'} className={buttonStyles({ variant: 'link' })}>
            <ArrowLeft className="size-4" aria-hidden /> All {test.skill} tests
          </Link>
        }
        title={test.title}
        description={`${listening ? 'Listening' : 'Reading'}, ${test.variant === 'academic' ? 'Academic' : 'General Training'}, ${attempt.mode} mode, ${formatDate(attempt.submittedAt ?? attempt.startedAt)}${time ? `, ${time}` : ''}`}
        actions={
          <Button icon={<RotateCcw />} loading={busy} onClick={retake}>
            Retake
          </Button>
        }
      />

      <div className="mb-10 border-y border-line py-5 sm:py-6">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
          <div>
            <p className="type-caption">Band</p>
            <p className="type-band text-6xl sm:text-7xl">
              <span className="sr-only">Band </span>
              <CountUp value={band} decimals={1} />
            </p>
          </div>
          <div className="space-y-1.5 pb-1">
            <p className="type-band text-3xl">
              {attempt.raw}
              <span className="text-muted">/{attempt.total}</span>
              <span className="type-caption ml-2 font-normal">correct</span>
            </p>
            <p className="type-lede type-num">
              <span className={cn('font-medium', TONE_TEXT[bandColor(band, target)])}>{gap <= 0 ? 'At or above' : `${formatBand(gap)} below`}</span> your {formatBand(target)} target
            </p>
          </div>
        </div>
      </div>

      <div className="mb-12 grid gap-x-12 gap-y-10 md:grid-cols-2">
        <Accuracy title={`By ${noun.toLowerCase()}`} rows={byPart} />
        <Accuracy title="By question type" rows={byType} />
      </div>

      {attempt.stats && (
        <PacingPanel
          stats={attempt.stats}
          parts={test.sections.map((s) => ({ part: s.part, questions: s.groups.flatMap((g) => g.questions.map((q) => q.n)) }))}
          noun={noun}
          totalS={listening ? undefined : 3600}
          marks={marks}
          blank={blank}
        />
      )}
      <TfngPanel rows={(attempt.analysis?.tfng ?? []) as never} pattern={insights.data?.tfng.pattern as never} />

      <section className="mb-12" aria-labelledby="review-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="review-h" className="type-heading">
            Your answers
          </h2>
          <Segmented label="Filter" size="sm" value={wrongOnly ? 'wrong' : 'all'} onChange={(v) => setWrongOnly(v === 'wrong')} options={[{ value: 'all', label: `All ${flat.length}` }, { value: 'wrong', label: `Wrong only (${flat.length - (attempt.raw ?? 0)})` }]} />
        </div>
        {rows.length === 0 ? (
          <p className="type-lede border-t border-line pt-4">Nothing wrong. Every answer was correct.</p>
        ) : (
          <div className="overflow-x-auto border-y border-line">
            <table className="w-full min-w-[30rem] text-left text-body">
              <thead className="type-caption">
                <tr className="border-b border-line">
                  <th scope="col" className="w-14 py-2 pr-3 font-medium">No.</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Your answer</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Correct answer</th>
                  <th scope="col" className="w-10 py-2 font-medium"><span className="sr-only">Result</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((f) => {
                  const m = marks.get(f.n);
                  const fs = test.sections.find((x) => x.part === f.part)!;
                  return (
                    <Fragment key={f.n}>
                    <tr className="hover:bg-hover">
                      <td className="py-0">
                        <button type="button" onClick={() => (selected === f.n ? setSelected(null) : jump(f.n))} aria-expanded={selected === f.n} aria-label={`Question ${f.n}: explain and show in context`} className="type-num flex h-11 w-full items-center font-semibold text-accent-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
                          {f.n}
                        </button>
                      </td>
                      <td className={cn('py-2 pr-3', !m?.given && 'text-muted italic', m && !m.correct && 'text-bad-text')}>{m?.given || 'No answer'}</td>
                      <td className="py-2 pr-3 font-medium">{m?.answer.join(' / ')}</td>
                      <td className="py-2">{m?.correct ? <Check className="size-4 text-good-text" aria-label="Correct" /> : <X className="size-4 text-bad-text" aria-label="Wrong" />}</td>
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section ref={ctx} aria-labelledby="ctx-h" className="scroll-mt-4">
        <h2 id="ctx-h" className="type-heading mb-1">
          {listening ? 'Transcript and questions' : 'Passage and questions'}
        </h2>
        <p className="type-caption mb-4">Pick a number in the table above to explain that question and mark where the answer is.</p>
        <Tabs id="res-part" value={String(section.part)} onChange={(v) => setPartIdx(test.sections.findIndex((s) => s.part === +v))} items={test.sections.map((s) => ({ value: String(s.part), label: `${noun} ${s.part}` }))} />
        <div role="tabpanel" id="res-part-panel" aria-labelledby={`res-part-${section.part}`} className="pt-6">
          {sel && selSection && (
            <div className="mb-8">
              <QuestionDetail q={sel.q} group={sel.group} section={selSection} mark={marks.get(sel.n)} entry={entries.get(sel.n)} onClose={() => setSelected(null)} onShow={sel.part !== section.part ? () => jump(sel.n) : undefined} onPlay={() => play(sel.n)} onDictate={() => setDict(sel.n)} />
            </div>
          )}
          <VocabList section={section} />
          {listening && (
            <div className="mb-8 space-y-4">
              <div className="sticky top-0 z-10 rounded-lg border border-line bg-card px-4 py-3 shadow-card">
                <PracticeAudio key={section.audio} src={assets[section.audio ?? ''] ?? ''} label={`Part ${section.part}`} cue={cue?.part === section.part ? cue : null} />
              </div>
              {section.transcript && (
                <details className="group rounded-lg border border-line bg-card" open>
                  <summary className="type-subheading cursor-pointer px-4 py-3 select-none">Transcript</summary>
                  <div data-scrollpane className="type-reading max-h-[28rem] overflow-y-auto border-t border-line px-4 py-4">
                    <Transcript text={section.transcript} evidence={mark} />
                  </div>
                </details>
              )}
            </div>
          )}
          <div className={cn(!listening && 'grid gap-8 lg:grid-cols-2')}>
            {!listening && (
              <div data-scrollpane className="max-h-[75vh] overflow-y-auto rounded-lg border border-line bg-card p-5 lg:sticky lg:top-4">
                <Passage section={section} evidence={mark} />
              </div>
            )}
            <div data-scrollpane={listening ? undefined : ''} className={cn(!listening && 'max-h-[75vh] overflow-y-auto pr-1')}>
              <GroupsPane section={section} responses={attempt.responses} onChange={() => {}} assets={assets} active={active} review={marks} />
            </div>
          </div>
        </div>
      </section>
      {dict != null && sel && sel.n === dict && selSection && <Dictation open onClose={() => setDict(null)} src={assets[selSection.audio ?? ''] ?? ''} section={selSection} q={sel.q} />}
    </PageContainer>
  );
}
