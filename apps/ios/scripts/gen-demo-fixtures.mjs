#!/usr/bin/env node
// Synthetic API responses for the iOS demo mode (`-demo` launch argument), used by the screenshot workflow.
// Invented data only — no real accounts. Keys are "path" or "path?k=v&…" (query keys sorted), as DemoURLProtocol looks them up.
// Run: node apps/ios/scripts/gen-demo-fixtures.mjs  → apps/ios/IELTS/Demo/fixtures.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../IELTS/Demo/fixtures.json');
const day = (n) => new Date(Date.UTC(2026, 8, 30 - n, 9, 30)).toISOString();

const settings = {
  models: { analysis: 'openai/gpt-6-luna', examiner: 'openai/gpt-6-luna', stt: 'elevenlabs/scribe_v2', tts: 'google/gemini-3.8-flash-tts', ttsVoice: 'Charon', audioPron: 'google/gemini-2.5-flash' },
  audioPronEnabled: true, liveProvider: 'turn', targetBand: 7, writingAutoSubmit: true, blockPaste: true,
};
const me = { user: { id: 'demo', email: 'maya@example.com', name: 'Maya Rahman', emailVerified: true }, settings, cambridgeAccess: false, realtimeAvailable: true, geminiLiveAvailable: true };

const p = (o) => ({ variant: null, type: null, topic: null, bullets: null, followUps: null, chart: null, imageUrl: null, groupId: null, done: false, source: 'generated', ...o });
const sp1 = p({ id: 'sp1', skill: 'speaking', part: 1, topic: 'Hometown', title: 'Your hometown', body: 'Let\'s talk about where you grew up.', followUps: ['Where is your hometown?', 'What do you like most about it?', 'Has it changed much since you were a child?', 'Would you like to live there in the future?'] });
const sp2 = p({ id: 'sp2', skill: 'speaking', part: 2, topic: 'Books', title: 'Describe a book that changed the way you think', body: 'You should say:', bullets: ['what the book was', 'when you read it', 'what it was about', 'and explain how it changed the way you think.'] });
const sp3 = p({ id: 'sp3', skill: 'speaking', part: 3, topic: 'Reading', title: 'Reading habits', body: 'Let\'s discuss reading in society.', followUps: ['Why do fewer young people read books for pleasure?', 'Should schools make reading compulsory?', 'Will printed books disappear?'] });
const w2 = p({ id: 'w2', skill: 'writing', part: 2, type: 'opinion', topic: 'Technology', title: 'Remote work', body: 'Some people believe that working from home benefits both employees and employers. Others think it harms productivity and teamwork. Discuss both views and give your own opinion.' });
const w1a = p({ id: 'w1a', skill: 'writing', part: 1, variant: 'academic', type: 'line', topic: 'Energy', title: 'Renewable energy share',
  body: 'The graph below shows the percentage of electricity generated from renewable sources in three countries between 2000 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  chart: { kind: 'line', title: 'Electricity from renewables (%)', xLabel: 'Year', yLabel: '%', unit: '%', categories: ['2000', '2005', '2010', '2015', '2020'],
    series: [{ name: 'Denmark', values: [15, 22, 33, 52, 68] }, { name: 'Spain', values: [17, 19, 30, 35, 44] }, { name: 'Japan', values: [9, 10, 11, 16, 21] }] } });
const w1g = p({ id: 'w1g', skill: 'writing', part: 1, variant: 'general', type: 'letter-complaint', topic: 'Housing', title: 'Noisy neighbours',
  body: 'You live in a rented flat and your neighbours are very noisy at night. Write a letter to your landlord. In your letter:', bullets: ['describe the problem', 'explain how it affects you', 'say what you would like the landlord to do'] });

// Writing task 1 figures of every kind (the Android chart renderer is screenshot-tested against these) and every writing prompt by id (`/api/prompts/{id}`).
const fig = (o) => p({ skill: 'writing', part: 1, variant: 'academic', topic: 'Society', ...o });
const w1b = fig({ id: 'w1b', type: 'bar', title: 'University enrolment',
  body: 'The chart below shows the number of students enrolled in three subjects at one university in 2010, 2015 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  chart: { kind: 'bar', title: 'Students enrolled by subject (thousands)', xLabel: 'Year', yLabel: 'Students', unit: 'thousands', categories: ['2010', '2015', '2020'],
    series: [{ name: 'Engineering', values: [12, 15, 21] }, { name: 'Medicine', values: [9, 10, 11] }, { name: 'Law', values: [7, 6, 5] }] } });
