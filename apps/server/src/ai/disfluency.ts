// Text-only disfluency tagger (spec §5.1): a cheap LLM pass over the transcript that returns the reparandum / interregnum / repair of each
// disfluency. Its spans are merged with the rule tags (core tagDisfluencies) and the audio-side detectors in fuseDisfluencies.
import { z } from 'zod';
import type { Disfluency, DisfluencyKind, Word } from '@ielts/core';
import { chatJson } from './openrouter';

const Types = ['filled', 'repetition', 'repair', 'false_start', 'partial', 'prolongation'] as const satisfies readonly DisfluencyKind[];
export const DisfluencyTagsSchema = z.object({
  tags: z
    .array(
      z.object({
        type: z.enum(Types),
        start: z.number().int().min(0).describe('index of the first word of the reparandum (the part that is abandoned or repeated)'),
        reparandum: z.string().describe('the abandoned or repeated words, verbatim ("" for a filled pause)'),
        interregnum: z.string().describe('what sits between reparandum and repair: filler, pause marker, editing term ("" if none)'),
        repair: z.string().describe('the words that replace the reparandum, verbatim ("" if the speaker gave up)'),
      }),
    )
    .max(60),
});
export type DisfluencyTag = z.infer<typeof DisfluencyTagsSchema>['tags'][number];

const SYSTEM = `You tag speech disfluencies in an ASR transcript of a candidate's spoken answer. Words are given as "[index]word"; "(pause)" marks a silence of half a second or more between words, and "…", "—" and "-" inside tokens mark cut-offs and broken words as the recogniser heard them.

For each disfluency return its type, the index of its first word, and the three parts of the standard repair model:
- reparandum: the words that are abandoned or repeated; interregnum: what sits between (um, uh, "I mean", a pause marker); repair: the words that replace the reparandum.
Types:
- filled: um, uh, er, erm, hmm used as a pause, and "like", "you know", "I mean" only when they fill a pause rather than carry meaning.
- repetition: a word or phrase said again with the same words ("I I went", "the the market"; tag the first copy), not for emphasis ("very very good") or in parallel structure ("the more, the more"). Identical words are always a repetition, never a repair.
- repair: the speaker restarts and CHANGES the words ("he go ... he went").
- false_start: a clause begun and left unfinished: the speaker stops, often after a (pause), and starts a new clause with a different structure, so the first never gets its verb or object ("The reason why I — what I mean is it's cheap"; "Most families (pause) in our town the old people live with them"); the reparandum is the abandoned start.
- partial: a cut-off word fragment ("th-", "wha-").
- prolongation: a held sound written out ("sooo", "weeell").
Tag only what the words show. Do not tag grammar errors, fluent lists, discourse markers used as words, or punctuation. A fluent transcript returns an empty list. Return JSON only.`;

/** Words of the transcript as the tagger sees them. */
const indexed = (words: Word[], transitions: [number, number][] = []) =>
  words.map((w, i) => `${i && w.start - words[i - 1]!.end >= 0.5 && !transitions.some(([a, b]) => a <= w.start && b >= words[i - 1]!.end) ? '(pause) ' : ''}[${i}]${w.w}`).join(' ');
const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '');

/** LLM spans drift by a word or two: anchors a tag on the nearest occurrence of its reparandum's first word (else of the repair's, else the stated index). */
export function tagEvents(words: Word[], tags: DisfluencyTag[]): Disfluency[] {
  return tags.flatMap((t0): Disfluency[] => {
    let t = t0;
    const first = bare((t.reparandum || t.repair).split(/\s+/)[0] ?? '');
    let at = Math.min(t.start, words.length - 1);
    if (first && bare(words[at]?.w ?? '') !== first) {
      const near = [1, -1, 2, -2, 3, -3].map((d) => at + d).find((j) => j >= 0 && j < words.length && bare(words[j]!.w) === first);
      if (near == null) return [];
      at = near;
    }
    if (at < 0 || !words[at]) return [];
    const count = (x: string) => x.split(/\s+/).filter(Boolean).length;
    // A "repetition" must repeat the same words straight away; a restart that changes what follows ("people can ... people will") is a repair.
    const n = Math.max(1, count(t.reparandum));
    const again = words.slice(at, at + n).every((w, k) => bare(w.w) === bare(words[at + n + k]?.w ?? ''));
    if (t.type === 'repetition' && !again) t = { ...t, type: 'repair' };
    // A repair / false start runs on through the interregnum to the first word of the restart, where the transcript-side detectors place theirs, so fusion merges them.
    const restart = t.type === 'repair' || t.type === 'false_start' ? count(t.interregnum) + (t.repair ? 1 : 0) : 0;
    const last = Math.min(words.length - 1, at + Math.max(1, count(t.reparandum)) - 1 + restart);
    return [{ kind: t.type, start: words[at]!.start, end: words[last]!.end, sources: ['llm'] }];
  });
}

/** Runs the tagger; a failure returns no tags (the rule and audio detectors still count). */
export async function llmDisfluencies(words: Word[], model: string, transitions?: [number, number][]): Promise<Disfluency[]> {
  if (words.length < 3) return [];
  try {
    const r = await chatJson({ model, system: SYSTEM, user: indexed(words, transitions), schema: DisfluencyTagsSchema, schemaName: 'disfluency_tags', temperature: 0, effort: 'low', timeoutMs: 60_000 });
    return tagEvents(words, r.tags);
  } catch (e) {
    console.error('disfluency tagger failed, continuing without it', (e as Error).message);
    return [];
  }
}
