import { useNavigate } from '@tanstack/react-router';
import { Check, Play, RotateCcw, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { audioWindow, evidenceSpan, questionMoments, sectionParagraphs, type GapEntry, type LrTimings } from '@ielts/core';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { RemoveAttempt } from '@/components/history/RemoveAttempt';
import { ActionRow, Disclosure, RankedList, ResultScaffold, ScoreHero, Section, StatusLine } from '@/components/result';
import { Button, Segmented, Tabs } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatClock, formatDate, formatDuration } from '@/lib/format';
import { accuracyBy, flatQuestions, lrProgressQuery, partsLabel, readingSeconds, typeLabel, type LrAttempt } from '@/lib/lr';
import { useMe } from '@/lib/query';
import { cn } from '@/lib/utils';
import { PracticeAudio } from './Audio';
import { Passage, Transcript } from './Passage';
import { Dictation, PacingPanel, QuestionDetail, TextButton, TfngPanel, VocabList } from './ReviewPanels';
import { GroupsPane } from './Runner';
import type { Mark } from './QuestionGroup';

export function Results({ attempt }: { attempt: LrAttempt }) {
  const { test, assets } = attempt;
  const listening = test.skill === 'listening';
  const navigate = useNavigate();
  const target = useMe().data?.settings.targetBand ?? 7;
  const marks = useMemo(() => new Map<number, Mark>((attempt.marks ?? []).map((m) => [m.n, m])), [attempt.marks]);
  const flat = useMemo(() => flatQuestions(test), [test]);
  const wrongCount = (attempt.total ?? flat.length) - (attempt.raw ?? 0);
  const [wrongOnly, setWrongOnly] = useState(wrongCount > 0);
  const [pace, setPace] = useState(0);
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
      const a = await call(client.POST('/api/lr/tests/{id}/attempts', { params: { path: { id: attempt.testId } }, body: { mode: attempt.mode, ...(attempt.parts && { parts: attempt.parts }) } }));
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
      // phones have no inner scroll panes (the page scrolls), so a pane that does not overflow leaves the page to bring the evidence into view
      for (const [i, m] of [document.querySelector<HTMLElement>('[data-evidence]'), selected ? (document.getElementById(`q-${selected}`) ?? document.getElementById(`qrow-${selected}`)) : null].entries()) {
        const pane = m?.closest<HTMLElement>('[data-scrollpane]');
        if (m && pane && pane.scrollHeight > pane.clientHeight + 1) pane.scrollTop += m.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 3;
        else if (m && i === 0) m.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [mark, partIdx, selected, tab]);
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
  const causes = attempt.analysis?.causes ?? [];
  const slips = causes.find((c) => c.family === 'slip')?.questions.length ?? (attempt.analysis?.gaps ?? []).filter((g) => g.kind === 'spelling' || g.kind === 'plural').length;
  // across tests: the cause that costs this skill the most, once there is enough to say so
  const pastCauses = (insights.data?.causes ?? []).filter((c) => c.skill === test.skill);
  const pastLost = pastCauses.reduce((n, c) => n + c.count, 0);
  const trend = pastLost >= 10 && pastCauses[0] ? `Across your ${test.skill} tests, "${pastCauses[0].label.toLowerCase()}" costs you the most: ${pastCauses[0].count} of ${pastLost} lost marks.` : undefined;
  const openAnswer = (n: number) => {
    setWrongOnly(true);
    setTab('answers');
    setSelected(n);
    setTimeout(() => document.getElementById(`qrow-${n}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
  };
  const weak = byType.filter((r) => r.total >= 3 && r.right < r.total).sort((a, b) => a.right / a.total - b.right / b.total)[0];
  const time = attempt.elapsedS ? formatDuration(attempt.elapsedS * 1000) : null;
  const toMistakes = () => { setWrongOnly(true); setTab('answers'); };
  const toPacing = () => {
    setTab('overview');
    setPace((n) => n + 1);
    setTimeout(() => document.getElementById('pacing')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  };
  // two plain sentences at most, each ending in the place that explains it. The weakest type leads "Where you lost marks" instead.
  const takeaways = [
    wrongCount === 0 && <>Every answer was correct.</>,
    slips > 0 && <>{slips} {slips === 1 ? 'answer had' : 'answers had'} the right idea but lost the mark on spelling, wording or the box. <TextButton onClick={toMistakes}>See {slips === 1 ? 'it' : 'them'}</TextButton></>,
    blank.length > 0 && <>{blank.length} left blank. <TextButton onClick={attempt.stats ? toPacing : toMistakes}>See which</TextButton></>,
  ].filter(Boolean).slice(0, 2);
  const rowsBy = (by === 'type' ? byType : byPart).map((r) => ({ label: r.label, right: r.right, total: r.total }));
  const wrongLabel = `${wrongCount} ${wrongCount === 1 ? 'mistake' : 'mistakes'}`;
  const whole = !attempt.parts;

  return (
    <ResultScaffold
      back={{ to: listening ? '/listening' : '/reading', label: `All ${test.skill} tests` }}
      title={test.title}
      meta={<StatusLine items={[test.variant === 'academic' ? 'Academic' : 'General Training', attempt.parts && partsLabel(test.skill, attempt.parts), `${attempt.mode} mode`, formatDate(attempt.submittedAt ?? attempt.startedAt), time]} />}
      actions={<RemoveAttempt kind="lr" id={attempt.id} title={test.title} variant="menu" onRemoved={() => void navigate({ to: listening ? '/listening' : '/reading' })} />}
      hero={
        whole ? (
          <ScoreHero value={attempt.band ?? null} label="Band" target={target} secondary={`${attempt.raw} of ${attempt.total} correct`} emptyText="No band for this attempt." />
        ) : (
          // a part on its own has no band: IELTS bands only map from all 40 questions
          <ScoreHero unit="raw" value={attempt.raw ?? 0} total={attempt.total ?? 0} label="Score" lede={`${partsLabel(test.skill, attempt.parts!)} only. Take the full test for a band score.`} />
        )
      }
      action={
        <div className="space-y-4">
          <ActionRow
            primary={wrongCount > 0 ? <Button onClick={toMistakes}>Review your {wrongLabel}</Button> : <Button variant="outline" icon={<RotateCcw />} loading={busy} onClick={retake}>Retake</Button>}
            links={wrongCount > 0 ? [<Button key="r" variant="outline" icon={<RotateCcw />} loading={busy} onClick={retake}>Retake</Button>] : undefined}
          />
          {takeaways.length > 0 && (
            <div className="max-w-[68ch] space-y-1">
              <h3 className="type-caption font-semibold text-ink">Worth a second look</h3>
              {takeaways.map((t, i) => (
                <p key={i} className="type-caption text-pretty">{t}</p>
              ))}
            </div>
          )}
        </div>
      }
    >
      <div>
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
        <div role="tabpanel" id="res-tab-panel" aria-labelledby={`res-tab-${tab}`} className="space-y-8 pt-6 sm:pt-8 md:space-y-12">
          {tab === 'overview' && (
            <>
              {causes.length > 0 && (
                <Section title="Why you lost marks" caption={trend ?? 'Every wrong or blank answer, grouped by what went wrong. Tap a number to see that answer.'}>
                  <RankedList
                    mode="count"
                    rows={causes.map((c) => ({
                      label: c.label,
                      right: c.questions.length,
                      total: wrongCount,
                      hint: (
                        <>
                          <span className="block max-w-[68ch] text-pretty">{c.message}</span>
                          <span className="mt-1 flex flex-wrap gap-1" aria-label={`Questions: ${c.label}`}>
                            {c.questions.map((n) => (
                              <button key={n} type="button" onClick={() => openAnswer(n)} aria-label={`Question ${n}: see why`} className="type-caption type-num hit inline-flex h-7 min-w-7 items-center justify-center rounded-sm border border-line px-1.5 text-accent-text hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:h-9 max-md:min-w-9">
                                {n}
                              </button>
                            ))}
                          </span>
                        </>
                      ),
                    }))}
                  />
                </Section>
              )}
              <Section
                title="Where you lost marks"
                caption={weak ? `Weakest: ${weak.label.toLowerCase()}, ${weak.right} of ${weak.total} right.` : undefined}
                aside={<Segmented label="Group by" size="sm" value={by} onChange={setBy} options={[{ value: 'type', label: 'Question type' }, { value: 'part', label: noun }]} />}
              >
                <RankedList mode="accuracy" rows={rowsBy} />
              </Section>
              {(attempt.stats || (attempt.analysis?.tfng ?? []).length > 0) && (
                <div id="pacing" className="scroll-mt-4">
                  {attempt.stats && (
                    <Disclosure key={`pace${pace}`} level={2} title="How you used your time" defaultOpen={pace > 0}>
                      <p className="type-caption">Minutes per part, answers you changed, last-minute answers.</p>
                      <PacingPanel
                        stats={attempt.stats}
                        parts={test.sections.map((s) => ({ part: s.part, questions: s.groups.flatMap((g) => g.questions.map((q) => q.n)) }))}
                        noun={noun}
                        totalS={listening ? undefined : readingSeconds(attempt.parts)}
                        marks={marks}
                        blank={blank}
                      />
                    </Disclosure>
                  )}
                  {(attempt.analysis?.tfng ?? []).length > 0 && (
                    <Disclosure level={2} title="True / False / Not Given">
                      <p className="type-caption">Which statements you mix up, and the rule for each.</p>
                      <TfngPanel rows={(attempt.analysis?.tfng ?? []) as never} pattern={insights.data?.tfng.pattern as never} />
                    </Disclosure>
                  )}
                </div>
              )}
            </>
          )}

          {tab === 'answers' && (
            <Section
              title="Your answers"
              caption="Tap a question to see why it is wrong and where the answer is."
              aside={<Segmented label="Filter" size="sm" value={wrongOnly ? 'wrong' : 'all'} onChange={(v) => setWrongOnly(v === 'wrong')} options={[{ value: 'all', label: `All ${flat.length}` }, { value: 'wrong', label: `Wrong only (${wrongCount})` }]} />}
            >
              {rows.length === 0 ? (
                <p className="type-lede border-t border-line pt-4">Nothing wrong. Every answer was correct.</p>
              ) : (
                <table className="w-full max-w-[720px] text-left">
                  <thead className="type-caption max-sm:sr-only">
                    <tr className="border-b border-line">
                      <th scope="col" className="w-16 py-2 pr-2 font-normal">No.</th>
                      <th scope="col" className="py-2 pr-3 font-normal">Your answer</th>
                      <th scope="col" className="py-2 pr-3 font-normal">Correct answer</th>
                      {listening && <th scope="col" className="w-24 py-2 pr-1 font-normal">Listen from</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f, i) => {
                      const m = marks.get(f.n);
                      const open = selected === f.n;
                      const fs = test.sections.find((x) => x.part === f.part)!;
                      const mo = moments.get(f.n);
                      return (
                        <Fragment key={f.n}>
                          {listening && rows[i - 1]?.part !== f.part && (
                            <tr>
                              <th scope="rowgroup" colSpan={4} className="type-subheading pb-1 pt-6 text-left first:pt-3">Part {f.part}</th>
                            </tr>
                          )}
                          {/* ponytail: whole row toggles via click bubbling; the No. button is the keyboard/AT control. On phones each row is a 2-line grid, not a table row. */}
                          <tr id={`qrow-${f.n}`} onClick={() => setSelected(open ? null : f.n)} className={cn('cursor-pointer border-t border-line hover:bg-hover max-sm:grid max-sm:grid-cols-[4rem_minmax(0,1fr)_auto] max-sm:items-center', open && 'bg-accent-soft/40')}>
                            <td className="py-0 max-sm:row-span-2">
                              <button type="button" aria-expanded={open} aria-controls={`qdetail-${f.n}`} aria-label={`Question ${f.n}, ${m?.correct ? 'correct' : 'wrong'}: explain`} className="type-subheading type-num flex h-11 w-full items-center gap-1.5 text-accent-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
                                {m?.correct ? <Check className="size-4 shrink-0 text-good-text" aria-hidden /> : <X className="size-4 shrink-0 text-bad-text" aria-hidden />}
                                {f.n}
                              </button>
                            </td>
                            <td className={cn('type-body py-2 pr-3 max-sm:col-start-2 max-sm:pb-0', !m?.given && 'text-muted', m && !m.correct && 'text-bad-text')}>
                              <span className="type-caption mr-2 sm:hidden">You wrote</span>
                              {m?.given || 'No answer'}
                            </td>
                            <td className="type-body py-2 pr-3 max-sm:col-start-2 max-sm:pt-0">
                              <span className="type-caption mr-2 sm:hidden">Answer</span>
                              {m?.answer.join(' / ')}
                            </td>
                            {listening && (
                              <td className="py-0 pr-1 max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1">
                                {mo && (
                                  <button type="button" onClick={(e) => { e.stopPropagation(); pickQ(f.n); }} aria-label={`Question ${f.n}: play from Part ${f.part} at ${formatClock(mo.at)}${mo.exact ? '' : ', approximate'}`} className="type-body type-num inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-accent-text hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
                                    <Play className="size-3 fill-current" aria-hidden />
                                    {mo.exact ? '' : '~'}{formatClock(mo.at)}
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                          {open && (
                            <tr id={`qdetail-${f.n}`} className="max-sm:block">
                              <td colSpan={listening ? 4 : 3} className="pb-6 pt-2 max-sm:block sm:pl-16">
                                <QuestionDetail q={f.q} group={f.group} section={fs} mark={m} entry={entries.get(f.n)} verdict={false} onClose={() => setSelected(null)} onShow={() => jump(f.n)} onPlay={() => play(f.n)} onDictate={() => setDict(f.n)} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Section>
          )}

          {tab === 'context' && (
            <Section
              title={listening ? 'Transcript' : 'Passage'}
              caption={listening ? 'Replay any part, read the transcript, and see every question with its marking. Coloured numbers on the audio bar show where each answer is spoken.' : 'Read the passage next to your marked answers. Tap a question number in Answers to highlight where its answer is.'}
            >
              {listening && (
                <div className="sticky top-0 z-10 -mx-4 border-b border-line bg-bg px-4 py-3 sm:mx-0 sm:px-0">
                  <PracticeAudio key={section.audio} src={assets[section.audio ?? ''] ?? ''} label={`Part ${section.part}`} cue={cue?.part === section.part ? cue : null} pins={pins} pinned={selected} onPin={pickQ} />
                </div>
              )}
              <Tabs id="res-part" value={String(section.part)} onChange={(v) => setPartIdx(test.sections.findIndex((s) => s.part === +v))} items={test.sections.map((s) => ({ value: String(s.part), label: `${noun} ${s.part}` }))} />
              <div role="tabpanel" id="res-part-panel" aria-labelledby={`res-part-${section.part}`} className="space-y-6">
                {sel && selSection && (
                  <div className="border-y border-line py-4">
                    <QuestionDetail q={sel.q} group={sel.group} section={selSection} mark={marks.get(sel.n)} entry={entries.get(sel.n)} onClose={() => setSelected(null)} onShow={sel.part !== section.part ? () => jump(sel.n) : undefined} onPlay={() => play(sel.n)} onDictate={() => setDict(sel.n)} />
                  </div>
                )}
                <VocabList section={section} />
                <div className={cn('grid gap-x-10 gap-y-8 lg:items-start', listening ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : 'xl:grid-cols-2')}>
                  {!listening && (
                    <div data-scrollpane className="min-w-0 xl:sticky xl:top-4 xl:max-h-[75vh] xl:overflow-y-auto xl:pr-2">
                      <Passage section={section} evidence={mark} />
                    </div>
                  )}
                  {listening && section.transcript && (
                    <div data-scrollpane className="type-reading min-w-0 lg:sticky lg:top-24 lg:max-h-[75vh] lg:overflow-y-auto lg:pr-2">
                      <Transcript text={section.transcript} evidence={mark} pins={tpins} picked={selected} onPin={(n) => setSelected(n)} />
                    </div>
                  )}
                  <div data-scrollpane={listening ? undefined : ''} className={cn('min-w-0', !listening && 'xl:max-h-[75vh] xl:overflow-y-auto xl:pr-1')}>
                    <GroupsPane section={section} responses={attempt.responses} onChange={() => {}} assets={assets} active={active} review={marks} />
                  </div>
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
      {dict != null && sel && sel.n === dict && selSection && <Dictation open onClose={() => setDict(null)} src={assets[selSection.audio ?? ''] ?? ''} section={selSection} q={sel.q} />}
    </ResultScaffold>
  );
}