const w1p = fig({ id: 'w1p', type: 'pie', topic: 'Energy', title: 'Household energy sources',
  body: 'The pie charts below show the main sources of household energy in one country in 1990 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  chart: { kind: 'pie', title: 'Household energy by source (%)', unit: '%', pies: [
    { name: '1990', slices: [{ label: 'Coal', value: 42 }, { label: 'Gas', value: 28 }, { label: 'Oil', value: 20 }, { label: 'Renewables', value: 6 }, { label: 'Other', value: 4 }] },
    { name: '2020', slices: [{ label: 'Coal', value: 15 }, { label: 'Gas', value: 35 }, { label: 'Oil', value: 12 }, { label: 'Renewables', value: 31 }, { label: 'Other', value: 7 }] }] } });
const w1t = fig({ id: 'w1t', type: 'table', topic: 'Travel', title: 'International visitors',
  body: 'The table below shows the number of international visitors to three countries in 2005 and 2020, and the average length of stay. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  chart: { kind: 'table', title: 'International visitors (millions) and average stay (nights)', columns: ['Country', '2005', '2020', 'Average stay'],
    rows: [['Portugal', 11.2, 24.6, '6.1'], ['New Zealand', 2.4, 3.9, '16.4'], ['Singapore', 7.1, 19.1, '3.4']] } });
const w1pr = fig({ id: 'w1pr', type: 'process', topic: 'Environment', title: 'Rainwater harvesting',
  body: 'The diagram below shows how rainwater is collected and made safe to drink in a small community. Summarise the information by selecting and reporting the main features.',
  chart: { kind: 'process', title: 'How rainwater is collected and treated', steps: ['Rain falls on the roof and runs into the gutters', 'Water passes through a coarse filter that traps leaves', 'It collects in a large underground tank', 'A pump moves it through sand and charcoal filters', 'The water is treated with chlorine', 'Clean water is stored in a tower for the village'] } });
const w1m = fig({ id: 'w1m', type: 'map', topic: 'Housing', title: 'Village development',
  body: 'The maps below show a village in 2000 and today. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  chart: { kind: 'map', title: 'Millbrook village', before: { label: '2000', features: ['A farm in the north-east', 'A single road through the centre', 'A small primary school by the river', 'Woodland to the west'] },
    after: { label: 'Today', features: ['The farm is now a housing estate', 'A bypass road runs along the south', 'The school is larger, with a sports field', 'A supermarket and car park replace the woodland'] } } });

// --- speaking attempt (Part 2) ---
const transcript = 'I would like to talk about um a book called Sapiens which I read uh two years ago when I was at university . It is about the history of humans and how we I mean how our species became so powerful . Before reading it I I thought history was just dates and wars but the book showed me that ideas like money and nations are stories we all agree to believe . That really changed the way I think because now I um question things that people say are natural . For example when someone says this is how it has always been I ask myself is it really or is it just a story . So I think it made me more curious and more open minded .';
let t = 0.4;
const words = [];
for (const tok of transcript.split(' ')) {
  if (tok === '.') { t += 0.55; continue; }
  const filler = tok === 'um' || tok === 'uh';
  const d = filler ? 0.35 : 0.16 + Math.min(tok.length, 9) * 0.035;
  words.push({ w: tok, start: +t.toFixed(2), end: +(t + d).toFixed(2), conf: tok === 'Sapiens' ? 0.62 : tok === 'species' ? 0.71 : 0.97 });
  t += d + (filler ? 0.25 : 0.07);
}
const dur = +(t + 0.6).toFixed(1);
const at = (w) => words.find((x) => x.w === w).start;
const widx = (w) => words.findIndex((x) => x.w === w);
const pauses = [[3.1, 3.9, 'between'], [12.6, 13.9, 'within'], [27.2, 28.0, 'between'], [44.5, 45.9, 'within']]
  .map(([s, e, k]) => ({ start: s, end: e, dur: +(e - s).toFixed(2), kind: k, midClause: k === 'within', voiced: false }));
