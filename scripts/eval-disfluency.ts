// Per-type recall and precision of the disfluency taggers on the scripted fixture set (packages/core/src/disfluency.fixtures.ts, spec §5.1).
// Targets: 0.8 recall and precision for fillers, repetitions and false starts.
//
//   pnpm -F @ielts/server exec tsx --env-file-if-exists=../../.env ../../scripts/eval-disfluency.ts [--llm [--model <openrouter id>]]
//
// Without --llm only the deterministic detectors run (fixtures marked `llm` are skipped); with it the text LLM tagger's spans are merged in
// and every fixture counts. Fixtures are scripted text with synthetic timing, not recorded speech: they test the rules and the tagger prompt only.
import { parseArgs } from 'node:util';
import { evaluateDisfluency } from '../packages/core/src/disfluency.fixtures';
import { llmDisfluencies } from '../apps/server/src/ai/disfluency';
import { DEFAULT_SETTINGS } from '../apps/server/src/settings';

const { values: a } = parseArgs({ options: { llm: { type: 'boolean' }, model: { type: 'string', default: DEFAULT_SETTINGS.models.analysis } } });
const TARGET = 0.8, GATED = ['filled', 'repetition', 'false_start'];
const score = await evaluateDisfluency({ extra: a.llm ? (words) => llmDisfluencies(words, a.model!) : undefined });
const f = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '–');
console.log(`Disfluency taggers on the fixture set: ${a.llm ? `rules + audio-free fusion + LLM tagger (${a.model})` : 'rules + fusion only'}\n`);
console.log('| type | gold | predicted | hits | recall | precision |\n|---|---|---|---|---|---|');
let ok = true;
for (const [k, s] of Object.entries(score)) {
  const miss = GATED.includes(k) && (s.recall < TARGET || s.precision < TARGET);
  ok &&= !miss || (!a.llm && k === 'false_start'); // false starts need the LLM tagger
  console.log(`| ${k} | ${s.gold} | ${s.predicted} | ${s.hits} | ${f(s.recall)} | ${f(s.precision)}${miss ? ' (below 0.80)' : ''} |`);
}
console.log(ok ? '\nTargets met.' : '\nBelow target.');
process.exit(ok ? 0 : 1);
