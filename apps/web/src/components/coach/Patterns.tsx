import type { Swap, SpellGroup } from '@server/coach/types';
import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, Card, Tabs, toast } from '@/components/ui';
import { call, client } from '@/lib/api';
import { plural } from '@/lib/format';
import { useAccount } from '@/lib/query';
import { type Candidate, type CoachFacts, type Feedback, itemKey, patternLabel, SKILL_LABEL, type Skill } from './data';
import { Example, examples } from './FocusList';
import { Wrong } from './Wrong';

const ORDER: Skill[] = ['writing', 'speaking', 'listening', 'reading'];
const UNLOCK: Record<Skill, string> = {
  writing: 'Shows up once something repeats across 2 of your essays.',
  speaking: 'Shows up once something repeats across 2 of your speaking tests.',
  listening: 'Shows up once you lose marks the same way in 2 Listening tests.',
  reading: 'Shows up once you lose marks the same way in 2 Reading tests.',
};
const SPELL: Record<SpellGroup['rule'], string> = { double: 'Double letters', ending: 'Word endings', silent: 'Silent letters', 'ie-ei': 'ie or ei', plural: 'Plural spellings', other: 'Other spellings' };

function Block({ title, caption, children, footer }: { title: string; caption?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="type-subheading">{title}</h3>
        {caption && <p className="type-caption mt-0.5">{caption}</p>}
      </div>
      <ul className="divide-y divide-line">{children}</ul>
      {footer}
    </Card>
  );
}

function Row({ children, count, wrong }: { children: ReactNode; count: ReactNode; wrong: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
      <span className="type-body min-w-0 flex-1">{children}</span>
      <span className="type-caption type-num shrink-0 text-right">{count}</span>
      {wrong}
    </li>
  );
}

const testsOf = (c: Candidate) => {
  const outOf = Number(c.facts.outOf) || c.tests;
  return `${c.tests} of ${plural(outOf, 'test')}`;
};

function PatternRows({ items, fb }: { items: Candidate[]; fb: Feedback }) {
  return items.map((c) => (
    <Row key={c.id} count={testsOf(c)} wrong={<Wrong compact fb={fb} itemKey={itemKey('pattern', c.id)} what={patternLabel(c.kind)} />}>
      {patternLabel(c.kind)}
      {examples(c)[0] && (
        <span className="type-caption block">
          <Example pair={examples(c)[0]!} />
        </span>
      )}
    </Row>
  ));
}

/** Words to swap, from the student's own corrections and per-test upgrades; "Add all to Review" makes one vocab card per swap. */
function Swaps({ swaps, fb, title }: { swaps: Swap[]; fb: Feedback; title: string }) {
  const account = useAccount();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const cards = swaps.filter((s) => s.to.length).map((s) => ({ front: s.from, back: s.to.join(' / '), source: 'vocab' as const }));
  const add = async () => {
    setState('busy');
    try {
      await call(client.POST('/api/cards/bulk', { body: { cards } }));
      setState('done');
      toast(`Added ${plural(cards.length, 'word')} to Review`, { tone: 'good' });
    } catch (e) {
      setState('idle');
      toast(`Couldn't add them: ${(e as Error).message}`, { tone: 'bad' });
    }
  };
  return (
    <Block
      title={title}
      caption="From your own corrections and suggestions."
      footer={
        account && cards.length > 0 && (
          <Button variant="outline" size="sm" className="self-start" icon={<Plus aria-hidden />} loading={state === 'busy'} disabled={state === 'done'} onClick={add}>
            {state === 'done' ? 'Added to Review' : 'Add all to Review'}
          </Button>
        )
      }
    >
      {swaps.map((s) => (
        <Row
          key={s.id}
          count={s.source === 'mistake' ? `corrected ${plural(s.count, 'time')}` : `used ${plural(s.count, 'time')}`}
          wrong={<Wrong compact fb={fb} itemKey={itemKey('pattern', s.id)} what={`swap ${s.from}`} />}
        >
          <s className="text-muted">{s.from}</s>
          {' → '}
          {s.to.length ? s.to.map((t, i) => <span key={t}>{i > 0 && ' / '}<b className="font-semibold">{t}</b></span>) : <span className="text-muted">try a different word</span>}
        </Row>
      ))}
    </Block>
  );
}