const fillers = words.filter((w) => w.w === 'um' || w.w === 'uh').map((w) => ({ word: w.w, time: w.start, kind: 'filled' }));
const wpmSeries = Array.from({ length: Math.floor(dur / 5) }, (_, i) => ({ t: (i + 1) * 5, wpm: [118, 132, 104, 141, 137, 126, 150, 129, 135, 143, 121, 138, 131, 127][i % 14] }));
const crit = (band, descriptor, summary, evidence) => ({ band, range: [band - 0.5, band + 0.5], descriptor, evidence, summary });
const speakingAnalysis = {
  skill: 'speaking', part: 2, overall: 6.5, overallRaw: 6.5, range: [6, 7], calibrated: true,
  criteria: {
    fc: crit(6.5, 'Willing to speak at length; some hesitation and self-correction.', 'You kept going for the full two minutes and linked ideas with "because" and "for example". A few mid-sentence pauses and restarts break the flow.', ['"how we I mean how our species"', 'pause of 1.3 s before "Before reading it"']),
    lr: crit(7, 'Flexible vocabulary with some less common items.', 'Good topic words ("species", "nations", "open minded"). Some phrases are general ("so powerful", "really changed").', ['"stories we all agree to believe"', '"question things that people say are natural"']),
    gra: crit(6.5, 'Mix of simple and complex structures; errors rarely impede.', 'Relative and reported clauses are used well. Tense control slips once, and a few sentences run on.', ['"which I read two years ago"', '"when someone says this is how it has always been"']),
    p: crit(6, 'Generally clear; some mispronounced words reduce clarity.', '"Sapiens" and "species" were unclear, and sentence stress is flat in the middle section.', ['"Sapiens" at 3.4 s', '"species" at 14.2 s']),
  },
  topFixes: [
    { title: 'Replace filled pauses with a short silent pause', why: 'Four "um/uh" in two minutes is noticeable; a silent pause sounds more confident.', before: 'which I read uh two years ago', after: 'which I read — two years ago' },
    { title: 'Plan the first clause before you speak', why: 'Restarts like "how we I mean how our species" cost fluency marks.', before: 'how we I mean how our species became', after: 'how our species became' },
    { title: 'Stress the key word in each idea', why: 'Flat stress makes long answers harder to follow.', before: 'that really changed the way I think', after: 'that REALLY changed the way I THINK' },
  ],
  errors: [
    { id: 'e1', category: 'grammar.verb-tense', severity: 'minor', start: widx('Before'), end: widx('Before') + 2, original: 'Before reading it I thought history was', correction: 'Before reading it, I had thought history was', explanation: 'Use the past perfect for a belief that came before another past event.', time: at('Before') },
    { id: 'e2', category: 'vocabulary.collocation', severity: 'minor', start: widx('powerful'), end: widx('powerful') + 1, original: 'so powerful', correction: 'so dominant', explanation: '"Dominant" is more precise for a species controlling the planet.', time: at('powerful') },
    { id: 'e3', category: 'grammar.run-on', severity: 'major', start: widx('ask'), end: widx('ask') + 2, original: 'I ask myself is it really or is it just a story', correction: 'I ask myself whether it really is, or whether it is just a story', explanation: 'Use "whether" for an embedded question and keep statement word order.', time: at('ask') },
  ],
  vocabUpgrades: [{ original: 'really changed', better: ['transformed', 'reshaped'], note: 'Stronger verbs show range.' }, { original: 'open minded', better: ['receptive to new ideas'], note: 'A less common phrase for band 7+.' }],
  rewrite: { text: 'I\'d like to talk about Sapiens, a book I read two years ago at university. It traces the history of humankind and explains how our species became so dominant…', note: 'Same ideas, fewer restarts, stronger verbs.' },
  words,
  metrics: {
    durationS: dur, wordCount: words.length, speechRate: Math.round((words.length / dur) * 60), articulationRate: Math.round((words.length / (dur - 4.7)) * 60),
    phonationRatio: 0.71, pauseRatio: 0.12, mlr: 9.4, pauses, longPauses: 2, midClausePauses: 2, fillers, fillersPerMin: +((fillers.length / dur) * 60).toFixed(1),
    repetitions: [{ phrase: 'I', time: at('thought') - 0.5, wordIdx: words.findIndex((w) => w.w === 'thought') - 1 }],
    selfCorrections: [{ time: at('mean'), wordIdx: words.findIndex((w) => w.w === 'mean') }],
    unclear: [{ wordIdx: words.findIndex((w) => w.w === 'Sapiens'), w: 'Sapiens', conf: 0.62, tier: 2 }, { wordIdx: words.findIndex((w) => w.w === 'species'), w: 'species', conf: 0.71, tier: 1 }],
    wpmSeries, wpmStdDev: 12.8,
    fluency: {
      events: [
        ...fillers.map((f) => ({ kind: 'filled', start: f.time, end: f.time + 0.35, sources: ['asr'] })),
        { kind: 'repetition', start: at('thought') - 0.5, end: at('thought'), sources: ['asr', 'llm'] },
        { kind: 'repair', start: at('mean') - 0.4, end: at('mean') + 0.3, sources: ['asr', 'llm'] },
      ],
      profile: { byKind: { filled: { n: fillers.length, perMin: +((fillers.length / dur) * 60).toFixed(1), per100w: +((fillers.length / words.length) * 100).toFixed(1) }, repetition: { n: 1, perMin: 0.5, per100w: 0.8 }, repair: { n: 1, perMin: 0.5, per100w: 0.8 }, false_start: { n: 0, perMin: 0, per100w: 0 } } },
    },
  },
  questions: [{ text: sp2.title, startWord: 0 }, { text: 'Do you think people read enough history?', startWord: Math.floor(words.length * 0.6) }],
  pronunciation: { unclear: [], llm: { words: [{ word: 'Sapiens', time: at('Sapiens'), issue: 'Stress on the wrong syllable.', tip: 'SAY-pee-enz, stress the first syllable.' }, { word: 'species', time: at('species'), issue: 'Final /z/ dropped.', tip: 'End with a buzzing /z/: SPEE-sheez.' }], prosody: 'Clear overall; intonation flattens in the middle third.', band: 6 } },
  relevance: [{ questionIdx: 0, onTopic: true, note: 'Covers all four cue-card points.' }],
  noSpeech: false,
};

