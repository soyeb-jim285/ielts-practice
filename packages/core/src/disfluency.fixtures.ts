import { computeSpeechMetrics, fuseDisfluencies, tagDisfluencies, type Disfluency, type DisfluencyKind, type Word } from './speech';

/** Scripted validation set for the disfluency taggers (spec §5.1). Tokens are words; "|X" after a token marks a gold event at that token:
 *  F filled pause, R repetition (first copy), S self-repair (the restart), T false start (at the first word of the abandoned clause), P partial word, L prolongation.
 *  "_" is a 0.5 s silence. `llm` items need the text LLM tagger (no dash or fragment in the text shows the event). Scripted, not recorded speech:
 *  it checks the detectors' rules and the tagger prompt, and is no substitute for labelled audio. */
export const FIXTURES: { text: string; llm?: boolean }[] = [
  // fillers
  { text: 'I um|F like playing football' },
  { text: 'so uh|F I live in Dhaka' },
  { text: 'it was er|F very crowded' },
  { text: 'I think erm|F the food is good' },
  { text: 'hmm|F let me think about that' },
  { text: 'you|F know it was cold' },
  { text: 'I|F mean it was fine' },
  { text: 'it was _ like|F _ really big' },
  { text: 'we went to the market and uh|F bought some fruit' },
  { text: 'I like playing football with my friends' },
  { text: 'they look like their parents' },
  // repetitions
  { text: 'I|R I went there yesterday' },
  { text: 'we went to the|R the market' },
  { text: 'it was because|R because of the rain' },
  { text: 'I|R think I think it is good' },
  { text: 'she said that|R that was fine' },
  { text: 'my|R my brother plays guitar' },
  // self-repair: restart at a content word after a pause
  { text: 'people can _ people|S will earn more money' },
  { text: 'she has _ she|S had a dog' },
  { text: 'the city is _ the|S city was very quiet' },
  // false starts and cut-off clauses
  { text: 'I|T went to the— I visited the museum' },
  { text: 'We|T could have— we were late' },
  { text: 'the|T reason why I _ what I mean is it is cheap', llm: true },
  { text: 'people|T usually _ in my country families live together', llm: true },
  { text: 'when I was young I wanted to be a doctor' },
  // partial words
  { text: 'I th-|P think so' },
  { text: 'the wa-|P water was cold' },
  { text: 'I b-but|P it was late' },
  { text: 'we s-|P saw it yesterday' },
  { text: 'it was a te-|P terrible day' },
  // prolongation
  { text: 'and sooo|L we left early' },
  { text: 'it was weeell|L good' },
  { text: 'I was thinkiiing|L about it' },
  // fluent negatives and lookalikes
  { text: 'a well-known author wrote the e-mail about twenty-five people' },
  { text: 'the state-of-the-art t-shirt was so-so but I re-read the book' },
  { text: 'I grew up in a small town near the river and moved to the city for university' },
  { text: 'the soaring rents and the constant noise of the centre of things make living there hard' },
];

const STEP = 0.35, DUR = 0.3, PAUSE = 0.5;
type Gold = { kind: DisfluencyKind; i: number };
const CODE: Record<string, DisfluencyKind> = { F: 'filled', R: 'repetition', S: 'repair', T: 'false_start', P: 'partial', L: 'prolongation' };

/** Synthetic word timings (0.35 s per word, silence tokens as gaps) and the gold events of a fixture. */
export function fixtureWords(text: string) {
  const words: Word[] = [], gold: Gold[] = [];
  let t = 0;
  for (const tok of text.split(' ')) {
    if (tok === '_') { t += PAUSE; continue; }
    const [w, code] = tok.split('|');
    if (code) gold.push({ kind: CODE[code]!, i: words.length });
    words.push({ w: w!, start: t, end: t + DUR });
    t += STEP;
  }
  return { words, gold, durationS: t + 0.2 };
}

export type TaggerScore = Record<DisfluencyKind, { gold: number; predicted: number; hits: number; recall: number; precision: number }>;
/** Per-type recall and precision of the fused events over the fixtures; an event matches a gold event of its kind when the gold word lies within its span, ±`tol` words.
 *  `extra` adds a tagger's events (the text LLM); without it only fixtures that do not need the LLM are scored. */
export async function evaluateDisfluency(o: { extra?: (words: Word[]) => Promise<Disfluency[]>; tol?: number } = {}): Promise<TaggerScore> {
  const tol = o.tol ?? 1;
  const kinds = Object.values(CODE);
  const n = Object.fromEntries(kinds.map((k) => [k, { gold: 0, predicted: 0, hits: 0, recall: 0, precision: 0 }])) as TaggerScore;
  for (const f of FIXTURES) {
    if (f.llm && !o.extra) continue;
    const { words, gold, durationS } = fixtureWords(f.text);
    const m = computeSpeechMetrics(words, { durationS });
    const events = fuseDisfluencies(m, undefined, 0.3, [...tagDisfluencies(words), ...((await o.extra?.(words)) ?? [])]);
    // An event covers the words from its start to its end (a repair found by the text tagger runs from the abandoned words to the restart).
    const from = (e: Disfluency) => words.findIndex((w) => w.start >= e.start - 1e-6);
    const to = (e: Disfluency) => words.findLastIndex((w) => w.start <= e.end + 1e-6);
    const used = new Set<number>();
    for (const e of events) {
      n[e.kind].predicted++;
      const j = gold.findIndex((g, k) => !used.has(k) && g.kind === e.kind && g.i >= from(e) - tol && g.i <= Math.max(from(e), to(e)) + tol);
      if (j >= 0) { used.add(j); n[e.kind].hits++; }
    }
    for (const g of gold) n[g.kind].gold++;
  }
  for (const k of kinds) Object.assign(n[k], { recall: n[k].gold ? n[k].hits / n[k].gold : NaN, precision: n[k].predicted ? n[k].hits / n[k].predicted : NaN });
  return n;
}