function Spelling({ groups, fb }: { groups: SpellGroup[]; fb: Feedback }) {
  return (
    <Block title="Spelling habits" caption="Grouped by the kind of slip, from your essays and answers.">
      {groups.map((g) => (
        <Row key={g.id} count={plural(g.count, 'time')} wrong={<Wrong compact fb={fb} itemKey={itemKey('pattern', g.id)} what={SPELL[g.rule]} />}>
          {SPELL[g.rule]}
          <span className="type-caption block">
            {g.examples.map((e, i) => (
              <span key={e.typed}>
                {i > 0 && ', '}
                <Example pair={[e.typed, e.correct]} />
              </span>
            ))}
          </span>
        </Row>
      ))}
    </Block>
  );
}

/** Listening/Reading: marks lost by cause, as bars against the biggest one. */
const marks = (c: Candidate) => (c.kind.startsWith('question-type:') ? Number(c.facts.total) || c.count : c.count); // question-type: one occurrence per test, facts.total = marks

function MarkBars({ items, fb }: { items: Candidate[]; fb: Feedback }) {
  const max = Math.max(...items.map(marks));
  return (
    <Block title="Where marks go" caption="Marks lost in your recent tests, by cause.">
      {items.map((c) => (
        <Row key={c.id} count={plural(marks(c), 'mark')} wrong={<Wrong compact fb={fb} itemKey={itemKey('pattern', c.id)} what={patternLabel(c.kind)} />}>
          {patternLabel(c.kind)}
          <span aria-hidden className="mt-1.5 block h-1.5 max-w-64 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-warn" style={{ width: `${(marks(c) / max) * 100}%` }} />
          </span>
        </Row>
      ))}
    </Block>
  );
}

/** Your patterns, one tab per skill. A tab with nothing yet says what unlocks it. */
export function Patterns({ facts, fb }: { facts: CoachFacts; fb: Feedback }) {
  const shown = <T extends { id: string }>(a: T[]) => a.filter((x) => !fb.hidden.has(itemKey('pattern', x.id)));
  const swaps = (s: Skill) => shown(facts.swaps.filter((x) => x.skill === s));
  const pats = (s: Skill) => shown((facts.patterns[s] ?? []).filter((c) => c.kind !== 'passage-timing')); // timing has its own card
  const spelling = shown(facts.spelling);
  const p3 = facts.timing.readingPassage3StartMin;

  const panels: Record<Skill, ReactNode[]> = {
    writing: [
      swaps('writing').length > 0 && <Swaps key="sw" title="Words to swap" swaps={swaps('writing')} fb={fb} />,
      spelling.length > 0 && <Spelling key="sp" groups={spelling} fb={fb} />,
      pats('writing').length > 0 && (
        <Block key="p" title="How you write">
          <PatternRows items={pats('writing')} fb={fb} />
        </Block>
      ),
    ],
    speaking: [
      swaps('speaking').length > 0 && <Swaps key="sw" title="Words you lean on" swaps={swaps('speaking')} fb={fb} />,
      pats('speaking').length > 0 && (
        <Block key="p" title="How you speak">
          <PatternRows items={pats('speaking')} fb={fb} />
        </Block>
      ),
    ],
    listening: [pats('listening').length > 0 && <MarkBars key="m" items={pats('listening')} fb={fb} />],
    reading: [
      pats('reading').length > 0 && <MarkBars key="m" items={pats('reading')} fb={fb} />,
      p3 != null && (
        <Card key="t" className="p-4">
          <h3 className="type-subheading">Time</h3>
          <p className="type-body mt-2 flex justify-between gap-3">
            <span>Passage 3 started, on average, at</span>
            <span className="type-num shrink-0">minute {p3} (aim for 40)</span>
          </p>
        </Card>
      ),
    ],
  };
  const has = (s: Skill) => panels[s].some(Boolean);
  const [tab, setTab] = useState<Skill>(() => ORDER.find(has) ?? 'writing');

  return (
    <div>
      <Tabs id="coach-patterns" value={tab} onChange={setTab} items={ORDER.map((s) => ({ value: s, label: SKILL_LABEL[s] }))} />
      <div role="tabpanel" id="coach-patterns-panel" aria-labelledby={`coach-patterns-${tab}`} className="mt-4">
        {has(tab) ? <div className="grid gap-3 md:grid-cols-2">{panels[tab]}</div> : <p className="type-body text-muted">{UNLOCK[tab]}</p>}
      </div>
    </div>
  );
}