// --- writing attempt (Task 2) ---
const essay = `In recent years, more companies have allowed staff to work from home. While some people argue that this benefits everyone, others believe it damages productivity and teamwork. In my opinion, the advantages outweigh the drawbacks if remote work is managed well.

On the one hand, working from home saves employees a great deal of time. Without a daily commute, workers can start earlier and have more energy for their tasks. Employers also benefit because they can reduce the cost of office space and hire talented people who lives far from the city.

On the other hand, critics point out that teamwork can suffer. When colleagues never meet, it is harder to share ideas informally, and new staff may feel isolated. Furthermore, some employees find it difficult to concentrate at home because of noise or family responsibilities.

However, I believe these problems can be solved. Companies can organise regular meetings in the office and use online tools to keep teams connected. Managers should also judge staff by results rather than by the hours they are seen at a desk.

In conclusion, although remote work has some disadvantages for collaboration, its benefits for both workers and businesses are significant, and with good management it is the better option.`;
const idx = (s) => { const i = essay.indexOf(s); return [i, i + s.length]; };
const werr = (id, category, severity, s, correction, explanation) => { const [start, end] = idx(s); return { id, category, severity, start, end, original: s, correction, explanation, time: null }; };
const writingAnalysis = {
  skill: 'writing', part: 2, overall: 7, overallRaw: 6.875, range: [6.5, 7.5], calibrated: true,
  criteria: {
    ta: crit(7, 'Addresses all parts; clear position throughout.', 'Both views are discussed and your opinion is clear from the introduction to the conclusion. Ideas could be extended with a specific example.', ['"In my opinion, the advantages outweigh the drawbacks"', '"Managers should also judge staff by results"']),
    cc: crit(7, 'Logical progression; range of cohesive devices.', 'Paragraphs each have a clear topic sentence. Linkers are accurate but a little mechanical ("On the one hand… On the other hand").', ['"Furthermore, some employees"', '"However, I believe these problems can be solved."']),
    lr: crit(7, 'Sufficient range with some less common items.', 'Good collocations such as "reduce the cost of office space" and "feel isolated". Some repetition of "work" and "staff".', ['"outweigh the drawbacks"', '"judge staff by results"']),
    gra: crit(6.5, 'Mix of complex structures; a few errors.', 'Complex sentences are frequent and mostly accurate. One agreement error and one missing article.', ['"people who lives far from the city"', '"Without a daily commute, workers can start earlier"']),
  },
  topFixes: [
    { title: 'Check subject–verb agreement after "who"', why: 'The verb agrees with the noun "who" refers to.', before: 'people who lives far from the city', after: 'people who live far from the city' },
    { title: 'Support each main idea with one specific example', why: 'Band 8 Task Response needs fully extended ideas.', before: 'Without a daily commute, workers can start earlier', after: 'Without a daily commute — often an hour each way in large cities — workers can start earlier' },
    { title: 'Vary your linking phrases', why: 'Less predictable linkers lift Coherence and Cohesion.', before: 'On the other hand, critics point out', after: 'Critics, however, point out' },
  ],
  errors: [
    werr('w1', 'grammar.agreement', 'major', 'who lives', 'who live', '"People" is plural, so the verb is "live".'),
    werr('w2', 'vocabulary.word-choice', 'minor', 'a great deal of time', 'a considerable amount of time', 'Fine, but slightly informal for an essay.'),
    werr('w3', 'grammar.article', 'minor', 'with good management', 'with good management in place', 'Adds precision; the bare phrase is acceptable.'),
  ],
  vocabUpgrades: [{ original: 'benefits', better: ['advantages', 'gains'], note: 'Avoid repeating "benefit" four times.' }, { original: 'damages', better: ['undermines', 'erodes'], note: 'More precise verbs for an abstract effect.' }],
  rewrite: { text: 'In recent years, a growing number of firms have let staff work remotely…', note: 'Stronger opening with less common vocabulary.' },
  text: essay,
  structure: {
    paragraphs: [
      { role: 'introduction', topicSentence: 'In recent years, more companies have allowed staff to work from home.', ok: true, note: 'Paraphrases the question and states a position.' },
      { role: 'body', topicSentence: 'On the one hand, working from home saves employees a great deal of time.', ok: true, note: 'Two benefits, each explained.' },
      { role: 'body', topicSentence: 'On the other hand, critics point out that teamwork can suffer.', ok: true, note: 'Presents the opposing view fairly.' },
      { role: 'body', topicSentence: 'However, I believe these problems can be solved.', ok: true, note: 'Rebuttal; could use an example.' },
      { role: 'conclusion', topicSentence: 'In conclusion, although remote work has some disadvantages…', ok: true, note: 'Restates the opinion clearly.' },
    ],
    overview: null, position: { clear: true, consistent: true, note: 'Clear from the first paragraph.' }, planFollowed: { followed: true, note: 'Matches your plan.' },
  },
  textMetrics: { words: essay.split(/\s+/).length, sentences: 15, paragraphs: 5, avgSentenceLen: 17.6, mtld: 78.4, ttr: 0.58,
    linkers: [{ word: 'however', count: 1, overused: false }, { word: 'furthermore', count: 1, overused: false }, { word: 'on the other hand', count: 1, overused: false }, { word: 'also', count: 2, overused: false }],
    repeated: [{ word: 'work', count: 6 }, { word: 'staff', count: 3 }] },
  tooShort: false,
  comparison: { parentAttemptId: 'aw0', parentOverall: 6.5, deltas: { ta: 0.5, cc: 0, lr: 0.5, gra: 0 } },
};

