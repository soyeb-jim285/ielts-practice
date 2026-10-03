import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, ChevronRight, Play, RotateCcw, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { audioWindow, evidenceSpan, questionMoments, sectionParagraphs, type GapEntry, type LrTimings } from '@ielts/core';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, buttonStyles, CountUp, PageContainer, PageHeader, ProgressBar, Segmented, Tabs, type Tone } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, formatClock, formatDate, formatDuration } from '@/lib/format';
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

function Disclose({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <details className="group/d mb-3 rounded-lg border border-line bg-card">
      <summary className="flex min-h-14 cursor-pointer select-none items-center gap-2 px-4 py-2">
        <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-open/d:rotate-90" aria-hidden />
        <span className="min-w-0">
          <span className="type-subheading block">{title}</span>
          <span className="type-caption block">{hint}</span>
        </span>
      </summary>
      <div className="border-t border-line px-4 pt-5">{children}</div>
    </details>
  );
}

function Accuracy({ title, rows }: { title: string; rows: { label: string; right: number; total: number }[] }) {
  return (
    <section>
      {title && <h2 className="type-heading mb-3">{title}</h2>}
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
  const wrongCount = (attempt.total ?? flat.length) - (attempt.raw ?? 0);
  const [wrongOnly, setWrongOnly] = useState(wrongCount > 0);
  const [by, setBy] = useState<'type' | 'part'>('type');
  const [tab, setTab] = useState<'overview' | 'answers' | 'context'>('overview');
  const [partIdx, setPartIdx] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const tabsTop = useRef<HTMLDivElement>(null);
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
    setTab('context');
    tabsTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
    setTab('context');
    tabsTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  // listening: when each question is answered in its recording (needs word timings, else review.at)
  const moments = useMemo(() => new Map(listening ? test.sections.flatMap((s) => questionMoments({ timings: s.timings as LrTimings | undefined, groups: s.groups }).map((m) => [m.n, m] as const)) : []), [test, listening]);
  const pins = questionMoments({ timings: section.timings as LrTimings | undefined, groups: section.groups }).map((m) => ({ n: m.n, at: m.at, approx: !m.exact, correct: !!marks.get(m.n)?.correct }));
  const tpins = useMemo(() => {
    if (!listening) return [];
    const paras = sectionParagraphs(section);
    return section.groups.flatMap((g) => g.questions.flatMap((q) => {
      const sp = evidenceSpan(paras, q, g.type === 'gap');
      return sp ? [{ p: sp.p, s: sp.s, n: q.n, correct: !!marks.get(q.n)?.correct }] : [];
    }));
  }, [section, marks, listening]);
  const pickQ = (n: number) => { jump(n); play(n); };
  const blank = flat.filter((f) => !marks.get(f.n)?.given).map((f) => f.n);
  const rows = flat.filter((f) => !wrongOnly || !marks.get(f.n)?.correct);
  const slips = (attempt.analysis?.gaps ?? []).filter((g) => g.kind === 'spelling' || g.kind === 'plural').length;
  const weak = byType.filter((r) => r.total >= 3 && r.right < r.total).sort((a, b) => a.right / a.total - b.right / b.total)[0];
  const takeaways = [
    weak && `Weakest: ${weak.label.toLowerCase()}, ${weak.right} of ${weak.total} right.`,
    slips > 0 && `${slips} ${slips === 1 ? 'answer was' : 'answers were'} the right word with a spelling or plural slip.`,
    blank.length > 0 && `${blank.length} left blank. There is no penalty for guessing.`,
    wrongCount === 0 && 'Every answer was correct.',
  ].filter(Boolean).slice(0, 3) as string[];
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

      <div className="mb-8 border-y border-line py-5 sm:py-6">
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
        {wrongCount > 0 && (
          <Button className="mt-5" onClick={() => { setWrongOnly(true); setTab('answers'); }}>
            See your {wrongCount} {wrongCount === 1 ? 'mistake' : 'mistakes'}
          </Button>
        )}
        {takeaways.length > 0 && (
          <ul className="mt-5 space-y-1.5 border-t border-line pt-4">
            {takeaways.map((t) => (
              <li key={t} className="type-body flex max-w-[68ch] gap-2 text-pretty">
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand" />
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div ref={tabsTop} className="scroll-mt-4">
        <Tabs
          id="res-tab"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'overview', label: 'Summary' },
            { value: 'answers', label: 'Answers', count: wrongCount > 0 ? wrongCount : undefined },
            { value: 'context', label: listening ? 'Transcript' : 'Passage' },
          ]}
        />
      </div>
      <div role="tabpanel" id="res-tab-panel" aria-labelledby={`res-tab-${tab}`} className="pt-6 sm:pt-8">
        {tab === 'overview' && (
          <>
            <section aria-labelledby="lost-h" className="mb-8">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 id="lost-h" className="type-heading">Where you lost marks</h2>
                <Segmented label="Group by" size="sm" value={by} onChange={setBy} options={[{ value: 'type', label: 'Question type' }, { value: 'part', label: noun }]} />
              </div>
              <Accuracy title="" rows={(by === 'type' ? byType : byPart).slice().sort((a, b) => a.right / a.total - b.right / b.total)} />
            </section>
            {attempt.stats && (
              <Disclose title="How you used your time" hint="Minutes per part, answers you changed, last-minute answers">
                <PacingPanel
                  stats={attempt.stats}
                  parts={test.sections.map((s) => ({ part: s.part, questions: s.groups.flatMap((g) => g.questions.map((q) => q.n)) }))}
                  noun={noun}
                  totalS={listening ? undefined : 3600}
                  marks={marks}
                  blank={blank}
                />
              </Disclose>
            )}
            {((attempt.analysis?.tfng ?? []).length > 0) && (
              <Disclose title="True / False / Not Given" hint="Which statements you mix up, and the rule for each">
                <TfngPanel rows={(attempt.analysis?.tfng ?? []) as never} pattern={insights.data?.tfng.pattern as never} />
              </Disclose>
            )}
          </>
        )}

        {tab === 'answers' && (
          <section aria-labelledby="review-h">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="review-h" className="type-heading">
                Your answers
              </h2>
              <Segmented label="Filter" size="sm" value={wrongOnly ? 'wrong' : 'all'} onChange={(v) => setWrongOnly(v === 'wrong')} options={[{ value: 'all', label: `All ${flat.length}` }, { value: 'wrong', label: `Wrong only (${wrongCount})` }]} />
            </div>
            <p className="type-caption mb-3">Tap a question to see why it is wrong and where the answer is.</p>
            {rows.length === 0 ? (
              <p className="type-lede border-t border-line pt-4">Nothing wrong. Every answer was correct.</p>
            ) : (
              <div className="overflow-x-auto border-y border-line">
                <table className="w-full text-left text-body">
                  <thead className="type-caption">
                    <tr className="border-b border-line">
                      <th scope="col" className="w-14 py-2 pr-2 font-medium">No.</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Your answer</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Correct answer</th>
                      {listening && <th scope="col" className="py-2 pr-3 font-medium max-sm:sr-only">Listen from</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((f) => {
                      const m = marks.get(f.n);
                      const open = selected === f.n;
                      const fs = test.sections.find((x) => x.part === f.part)!;
                      const mo = moments.get(f.n);
                      return (
                        <Fragment key={f.n}>
                          <tr id={`qrow-${f.n}`} className={cn('hover:bg-hover', open && 'bg-accent-soft/40')}>
                            <td className="py-0">
                              <button type="button" onClick={() => setSelected(open ? null : f.n)} aria-expanded={open} aria-label={`Question ${f.n}, ${m?.correct ? 'correct' : 'wrong'}: explain`} className="type-num flex h-11 w-full items-center gap-1.5 font-semibold text-accent-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
                                {m?.correct ? <Check className="size-4 shrink-0 text-good-text" aria-hidden /> : <X className="size-4 shrink-0 text-bad-text" aria-hidden />}
                                {f.n}
                              </button>
                            </td>
                            <td className={cn('py-2 pr-3', !m?.given && 'text-muted italic', m && !m.correct && 'text-bad-text')}>{m?.given || 'No answer'}</td>
                            <td className="py-2 pr-3 font-medium">{m?.answer.join(' / ')}</td>
                            {listening && (
                              <td className="py-0 pr-1">
                                {mo && (
                                  <button type="button" onClick={() => pickQ(f.n)} aria-label={`Question ${f.n}: play from Part ${f.part} at ${formatClock(mo.at)}${mo.exact ? '' : ', approximate'}`} className="type-num inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm font-medium text-accent-text hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
                                    <Play className="size-3 fill-current" aria-hidden />
                                    <span className="max-sm:hidden">Part {f.part} · </span>{mo.exact ? '' : '~'}{formatClock(mo.at)}
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={listening ? 4 : 3} className="bg-surface-2/40 px-0 py-3 sm:px-3">
                                <QuestionDetail q={f.q} group={f.group} section={fs} mark={m} entry={entries.get(f.n)} onClose={() => setSelected(null)} onShow={() => jump(f.n)} onPlay={() => play(f.n)} onDictate={() => setDict(f.n)} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === 'context' && (
          <section aria-labelledby="ctx-h">
            <h2 id="ctx-h" className="sr-only">{listening ? 'Transcript and questions' : 'Passage and questions'}</h2>
            <p className="type-caption mb-3 max-w-[68ch]">{listening ? 'Replay any part, read the transcript, and see every question with its marking. Coloured numbers on the audio bar show where each answer is spoken.' : 'Read the passage next to your marked answers. Tap a question number in Answers to highlight where its answer is.'}</p>
            <Tabs id="res-part" value={String(section.part)} onChange={(v) => setPartIdx(test.sections.findIndex((s) => s.part === +v))} items={test.sections.map((s) => ({ value: String(s.part), label: `${noun} ${s.part}` }))} />
            <div role="tabpanel" id="res-part-panel" aria-labelledby={`res-part-${section.part}`} className="pt-6">
              {sel && selSection && (
                <div className="mb-6">
                  <QuestionDetail q={sel.q} group={sel.group} section={selSection} mark={marks.get(sel.n)} entry={entries.get(sel.n)} onClose={() => setSelected(null)} onShow={sel.part !== section.part ? () => jump(sel.n) : undefined} onPlay={() => play(sel.n)} onDictate={() => setDict(sel.n)} />
                </div>
              )}
              {listening && (
                <div className="mb-8 space-y-4">
                  <div className="sticky top-0 z-10 rounded-lg border border-line bg-card px-4 py-3">
                    <PracticeAudio key={section.audio} src={assets[section.audio ?? ''] ?? ''} label={`Part ${section.part}`} cue={cue?.part === section.part ? cue : null} pins={pins} pinned={selected} onPin={pickQ} />
                  </div>
                  {section.transcript && (
                    <details className="group rounded-lg border border-line bg-card" open>
                      <summary className="type-subheading cursor-pointer px-4 py-3 select-none">Transcript</summary>
                      <div data-scrollpane className="type-reading max-h-[28rem] overflow-y-auto border-t border-line px-4 py-4">
                        <Transcript text={section.transcript} evidence={mark} pins={tpins} picked={selected} onPin={(n) => setSelected(n)} />
                      </div>
                    </details>
                  )}
                </div>
              )}
              <VocabList section={section} />
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
        )}
      </div>
      {dict != null && sel && sel.n === dict && selSection && <Dictation open onClose={() => setDict(null)} src={assets[selSection.audio ?? ''] ?? ''} section={selSection} q={sel.q} />}
    </PageContainer>
  );
}
