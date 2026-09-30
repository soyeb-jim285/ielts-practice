// Shared LLM/STT fixtures for AI pipeline tests.
import { DEFAULT_SETTINGS, type Settings } from '../settings';

export const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

export const sttWords = {
  text: 'I goes to the park yesterday',
  duration: 3,
  words: ['I', 'goes', 'to', 'the', 'park', 'yesterday'].map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4, confidence: 0.95 })),
};

const crit = (band: number) => ({ band, range: [band, band + 1], descriptor: 'A range of structures flexibly used.', evidence: ['I goes'], summary: 'More complex sentences.' });
const fix = (n: number) => ({ title: `Fix ${n}`, why: 'Error-free sentences are frequent', before: 'I goes', after: 'I went' });

export const speakingLlm = {
  criteria: { fc: crit(7), lr: crit(6), gra: crit(6), p: crit(6) },
  topFixes: [fix(1), fix(2), fix(3)],
  errors: [{ category: 'grammar.tense', severity: 'major', start: 1, end: 1, original: 'goes', correction: 'went', explanation: 'Past time needs past simple.' }],
  relevance: [{ questionIdx: 0, onTopic: true, note: 'Answers the question.' }],
  vocabUpgrades: [{ original: 'park', better: ['local park'], note: 'More specific.' }],
  rewrite: 'I went to the park yesterday.',
};

export const writingLlm = (quote: string) => ({
  criteria: { ta: crit(6), cc: crit(7), lr: crit(6), gra: crit(6) },
  topFixes: [fix(1), fix(2), fix(3)],
  errors: [
    { category: 'grammar.agreement', severity: 'minor', quote, original: quote, correction: 'people have', explanation: 'Plural subject.' },
    { category: 'lexis.word-choice', severity: 'minor', quote: 'not in the essay', original: 'x', correction: 'y', explanation: 'z' },
  ],
  structure: { paragraphs: [{ role: 'intro', topicSentence: 'Many people', ok: true, note: '' }], overview: null, position: { clear: true, consistent: true, note: '' }, planFollowed: null },
  vocabUpgrades: [],
  rewrite: 'Better essay.',
});

const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }] }), { headers: { 'Content-Type': 'application/json' } });
export const criterionScore = (band: number, o: { injection?: boolean } = {}) =>
  ({ placement: { closest: '', relation: 'similar' as const }, checks: [], evidence: ['people has'], descriptor: `band ${band} phrase`, summary: 'Next band up.', injection: o.injection ?? false, band });
/** Fake /chat/completions for writing: scoring calls ("writing_scores") get the criteria their request lists at band(key, n) for the n-th scoring call; any other call gets `feedback`. */
export function writingChat(band: (key: string, n: number) => number = () => 6, feedback: unknown = writingLlm('people has')) {
  let n = 0;
  return (_: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.response_format?.json_schema?.name !== 'writing_scores') return reply(feedback);
    const user = body.messages[1].content, text: string = typeof user === 'string' ? user : user[0].text;
    const i = n++;
    return reply(Object.fromEntries([...text.matchAll(/<criterion id="(\w+)"/g)].map(([, k]) => [k, criterionScore(band(k!, i))])));
  };
}