const attempt = (id, prompt, analysis, extra = {}) => ({ id, promptId: prompt.id, skill: prompt.skill, part: prompt.part, mode: 'practice', sessionId: null, parentAttemptId: null, audioUrl: null, text: null, plan: null, durationMs: null, overtime: false, status: 'done', error: null, createdAt: day(0), analysis, prompt, ...extra });
const aSpeak = attempt('as1', sp2, speakingAnalysis, { durationMs: Math.round(dur * 1000), sessionId: 's1' });
const aWrite = attempt('aw1', w2, writingAnalysis, { text: essay, parentAttemptId: 'aw0', durationMs: 37 * 60000 });

const list = [
  ['as1', sp2.title, 'speaking', 2, 6.5, 0], ['aw1', w2.title, 'writing', 2, 7, 0], ['as2', 'Your hometown', 'speaking', 1, 6.5, 1],
  ['aw2', w1a.title, 'writing', 1, 6, 2], ['as3', sp3.title, 'speaking', 3, 6, 3], ['aw0', w2.title, 'writing', 2, 6.5, 4],
  ['as4', 'Describe a place you like to relax', 'speaking', 2, 6, 6], ['aw3', 'Noisy neighbours', 'writing', 1, 6.5, 8],
].map(([id, promptTitle, skill, part, overall, d]) => ({ id, promptTitle, skill, part, mode: 'practice', status: 'done', overall, createdAt: day(d) }));

const trendS = [5.5, 6, 6, 6.5, 6.5, 6.5].map((o, i) => ({ date: day(14 - i * 2), overall: o, criteria: { fc: o, lr: o + 0.5, gra: o - 0.5 + (i % 2) * 0.5, p: o - 0.5 } }));
const trendW = [6, 6, 6.5, 6.5, 7].map((o, i) => ({ date: day(14 - i * 3), overall: o, criteria: { ta: o, cc: o, lr: o + (i % 2) * 0.5, gra: o - 0.5 } }));
const progress = (trend) => ({ trend, streak: 5, minutesThisWeek: 96, attempts: 14, weakest: { key: 'p', avg: 5.9 }, topMistakes: [{ category: 'grammar.article', count: 9 }, { category: 'grammar.verb-tense', count: 6 }, { category: 'vocabulary.collocation', count: 4 }], predicted: { speaking: 6.5, writing: 7 } });

const mistakes = [
  ['grammar.article', 'I went to university in capital', 'I went to university in the capital', 'Use "the" before a unique place already known to the listener.', 'speaking', 1],
  ['grammar.verb-tense', 'I live there since 2015', 'I have lived there since 2015', 'Use the present perfect with "since" for an unfinished period.', 'speaking', 1],
  ['grammar.agreement', 'people who lives far away', 'people who live far away', '"People" is plural.', 'writing', 2],
  ['vocabulary.collocation', 'make a research', 'do research', '"Research" collocates with "do" and is uncountable.', 'writing', 2],
  ['grammar.article', 'It is important part of life', 'It is an important part of life', 'Singular countable nouns need an article.', 'writing', 2],
].map(([category, original, correction, explanation, skill, part], i) => ({ id: `m${i}`, attemptId: 'as1', skill, part, promptTitle: skill === 'speaking' ? sp2.title : w2.title, category, original, correction, explanation, time: skill === 'speaking' ? 12.4 + i : null, inDeck: i === 1, createdAt: day(i) }));

const cards = [
  { id: 'c1', front: 'I live there since 2015', back: 'I have lived there since 2015 — present perfect with "since".' },
  { id: 'c2', front: 'make a research', back: 'do research — "research" is uncountable and takes "do".' },
  { id: 'c3', front: 'really changed', back: 'transformed / reshaped — stronger verbs for band 7+.' },
];

const models = (ids) => ({ models: ids.map(([id, name, pr, co]) => ({ id, name, pricing: { prompt: String(pr), completion: String(co) } })) });
const textModels = models([['openai/gpt-6-luna', 'OpenAI: GPT-6 Luna', 1e-7, 5e-7], ['deepseek/deepseek-v4.1-flash', 'DeepSeek: V4.1 Flash', 1.5e-7, 6e-7], ['google/gemini-3.8-flash', 'Google: Gemini 3.8 Flash', 2.5e-7, 1e-6]]);

const fx = {
  '/api/me': me,
  '/api/progress': progress(trendS),
  '/api/progress?skill=speaking': progress(trendS),
  '/api/progress?skill=writing': progress(trendW),
  '/api/attempts': { items: list, total: list.length },
  '/api/attempts?page=1': { items: list, total: list.length },
  '/api/attempts?page=1&skill=speaking': { items: list.filter((a) => a.skill === 'speaking'), total: 4 },
  '/api/attempts?page=1&skill=writing': { items: list.filter((a) => a.skill === 'writing'), total: 4 },
  '/api/attempts/as1': aSpeak,
  '/api/attempts/aw1': aWrite,
  '/api/attempts/aw0': attempt('aw0', w2, { ...writingAnalysis, overall: 6.5, comparison: null }, { text: essay }),
  '/api/cards/due': { items: cards },
  '/api/mistakes': { groups: [{ category: 'grammar.article', count: 9 }, { category: 'grammar.verb-tense', count: 6 }, { category: 'vocabulary.collocation', count: 4 }, { category: 'grammar.agreement', count: 3 }], items: mistakes, total: mistakes.length },
  '/api/models': textModels,
  '/api/prompts': { items: [sp1, sp2, sp3, w2, w1a, w1g, p({ id: 'sp4', skill: 'speaking', part: 1, topic: 'Music', title: 'Music', body: 'Do you like music?', followUps: ['What kind of music do you like?'], done: true })], total: 7, page: 1, pageSize: 30 },
  '/api/prompts/random?part=1&skill=speaking': sp1,
  '/api/prompts/random?part=2&skill=speaking': sp2,
  '/api/prompts/random?part=3&skill=speaking': sp3,
  '/api/prompts/random?part=2&skill=writing': w2,
  '/api/prompts/random?part=1&skill=writing&variant=academic': w1a,
  '/api/prompts/random?part=1&skill=writing&variant=general': w1g,
  '/api/speaking/test': { part1: [sp1], part2: sp2, part3: sp3 },
  '/api/attempts/as2': attempt('as2', sp1, { ...speakingAnalysis, part: 1, overall: 6.5, questions: [{ text: sp1.followUps[0], startWord: 0 }] }, { sessionId: 's1', durationMs: 48000 }),
  '/api/attempts/as3': attempt('as3', sp3, null, { status: 'analyzing', stage: 'analyzing' }),
  '/api/attempts/as4': attempt('as4', sp2, null, { status: 'failed', error: 'The AI service timed out.', retryable: true }),
  '/api/attempts/as5': attempt('as5', sp1, { ...speakingAnalysis, part: 1, overall: 0, overallRaw: 0, noSpeech: true, errors: [], topFixes: [] }),
  '/api/prompts?page=1&skill=speaking': { items: [sp1, sp2, sp3], total: 3, page: 1, pageSize: 30 },
  '/api/prompts?page=1&skill=writing': { items: [w2, w1a, w1g], total: 3, page: 1, pageSize: 30 },
  '/api/prompts/meta': { groups: [{ skill: 'speaking', part: 1, topics: ['Hometown', 'Music'], types: ['p1-topic'] }, { skill: 'speaking', part: 2, topics: ['Books'], types: ['cue-card'] }, { skill: 'speaking', part: 3, topics: ['Reading'], types: ['discussion'] }, { skill: 'writing', part: 1, topics: ['Energy', 'Housing'], types: ['line', 'letter-complaint'] }, { skill: 'writing', part: 2, topics: ['Technology'], types: ['opinion'] }] },
  '/api/models?capability=tts': { models: [{ id: 'google/gemini-3.8-flash-tts', name: 'Google: Gemini 3.8 Flash TTS', voices: ['Charon', 'Puck', 'Kore'], pricing: { prompt: '0', completion: '0' } }] },
  '/api/live/start': { sessionId: 'live-demo', examinerText: 'Good morning. My name is Daniel and I will be your examiner today. Can you tell me your full name, please?', audioUrl: null, voiceError: null, phase: 'p1', prepSeconds: null, cueCard: null, test: { part1: [sp1], part2: sp2, part3: sp3 } },
};
for (const x of [w2, w1a, w1g, w1b, w1p, w1t, w1pr, w1m]) fx[`/api/prompts/${x.id}`] = x; // the editor and the prompt bank open a task by id
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(fx));
console.log(`wrote ${Object.keys(fx).length} fixtures (${(JSON.stringify(fx).length / 1024).toFixed(0)} KB) → ${out}`);
