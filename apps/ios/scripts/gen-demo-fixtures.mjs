#!/usr/bin/env node
// Synthetic API responses for the iOS demo mode (`-demo` launch argument), used by the screenshot and video workflows.
// The account is Nusrat Jahan, a fictional student who climbs from band 6.0 to 7.0 over three weeks. Every question, answer, essay and
// test here is original, written for the demo: nothing comes from a Cambridge book.
// Keys are "path" or "path?k=v&…" (query keys sorted), as DemoURLProtocol looks them up; "METHOD path" answers a write.
// Dates are "@@AGO:n@@" (n days ago), filled in by the app at run time so "today", "yesterday" and the trend never go stale.
// Run: bun apps/ios/scripts/gen-demo-fixtures.mjs  → apps/ios/IELTS/Demo/fixtures.json
// (bun: it imports the L/R marking and review analysis from packages/core, so the demo scores are the server's)
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseAttempt, tfngPattern } from '../../../packages/core/src/lr-review.ts';
import { pickParts, scoreLr } from '../../../packages/core/src/lr.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '../IELTS/Demo/fixtures.json');
const day = (n) => `@@AGO:${n}@@`;
const r2 = (x) => Math.round(x * 100) / 100;
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

const settings = {
  models: { analysis: 'openai/gpt-6-luna', examiner: 'openai/gpt-6-luna', stt: 'elevenlabs/scribe_v2', tts: 'google/gemini-3.8-flash-tts', ttsVoice: 'Charon', audioPron: 'google/gemini-2.5-flash' },
  audioPronEnabled: true, liveProvider: 'turn', targetBand: 7, writingAutoSubmit: true, blockPaste: true,
};
const me = { user: { id: 'demo', email: 'nusrat.jahan@example.com', name: 'Nusrat Jahan', emailVerified: true, isAnonymous: false }, settings, cambridgeAccess: true, gptLiveAvailable: true, geminiLiveAvailable: true };

// ---------------------------------------------------------------- prompts

const p = (o) => ({ variant: null, type: null, topic: null, bullets: null, followUps: null, chart: null, imageUrl: null, groupId: null, done: false, source: 'generated', audio: null, ...o });
const AUDIO = 'https://demo.ielts.local/speaking-audio/';
const P2_LEAD = "Now I'm going to give you a topic, and I'd like you to talk about it for one to two minutes. You have one minute to think about what you're going to say. Here is your topic.";
/** A generated speaking prompt with its examiner voice (the demo never downloads it: each line "plays" for a moment). */
const sp = ({ lead, ...o }) => {
  const x = p({ skill: 'speaking', ...o });
  const qs = x.part === 2 ? [x.title] : x.followUps ?? [];
  const line = (text, k) => ({ text, url: `${AUDIO}${x.id}-${k}.mp3` });
  x.audio = {
    intro: x.part === 1 ? line("Good morning. My name is Daniel, and I'll be your examiner today.", 'intro') : null,
    lead: line(lead ?? (x.part === 2 ? P2_LEAD : x.part === 3 ? "Now let's talk about some more general questions." : `Let's talk about ${x.topic.toLowerCase()}.`), 'lead'),
    questions: qs.map((t, i) => line(t, `q${i + 1}`)),
  };
  return x;
};

const sp1 = sp({ id: 'sp1', part: 1, type: 'p1-intro', topic: 'Hometown', title: 'Your hometown', body: "Let's talk about your hometown.", lead: "Now, let's talk about your hometown.", done: true,
  followUps: ['Where is your hometown?', 'What do you like most about living there?', 'Has your hometown changed much in recent years?', 'Would you like to live there in the future?'] });
const sp2 = sp({ id: 'sp2', part: 2, type: 'cue-card', topic: 'Skills', title: 'Describe a skill that took you a long time to learn.', done: true,
  body: 'Describe a skill that took you a long time to learn.\nand explain how you felt when you finally learned it.',
  bullets: ['what the skill is', 'when and where you learned it', 'why it took you a long time'] });
const sp3 = sp({ id: 'sp3', part: 3, type: 'p3-linked', topic: 'Learning', title: 'Learning new skills', body: "Let's discuss learning new skills.", done: true,
  lead: "We've been talking about a skill you learned. Now I'd like to ask you some more general questions related to this.",
  bullets: ['Learning as an adult', 'Skills for the future'],
  followUps: ['Why do some adults find it hard to learn something new?', 'Is it better to learn a skill from a teacher or on your own?', 'Do you think technology makes people less patient learners?',
    'What skills will young people need most in the future?', 'Should employers pay for their staff to learn new skills?', 'Will practical skills like cooking or sewing become less common?'] });

const speakingBank = [
  sp1,
  sp({ id: 'sp5', part: 1, type: 'p1-branch', topic: 'Work', title: 'Work or studies', body: "Let's talk about what you do.", lead: "Let's talk about what you do.", done: true,
    followUps: ['Do you work, or are you a student?', 'What do you enjoy most about your job?', 'Is there anything you would like to change about it?', 'Do you think you will do the same job in five years?'] }),
  sp({ id: 'sp6', part: 1, type: 'p1-topic', topic: 'Daily routine', title: 'Daily routine', body: "Let's talk about your daily routine.", done: true,
    followUps: ['What is the busiest part of your day?', 'Do you prefer mornings or evenings?', 'Has your routine changed since you were a child?', 'What would you change about your daily routine?'] }),
  sp({ id: 'sp4', part: 1, type: 'p1-topic', topic: 'Music', title: 'Music', body: "Let's talk about music.",
    followUps: ['How often do you listen to music?', 'What kind of music did you like as a teenager?', 'Have you ever learned to play an instrument?', 'Do you prefer live music or recordings?'] }),
  sp({ id: 'sp7', part: 1, type: 'p1-topic', topic: 'Cooking', title: 'Cooking', body: "Let's talk about cooking.",
    followUps: ['Do you enjoy cooking?', 'Who taught you to cook?', 'What dish do you make most often?', 'Do people in your country eat out more than they used to?'] }),
  sp({ id: 'sp8', part: 1, type: 'p1-topic', topic: 'Weather', title: 'Weather', body: "Let's talk about the weather.",
    followUps: ['What is the weather usually like where you live?', 'Which season do you like best?', 'Does the weather affect your mood?', 'Has the weather in your area changed in recent years?'] }),
  sp2,
  sp({ id: 'sp9', part: 2, type: 'cue-card', topic: 'Places', title: 'Describe a place you like to relax.', done: true,
    body: 'Describe a place you like to relax.\nand explain why it helps you relax.', bullets: ['where it is', 'how often you go there', 'what you do there'] }),
  sp({ id: 'sp10', part: 2, type: 'cue-card', topic: 'Travel', title: 'Describe a journey you remember well.', done: true,
    body: 'Describe a journey you remember well.\nand explain why you remember it so well.', bullets: ['where you went', 'who you travelled with', 'what happened on the way'] }),
  sp({ id: 'sp11', part: 2, type: 'cue-card', topic: 'People', title: 'Describe a person who taught you something important.',
    body: 'Describe a person who taught you something important.\nand explain why it was important to you.', bullets: ['who the person is', 'how you know them', 'what they taught you'] }),
  sp({ id: 'sp12', part: 2, type: 'cue-card', topic: 'Technology', title: 'Describe an app you find useful.',
    body: 'Describe an app you find useful.\nand explain why you find it useful.', bullets: ['what the app is', 'how you found out about it', 'what you use it for'] }),
  sp3,
  sp({ id: 'sp13', part: 3, type: 'p3-discussion', topic: 'Technology', title: 'Technology and communication', body: "Let's discuss technology and communication.", done: true,
    bullets: ['Staying in touch', 'Technology at work'],
    followUps: ['How has technology changed the way families keep in touch?', 'Do you think people communicate less well face to face than before?', 'Why do some older people avoid new technology?',
      'Should employees be allowed to ignore work messages in the evening?', 'Will most meetings take place online in the future?', 'What are the risks of relying on technology at work?'] }),
  sp({ id: 'sp14', part: 3, type: 'p3-discussion', topic: 'Travel', title: 'Travel and tourism', body: "Let's discuss travel and tourism.",
    bullets: ['Why people travel', 'Tourism and local life'],
    followUps: ['Why do people enjoy travelling to other countries?', 'Is it better to travel alone or with others?', 'How does tourism change the places people visit?',
      'Should popular cities limit the number of tourists?', 'Do you think people will travel more or less in the future?', 'What can tourists do to respect local culture?'] }),
];

const w2 = p({ id: 'w2', skill: 'writing', part: 2, type: 'opinion', topic: 'Transport', title: 'Public transport or new roads', done: true,
  body: 'Some people think that governments should spend money on improving public transport rather than on building new roads.\n\nTo what extent do you agree or disagree?\n\nGive reasons for your answer and include any relevant examples from your own knowledge or experience.' });
const w1a = p({ id: 'w1a', skill: 'writing', part: 1, variant: 'academic', type: 'line', topic: 'Energy', title: 'Renewable energy share', done: true,
  body: 'The graph below shows the percentage of electricity generated from renewable sources in three countries between 2000 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  chart: { kind: 'line', title: 'Electricity from renewables (%)', xLabel: 'Year', yLabel: '%', unit: '%', categories: ['2000', '2005', '2010', '2015', '2020'],
    series: [{ name: 'Denmark', values: [15, 22, 33, 52, 68] }, { name: 'Spain', values: [17, 19, 30, 35, 44] }, { name: 'Japan', values: [9, 10, 11, 16, 21] }] } });
const w1g = p({ id: 'w1g', skill: 'writing', part: 1, variant: 'general', type: 'letter-semi', topic: 'Housing', title: 'Noisy neighbours',
  body: 'You live in a rented flat and your neighbours are very noisy at night. Write a letter to your landlord. In your letter:', bullets: ['describe the problem', 'explain how it affects you', 'say what you would like the landlord to do'] });

// Writing task 1 figures of every kind (the Android chart renderer is screenshot-tested against these) and every writing prompt by id (`/api/prompts/{id}`).
const fig = (o) => p({ skill: 'writing', part: 1, variant: 'academic', topic: 'Society', ...o });
const w1b = fig({ id: 'w1b', type: 'bar', title: 'University enrolment', done: true,
  body: 'The chart below shows the number of students enrolled in three subjects at one university in 2010, 2015 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  chart: { kind: 'bar', title: 'Students enrolled by subject (thousands)', xLabel: 'Year', yLabel: 'Students', unit: 'thousands', categories: ['2010', '2015', '2020'],
    series: [{ name: 'Engineering', values: [12, 15, 21] }, { name: 'Medicine', values: [9, 10, 11] }, { name: 'Law', values: [7, 6, 5] }] } });
const w1p = fig({ id: 'w1p', type: 'pie', topic: 'Energy', title: 'Household energy sources', done: true,
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
const t2 = (id, type, topic, title, body, done = false) => p({ id, skill: 'writing', part: 2, type, topic, title, body, done });
const writingBank = [
  w1a, w1b, w1p, w1t, w1pr, w1m, w1g,
  w2,
  t2('w3', 'discussion', 'Technology', 'Children and screen time', 'Some people believe that children should have strict limits on screen time, while others think screens are an essential part of modern learning.\n\nDiscuss both views and give your own opinion.', true),
  t2('w4', 'adv-disadv', 'Work', 'Working from home', 'More and more employees now work from home for at least part of the week.\n\nDo the advantages of this trend outweigh the disadvantages?'),
  t2('w5', 'two-part', 'Education', 'Studying abroad', 'Many students now choose to study at a university in another country.\n\nWhy is this becoming more common? Is it a positive or negative development?'),
  t2('w6', 'problem-solution', 'Environment', 'Plastic waste', 'Plastic waste is now found in almost every part of the ocean.\n\nWhat are the causes of this problem, and what measures could be taken to solve it?'),
];

// ---------------------------------------------------------------- speech: word timings the way STT and the fluency pipeline report them

/** `answers`: one script per question. "<0.8>" is a silent pause, "<um:1.2>" a filled pause only the audio heard, "^word" starts a self-correction. */
function speak(answers, unclear = {}) {
  let t = 0.6;
  const words = [], pauses = [], voiced = [], repairs = [], starts = [];
  for (const [ai, script] of answers.entries()) {
    let pending = ai > 0 ? { dur: 0.9, skip: true } : null; // the examiner asks the next question here (the recording is paused)
    starts.push(words.length);
    for (const raw of script.split(/\s+/).filter(Boolean)) {
      const m = raw.match(/^<(um:)?([\d.]+)>$/);
      if (m) { pending = { dur: +m[2], voiced: !!m[1] }; continue; }
      const repair = raw.startsWith('^');
      const w = repair ? raw.slice(1) : raw;
      const bare = w.toLowerCase().replace(/[^a-z'-]/g, '');
      const filler = bare === 'um' || bare === 'uh' || bare === 'er';
      if (words.length) {
        const prev = words.at(-1);
        const end = /[.?!]$/.test(prev.w), comma = /,$/.test(prev.w);
        let gap = end ? 0.45 : comma ? 0.2 : prev.filler ? 0.25 : 0.07;
        if (pending) {
          gap = pending.dur;
          if (!pending.skip) {
            pauses.push({ start: prev.end, end: r2(prev.end + gap), dur: gap, kind: end || comma ? 'between' : 'within', midClause: !(end || comma), voiced: !!pending.voiced });
            if (pending.voiced) voiced.push(r2(prev.end + 0.25));
          }
          pending = null;
        } else if (gap >= 0.4) {
          pauses.push({ start: prev.end, end: r2(prev.end + gap), dur: gap, kind: 'between', midClause: false, voiced: false });
        }
        t = prev.end + gap;
      }
      const d = filler ? 0.35 : 0.16 + Math.min(bare.length, 9) * 0.035;
      words.push({ w, start: r2(t), end: r2(t + d), conf: unclear[bare] ?? 0.97, filler, bare });
      if (repair) repairs.push(words.length - 1);
    }
  }
  const reps = [];
  for (let i = 1; i < words.length; i++) if (!words[i].filler && words[i].bare === words[i - 1].bare) reps.push(i - 1);
  const dur = r2(words.at(-1).end + 0.6);
  return { words, pauses, voiced, repairs, reps, starts, dur };
}

const findWords = (ws, phrase) => {
  const want = phrase.toLowerCase().replace(/[^a-z' -]/g, '').split(/\s+/);
  for (let i = 0; i + want.length <= ws.length; i++) if (want.every((x, k) => ws[i + k].bare === x)) return i;
  throw new Error(`phrase not in transcript: ${phrase}`);
};

function speechMetrics(s) {
  const { words, pauses, voiced, repairs, reps, dur } = s;
  const lexical = words.filter((w) => w.filler);
  const fillers = [...lexical.map((w) => ({ word: w.bare, time: w.start, kind: 'lexical' })), ...voiced.map((time) => ({ word: '(voiced)', time, kind: 'voiced' }))].sort((a, b) => a.time - b.time);
  const silent = pauses.reduce((a, x) => a + x.dur, 0);
  const wpmSeries = [];
  for (let t = 10; t <= dur; t += 5) wpmSeries.push({ t, wpm: words.filter((w) => w.start > t - 10 && w.start <= t).length * 6 });
  const mean = wpmSeries.reduce((a, x) => a + x.wpm, 0) / wpmSeries.length;
  const sd = Math.sqrt(wpmSeries.reduce((a, x) => a + (x.wpm - mean) ** 2, 0) / wpmSeries.length);
  const perMin = (n) => +((n / dur) * 60).toFixed(1), per100 = (n) => +((n / words.length) * 100).toFixed(1);
  const rate = (n) => ({ n, perMin: perMin(n), per100w: per100(n) });
  const events = [
    ...lexical.map((w) => ({ kind: 'filled', start: w.start, end: w.end, sources: ['stt'] })),
    ...voiced.map((t) => ({ kind: 'filled', start: t, end: r2(t + 0.5), sources: ['voiced', 'audio'] })),
    ...reps.map((i) => ({ kind: 'repetition', start: words[i].start, end: words[i + 1].end, sources: ['stt', 'rule'] })),
    ...repairs.map((i) => ({ kind: 'repair', start: r2(words[i].start - 0.3), end: words[i].end, sources: ['stt', 'llm'] })),
  ].sort((a, b) => a.start - b.start);
  return {
    durationS: dur, wordCount: words.length, speechRate: Math.round((words.length / dur) * 60), articulationRate: Math.round((words.length / (dur - silent)) * 60),
    phonationRatio: +((dur - silent) / dur).toFixed(2), pauseRatio: +(silent / dur).toFixed(2), mlr: +(words.length / (pauses.length + 1)).toFixed(1),
    pauses, longPauses: pauses.filter((x) => x.dur >= 1).length, midClausePauses: pauses.filter((x) => x.midClause).length,
    fillers, fillersPerMin: perMin(fillers.length),
    repetitions: reps.map((i) => ({ phrase: words[i].bare, time: words[i].start, wordIdx: i })),
    selfCorrections: repairs.map((i) => ({ time: words[i].start, wordIdx: i })),
    unclear: words.map((w, i) => ({ w, i })).filter(({ w }) => w.conf < 0.8).map(({ w, i }) => ({ wordIdx: i, w: w.bare, conf: w.conf, tier: w.conf < 0.68 ? 2 : 1 })),
    wpmSeries, wpmStdDev: +sd.toFixed(1),
    fluency: { events, profile: { byKind: { filled: rate(fillers.length), repetition: rate(reps.length), repair: rate(repairs.length), false_start: rate(0) } } },
  };
}
const publicWords = (s) => s.words.map(({ w, start, end, conf }) => ({ w, start, end, conf }));
const crit = (band, descriptor, summary, evidence) => ({ band, range: [band - 0.5, band + 0.5], descriptor, evidence, summary });
const serr = (s, id, category, severity, phrase, correction, explanation) => {
  const i = findWords(s.words, phrase), n = phrase.split(/\s+/).length;
  return { id, category, severity, start: i, end: i + n - 1, original: phrase, correction, explanation, time: s.words[i].start };
};

// --- Speaking Part 2 (as1): Nusrat retells learning to swim. Retry of as6, up from 6.5.
const p2 = speak([
  "Okay, so I'd like to talk about swimming, which is um a skill that took me a really long time to learn. I grew up in Dhaka, and in my area there were no public pools, so I never learned as a child. " +
  'I finally started when I was twenty-four, at a sports club near my office. <0.7> At first it was honestly quite embarrassing, because most of people in my class were about ten years old. ' +
  "The hardest part wasn't the arm movements, it was the breathing. Every time I put my face in the water, I I panicked and stood up. " +
  "My instructor told me to <1.4> to relax and breathe out slowly through my nose, but for the first two months I just can't do it. <um:1.2> " +
  'Looking back, I think it took so long because I was scared of the water, not because the technique is difficult. I went, I ^mean I tried to go, three times a week, ' +
  'and I really did a big effort to practise floating at the shallow end. Then, uh, one evening, after almost five months, I swam the whole length of the pool without stopping. ' +
  'I felt so proud that I nearly cried, to be honest.',
  'Yes, every Saturday morning, and it has become my favourite way to relax after a long week. It also taught me that being patient with myself is is more useful than being talented.',
], { breathe: 0.64, embarrassing: 0.71 });
const p2At = (phrase) => p2.words[findWords(p2.words, phrase)].start;
const speakingAnalysis = {
  skill: 'speaking', part: 2, overall: 7, overallRaw: 6.875, range: [6.5, 7.5], calibrated: true,
  criteria: {
    fc: crit(7, 'Speaks at length without noticeable effort; some hesitation is content-related.',
      'You talked for almost two minutes and moved through the card in a clear order, from why it was hard to how it felt to succeed. A few repeated words and one long pause in the middle broke the flow.',
      ['"Looking back, I think it took so long because…"', '"told me to … to relax" (1.4 s pause)']),
    lr: crit(7, 'Uses vocabulary flexibly, with some less common items and awareness of collocation.',
      'Good topic language ("shallow end", "technique", "arm movements") and natural phrases like "to be honest". One collocation slip: "did a big effort".',
      ['"practise floating at the shallow end"', '"being patient with myself"']),
    gra: crit(6.5, 'A range of complex structures; frequent error-free sentences, with some errors.',
      'You mix past tenses, relative clauses and comparisons well. Two slips keep this at 6.5: a missing article and a present tense inside a past story.',
      ['"most of people in my class"', `"I just can't do it"`]),
    p: crit(7, 'Easy to understand throughout; accent has little effect on intelligibility.',
      'Clear and easy to follow. Word stress slipped on "embarrassing", and the "th" in "breathe" sounded like a "d".',
      [`"breathe" at ${Math.floor(p2At('breathe'))} s`, `"embarrassing" at ${Math.floor(p2At('embarrassing,'))} s`]),
  },
  topFixes: [
    { title: 'Keep the past tense through the whole story', why: 'A present tense inside a past story is the kind of slip that holds Grammar at 6.5.', before: "for the first two months I just can't do it", after: "for the first two months I just couldn't do it" },
    { title: 'Make an effort, not do an effort', why: 'Examiners notice collocation errors even when the meaning is clear.', before: 'I really did a big effort to practise floating', after: 'I made a real effort to practise floating' },
    { title: 'Pause silently instead of repeating a word', why: 'Repeats like "I I panicked" and "is is more useful" sound like hesitation. A short silent pause sounds more confident.', before: 'being patient with myself is is more useful', after: 'being patient with myself is … more useful' },
  ],
  errors: [
    serr(p2, 'e1', 'grammar.article', 'minor', 'most of people', 'most of the people', '"Most of" needs "the" before a specific group: most of the people in my class.'),
    serr(p2, 'e2', 'grammar.verb-tense', 'major', "I just can't do it.", "I just couldn't do it.", 'The story is in the past, so the verb stays in the past: couldn\'t.'),
    serr(p2, 'e3', 'vocabulary.collocation', 'minor', 'did a big effort', 'made a big effort', '"Effort" goes with "make": make an effort, make a big effort.'),
    serr(p2, 'e4', 'pronunciation.word-stress', 'minor', 'embarrassing,', 'em-BARR-ass-ing', 'The stress falls on the second syllable.'),
  ],
  vocabUpgrades: [
    { original: 'a really long time', better: ['ages', 'far longer than I expected'], note: 'Less common ways to stress how long something took.' },
    { original: 'scared of the water', better: ['afraid of deep water', 'had a real fear of water'], note: 'More precise for a phobia.' },
    { original: 'so proud', better: ['incredibly proud', 'over the moon'], note: 'Idiomatic language lifts Lexical Resource towards band 8.' },
  ],
  rewrite: {
    text: "I'd like to talk about swimming, a skill that took me far longer to learn than I expected. Growing up in Dhaka, I had no public pool nearby, so I only started at twenty-four, at a sports club near my office. At first it was quite embarrassing, since most of the people in my class were about ten years old. The real challenge wasn't the arm movements but the breathing: every time I put my face in the water, I panicked and stood up. My instructor kept telling me to relax and breathe out slowly through my nose, but for the first two months I simply couldn't manage it. Looking back, it took so long because I was afraid of the water rather than because the technique is difficult. I made a real effort to go three times a week, and after almost five months I finally swam a full length without stopping. I was so proud that I nearly cried.",
    note: 'Same story, with the tense slip fixed, no restarts, and smoother linking ("since", "rather than", "Looking back").',
  },
  words: publicWords(p2),
  metrics: speechMetrics(p2),
  questions: [{ text: sp2.title, startWord: 0 }, { text: 'Do you still go swimming?', startWord: p2.starts[1] }],
  pronunciation: { unclear: [], llm: { words: [
    { word: 'breathe', time: p2At('breathe'), issue: 'The final "th" sounded like "d".', tip: 'Let your tongue touch your top teeth and keep the sound going: breathe.' },
    { word: 'embarrassing', time: p2At('embarrassing,'), issue: 'Stress on the first syllable.', tip: 'em-BARR-ass-ing: stress the second syllable.' },
  ], prosody: 'Natural rhythm overall; your voice rises nicely on the key moment ("I swam the whole length") and flattens a little when you list details.', band: 7 } },
  relevance: [{ questionIdx: 0, onTopic: true, note: 'Covers every point on the card, with a clear ending.' }, { questionIdx: 1, onTopic: true, note: 'Answers the follow-up directly and adds a reason.' }],
  noSpeech: false,
  comparison: { parentAttemptId: 'as6', parentOverall: 6.5, deltas: { fc: 0.5, lr: 0, gra: 0, p: 0.5 } },
};

// --- Speaking Part 1 (as2): her hometown, four questions.
const p1 = speak([
  "I'm from Sylhet. It's a city in the north-east of Bangladesh, quite close to the Indian border, and it's um famous for its tea gardens and the green hills around it.",
  "Honestly, I think it's the pace of life. Compared to Dhaka, everything is much calmer, and people still have time to stop and chat with their neighbours in the evening.",
  'Yes, quite a lot. There are many new shopping malls, and the roads are more wide now, <0.9> but sadly a lot of the old buildings in the centre have been knocked down.',
  "Maybe when I'm older. For now I want to stay in Dhaka because my career is there, but I'd love to retire somewhere green and quiet, like Sylhet.",
]);
const part1Analysis = {
  skill: 'speaking', part: 1, overall: 7, overallRaw: 6.875, range: [6.5, 7.5], calibrated: true,
  criteria: {
    fc: crit(7, 'Speaks at length without noticeable effort.', 'Every answer goes beyond a one-line reply, with a reason or a detail. Only one short hesitation.', ['"Compared to Dhaka, everything is much calmer"']),
    lr: crit(7, 'Uses vocabulary flexibly, with some less common items.', 'Natural phrases such as "the pace of life" and "knocked down".', ['"the pace of life"', '"knocked down"']),
    gra: crit(6.5, 'A range of complex structures; frequent error-free sentences, with some errors.', 'The present perfect is used accurately ("have been knocked down"), but "more wide" should be "wider".', ['"have been knocked down"', '"more wide"']),
    p: crit(7, 'Easy to understand throughout; accent has little effect.', 'Clear and easy to follow, with natural stress on the key words.', ['"the pace of life"']),
  },
  topFixes: [{ title: 'Short adjectives take -er', why: 'One-syllable adjectives form the comparative with -er, not "more".', before: 'the roads are more wide now', after: 'the roads are wider now' }],
  errors: [serr(p1, 'e1', 'grammar.comparative', 'minor', 'more wide', 'wider', 'One-syllable adjectives take -er: wide, wider.')],
  vocabUpgrades: [{ original: 'many new shopping malls', better: ['a wave of new shopping malls'], note: 'A less common way to say "a lot of".' }],
  rewrite: { text: "I'm from Sylhet, a city in the north-east of Bangladesh near the Indian border, famous for its tea gardens and rolling green hills.", note: 'A tighter opening with a more vivid description.' },
  words: publicWords(p1),
  metrics: speechMetrics(p1),
  questions: sp1.followUps.map((text, i) => ({ text, startWord: p1.starts[i] })),
  pronunciation: { unclear: [], llm: null },
  relevance: sp1.followUps.map((_, i) => ({ questionIdx: i, onTopic: true, note: 'Answers the question with a reason.' })),
  noSpeech: false,
};

// ---------------------------------------------------------------- writing task 2 (aw1): band 7, retry of aw0 (6.5)

const essay = `In many fast-growing cities, traffic has become one of the biggest problems of daily life. Some people argue that governments should invest in public transport instead of building more roads. I completely agree with this view, because new roads only offer a short-term solution, while good public transport benefits the whole society.

Firstly, building more roads usually encourage more people to drive. In my own city, Dhaka, several flyovers were built in the last decade, but within a few years they were as crowded as the streets below them. This happens because extra road space makes driving more convenient, so more cars appear until the traffic is as bad as before. In contrast, a metro line can carry thousands of passengers every hour while using very little land.

Secondly, public transport is fairer and better for the environment. Not everyone can afford a car, especially students and low-income workers, and they depend on buses and trains to reach their jobs. When governments improve these services, they give everyone the same access to education and employment. Moreover, fewer private cars means less air pollution, which is a serious health issue in many Asian cities.

Admittedly, roads are still necessary, particularly in rural areas where there is no railway and buses are rare. However, this is not a reason to keep widening city roads. Money spent on a modern metro or a reliable bus network will have a much bigger impact in a long term.

In conclusion, I believe that governments should give priority to public transport over new roads in cities. It reduces congestion, protect the environment and gives people equal opportunities.`;
const rewrite = `In many rapidly expanding cities, congestion has become one of the most pressing problems of daily life. Some argue that governments should invest in public transport rather than build more roads. I fully agree, since new roads offer only a short-term fix, whereas efficient public transport benefits society as a whole.

Firstly, building more roads tends to encourage more people to drive. In my own city, Dhaka, several flyovers were built in the last decade, but within a few years they were as crowded as the streets below them. This is because extra road space makes driving more convenient, so new cars fill it until congestion returns to its previous level. In contrast, a metro line can carry thousands of passengers every hour while using very little land.

Secondly, public transport is both fairer and greener. Many people, particularly students and low-income workers, cannot afford a car and depend on buses and trains to reach work. When governments improve these services, they give everyone equal access to education and employment. Moreover, fewer private cars means cleaner air, a serious public health concern in many Asian cities.

Admittedly, roads are still necessary, particularly in rural areas where there is no railway and buses are rare. However, this does not justify endlessly widening city roads. Money spent on a modern metro or a reliable bus network will have a far greater impact in the long term.

In conclusion, I believe governments should prioritise public transport over new urban roads. Doing so reduces congestion, protects the environment and gives everyone a fairer chance to succeed.`;
const werr = (id, category, severity, s, correction, explanation) => {
  const start = essay.indexOf(s);
  must(start >= 0 && essay.indexOf(s, start + 1) < 0, `essay span not unique: ${s}`);
  return { id, category, severity, start, end: start + s.length, original: s, correction, explanation, time: null };
};
const essayWords = essay.split(/\s+/).filter(Boolean).length;
const countForms = (forms) => forms.reduce((n, f) => n + (essay.toLowerCase().match(new RegExp(`\\b${f}\\b`, 'g')) ?? []).length, 0);
const writingAnalysis = {
  skill: 'writing', part: 2, overall: 7, overallRaw: 6.875, range: [6.5, 7.5], calibrated: true,
  criteria: {
    ta: crit(7, 'Addresses all parts of the task; presents a clear position throughout.',
      'Your position is clear from the first paragraph and every body paragraph supports it. The Dhaka flyover example is specific and convincing; the second reason would be stronger with a similar example.',
      ['"I completely agree with this view"', '"several flyovers were built in the last decade"']),
    cc: crit(7, 'Logically organises information and ideas; uses a range of cohesive devices.',
      'Each paragraph has one clear job, and the concession paragraph shows balance. Linkers are accurate but a little predictable ("Firstly", "Secondly", "Moreover").',
      ['"Admittedly, roads are still necessary"', '"In contrast, a metro line can carry"']),
    lr: crit(7, 'Uses a sufficient range of vocabulary, with some less common items.',
      'Good topic vocabulary ("short-term solution", "low-income workers", "congestion"). A few phrases are general ("a much bigger impact", "the same access").',
      ['"extra road space makes driving more convenient"', '"give everyone the same access"']),
    gra: crit(6.5, 'Uses a mix of complex structures; frequent error-free sentences, with a few errors.',
      'Complex sentences are used confidently, but two subject–verb agreement errors and one article slip keep this at 6.5.',
      ['"building more roads usually encourage"', '"It reduces congestion, protect the environment"']),
  },
  topFixes: [
    { title: 'Match the verb to the real subject', why: 'In "building more roads usually encourage", the subject is "building", which is singular.', before: 'building more roads usually encourage more people to drive', after: 'building more roads usually encourages more people to drive' },
    { title: 'Back up every main idea with an example', why: 'Your first reason has a vivid Dhaka example; the second has none. A specific example lifts Task Response to band 8.', before: 'Not everyone can afford a car, especially students and low-income workers', after: 'Not everyone can afford a car: in Dhaka, most garment workers rely on buses to reach their factories' },
    { title: 'Vary your linking words', why: '"Firstly… Secondly… Moreover" is accurate but mechanical. Varied linking lifts Coherence and Cohesion.', before: 'Secondly, public transport is fairer', after: 'Public transport is also fairer' },
  ],
  errors: [
    werr('w1', 'grammar.agreement', 'major', 'building more roads usually encourage', 'building more roads usually encourages', 'The subject is "building" (one activity), so the verb takes -s: encourages.'),
    werr('w2', 'vocabulary.word-choice', 'minor', 'the same access', 'equal access', '"Equal access" is the usual collocation when you talk about fairness.'),
    werr('w3', 'grammar.article', 'minor', 'in a long term', 'in the long term', 'This is a fixed phrase: in the long term.'),
    werr('w4', 'grammar.agreement', 'major', 'protect the environment', 'protects the environment', 'All three verbs share the subject "It", so each takes -s: reduces, protects, gives.'),
  ],
  vocabUpgrades: [
    { original: 'biggest problems', better: ['most pressing problems', 'greatest challenges'], note: 'Less common adjectives for importance.' },
    { original: 'a much bigger impact', better: ['a far greater impact', 'a more lasting effect'], note: 'More formal and precise.' },
    { original: 'give priority to', better: ['prioritise'], note: 'One precise verb instead of a phrase.' },
  ],
  rewrite: { text: rewrite, note: 'Same plan and examples. Fixes the agreement errors, swaps general words for precise ones and varies the linking.' },
  text: essay,
  structure: {
    paragraphs: [
      { role: 'introduction', topicSentence: 'In many fast-growing cities, traffic has become one of the biggest problems of daily life.', ok: true, note: 'Paraphrases the question and states a clear position.' },
      { role: 'body', topicSentence: 'Firstly, building more roads usually encourage more people to drive.', ok: true, note: 'One idea, explained and supported by the Dhaka example.' },
      { role: 'body', topicSentence: 'Secondly, public transport is fairer and better for the environment.', ok: true, note: 'Two related points; add a concrete example.' },
      { role: 'body', topicSentence: 'Admittedly, roads are still necessary, particularly in rural areas where there is no railway and buses are rare.', ok: true, note: 'A fair concession, then back to your view.' },
      { role: 'conclusion', topicSentence: 'In conclusion, I believe that governments should give priority to public transport over new roads in cities.', ok: true, note: 'Restates the opinion and sums up the reasons.' },
    ],
    overview: null, position: { clear: true, consistent: true, note: 'Clear in the introduction and repeated in the conclusion.' }, planFollowed: { followed: true, note: 'Matches your plan: two reasons, a concession and a conclusion.' },
  },
  textMetrics: { words: essayWords, sentences: 17, paragraphs: 5, avgSentenceLen: +(essayWords / 17).toFixed(1), mtld: 84.2, ttr: 0.57,
    linkers: [{ word: 'firstly', count: 1, overused: false }, { word: 'secondly', count: 1, overused: false }, { word: 'moreover', count: 1, overused: false }, { word: 'however', count: 1, overused: false }, { word: 'in contrast', count: 1, overused: false }, { word: 'admittedly', count: 1, overused: false }],
    repeated: [{ word: 'roads', count: countForms(['roads', 'road']), forms: ['roads', 'road'] }, { word: 'public', count: countForms(['public']), forms: ['public'] }, { word: 'transport', count: countForms(['transport']), forms: ['transport'] }] },
  tooShort: false,
  comparison: { parentAttemptId: 'aw0', parentOverall: 6.5, deltas: { ta: 0, cc: 0.5, lr: 0.5, gra: 0.5 } },
};

// ---------------------------------------------------------------- attempts, history, progress

const attempt = (id, prompt, analysis, extra = {}) => ({ id, promptId: prompt.id, skill: prompt.skill, part: prompt.part, mode: 'practice', sessionId: null, parentAttemptId: null, audioUrl: null, text: null, plan: null, durationMs: null, overtime: false, status: 'done', error: null, createdAt: day(0), analysis, prompt, ...extra });
const aSpeak = attempt('as1', sp2, speakingAnalysis, { durationMs: Math.round(p2.dur * 1000), sessionId: 's1' });
const aWrite = attempt('aw1', w2, writingAnalysis, { text: essay, durationMs: 38 * 60000, plan: 'Position: agree, transport > roads\nBody 1: new roads fill up (Dhaka flyovers)\nBody 2: fairer + cleaner air\nConcession: rural roads\nConclusion: restate' });

// [id, title, skill, part, band, days ago, minutes]: three weeks from 6.0 to 7.0
const history = [
  ['as1', sp2.title, 'speaking', 2, 7, 0, p2.dur / 60], ['aw1', w2.title, 'writing', 2, 7, 0, 38], ['as2', sp1.title, 'speaking', 1, 7, 1, p1.dur / 60],
  ['aw2', w1a.title, 'writing', 1, 6.5, 2, 19], ['as12', sp3.title, 'speaking', 3, 7, 3, 4.6], ['as13', 'Describe a journey you remember well.', 'speaking', 2, 6.5, 4, 1.8],
  ['aw0', w2.title, 'writing', 2, 6.5, 6, 41], ['as6', sp2.title, 'speaking', 2, 6.5, 7, 1.6], ['as8', 'Work or studies', 'speaking', 1, 6.5, 11, 3.9],
  ['aw3', w1b.title, 'writing', 1, 6, 11, 22], ['as9', 'Technology and communication', 'speaking', 3, 6, 14, 4.2], ['aw4', 'Children and screen time', 'writing', 2, 6, 15, 44],
  ['as10', 'Describe a place you like to relax.', 'speaking', 2, 6, 17, 1.4], ['as11', 'Daily routine', 'speaking', 1, 6, 20, 3.5], ['aw5', w1p.title, 'writing', 1, 6, 21, 24],
];
const list = history.map(([id, promptTitle, skill, part, overall, d, min]) => ({ id, promptTitle, skill, part, mode: 'practice', status: 'done', overall, createdAt: day(d), durationMs: Math.round(min * 60000) }));

// Per-criterion bands behind each scored attempt (oldest first), matching the overall bands above.
const CRIT = { // smooth climbs, so the band-by-criterion chart reads as steady progress
  as11: [6, 6.5, 5.5, 6], as10: [6, 6.5, 5.5, 6], as9: [6, 6.5, 6, 6], as8: [6.5, 6.5, 6, 6.5], as6: [6.5, 7, 6, 6.5], as13: [6.5, 7, 6, 6.5], as12: [7, 7, 6.5, 6.5], as2: [7, 7, 6.5, 7], as1: [7, 7, 6.5, 7],
  aw5: [6, 6, 6, 5.5], aw4: [6, 6, 6.5, 5.5], aw3: [6.5, 6, 6.5, 5.5], aw0: [7, 6.5, 6.5, 6], aw2: [7, 6.5, 7, 6], aw1: [7, 7, 7, 6.5],
};
const trendOf = (skill) => list.filter((a) => a.skill === skill).reverse().map((a) => {
  const keys = skill === 'speaking' ? ['fc', 'lr', 'gra', 'p'] : ['ta', 'cc', 'lr', 'gra'];
  return { date: a.createdAt, overall: a.overall, skill, part: a.part, criteria: Object.fromEntries(keys.map((k, i) => [k, CRIT[a.id][i]])) };
});
const trendS = trendOf('speaking'), trendW = trendOf('writing');
const progress = (trend) => ({ trend, streak: 6, minutesThisWeek: 142, attempts: 24, weakest: { key: 'gra', avg: 6.3 },
  topMistakes: [{ category: 'grammar.article', count: 11 }, { category: 'grammar.agreement', count: 8 }, { category: 'grammar.verb-tense', count: 6 }, { category: 'vocabulary.collocation', count: 4 }],
  predicted: { speaking: 7, writing: 6.5 } });

const mistakes = [
  ['grammar.article', 'most of people in my class', 'most of the people in my class', '"Most of" needs "the" before a specific group.', 'as1', 'speaking', 2, sp2.title, 0, false],
  ['grammar.verb-tense', "for the first two months I just can't do it", "for the first two months I just couldn't do it", 'Keep a past story in the past tense.', 'as1', 'speaking', 2, sp2.title, 0, true],
  ['grammar.agreement', 'building more roads usually encourage', 'building more roads usually encourages', 'The subject "building" is singular.', 'aw1', 'writing', 2, w2.title, 0, false],
  ['grammar.agreement', 'It reduces congestion, protect the environment', 'It reduces congestion, protects the environment', 'Each verb after "It" takes -s.', 'aw1', 'writing', 2, w2.title, 0, false],
  ['vocabulary.collocation', 'did a big effort', 'made a big effort', '"Effort" goes with "make".', 'as1', 'speaking', 2, sp2.title, 0, false],
  ['grammar.article', 'in a long term', 'in the long term', 'A fixed phrase: in the long term.', 'aw1', 'writing', 2, w2.title, 0, false],
  ['grammar.comparative', 'the roads are more wide now', 'the roads are wider now', 'One-syllable adjectives take -er.', 'as2', 'speaking', 1, sp1.title, 1, false],
].map(([category, original, correction, explanation, attemptId, skill, part, promptTitle, d, inDeck], i) => ({ id: `m${i}`, attemptId, skill, part, promptTitle, category, original, correction, explanation, time: skill === 'speaking' ? 12.4 + i : null, inDeck, createdAt: day(d) }));

const cards = [
  { id: 'c1', front: "🎧 Listening · spell the word you heard: 'acco_____tion' (13 letters)", back: 'accommodation\nYou wrote: accomodation', source: 'mistake', ease: 2.5, interval: 1, reps: 1 },
  { id: 'c2', front: 'most of people in my class', back: 'most of the people in my class\n\n"Most of" needs "the" before a specific group.', source: 'mistake', ease: 2.4, interval: 6, reps: 2 },
  { id: 'c3', front: "Keep the past tense through the whole story\n\nfor the first two months I just can't do it", back: "for the first two months I just couldn't do it\n\nA present tense inside a past story holds Grammar at 6.5.", source: 'fix', ease: 2.5, interval: 0, reps: 0 },
  { id: 'c4', front: 'congestion', back: 'the state of a road or area being too crowded with traffic\n\nThe new metro line has eased congestion in the city centre.', source: 'vocab', ease: 2.6, interval: 3, reps: 2 },
  { id: 'c5', front: 'building more roads usually encourage more people to drive', back: 'building more roads usually encourages more people to drive\n\nThe subject "building" is singular.', source: 'mistake', ease: 2.3, interval: 1, reps: 1 },
];

const models = (ids) => ({ models: ids.map(([id, name, pr, co]) => ({ id, name, pricing: { prompt: String(pr), completion: String(co) } })) });
const textModels = models([['openai/gpt-6-luna', 'OpenAI: GPT-6 Luna', 1e-7, 5e-7], ['deepseek/deepseek-v4.1-flash', 'DeepSeek: V4.1 Flash', 1.5e-7, 6e-7], ['google/gemini-3.8-flash', 'Google: Gemini 3.8 Flash', 2.5e-7, 1e-6]]);

const page = (items) => ({ items, total: items.length, page: 1, pageSize: 30 });
const allPrompts = [...speakingBank, ...writingBank];
const metaGroups = [];
for (const x of allPrompts) {
  let g = metaGroups.find((m) => m.skill === x.skill && m.part === x.part);
  if (!g) metaGroups.push(g = { skill: x.skill, part: x.part, topics: [], types: [] });
  if (x.topic && !g.topics.includes(x.topic)) g.topics.push(x.topic);
  if (x.type && !g.types.includes(x.type)) g.types.push(x.type);
}

const fx = {
  '/api/me': me,
  '/api/progress': progress([...trendS, ...trendW].sort((a, b) => list.findIndex((x) => x.createdAt === b.date) - list.findIndex((x) => x.createdAt === a.date))),
  '/api/progress?skill=speaking': progress(trendS),
  '/api/progress?skill=writing': progress(trendW),
  '/api/attempts': { items: list, total: list.length },
  '/api/attempts?page=1': { items: list, total: list.length },
  '/api/attempts?page=1&skill=speaking': { items: list.filter((a) => a.skill === 'speaking'), total: list.filter((a) => a.skill === 'speaking').length },
  '/api/attempts?page=1&skill=writing': { items: list.filter((a) => a.skill === 'writing'), total: list.filter((a) => a.skill === 'writing').length },
  '/api/attempts/as1': aSpeak,
  '/api/attempts/aw1': aWrite,
  '/api/attempts/aw0': attempt('aw0', w2, { ...writingAnalysis, overall: 6.5, overallRaw: 6.5, comparison: null }, { text: essay, createdAt: day(6) }),
  '/api/attempts/as2': attempt('as2', sp1, part1Analysis, { sessionId: 's1', durationMs: Math.round(p1.dur * 1000), createdAt: day(1) }),
  '/api/attempts/as3': attempt('as3', sp3, null, { status: 'analyzing', stage: 'analyzing' }),
  '/api/attempts/as4': attempt('as4', sp2, null, { status: 'failed', error: 'The AI service timed out.', retryable: true }),
  '/api/attempts/as5': attempt('as5', sp1, { ...part1Analysis, overall: 0, overallRaw: 0, noSpeech: true, errors: [], topFixes: [] }),
  '/api/cards/due': { cards, total: 9, deck: 64 },
  '/api/mistakes': { groups: [{ category: 'grammar.article', count: 11 }, { category: 'grammar.agreement', count: 8 }, { category: 'grammar.verb-tense', count: 6 }, { category: 'vocabulary.collocation', count: 4 }, { category: 'grammar.comparative', count: 2 }], items: mistakes, total: mistakes.length },
  '/api/models': textModels,
  '/api/prompts': page(allPrompts),
  '/api/prompts?page=1': page(allPrompts),
  '/api/prompts?page=1&skill=speaking': page(speakingBank),
  '/api/prompts?page=1&skill=speaking&source=generated': page(speakingBank),
  '/api/prompts?page=1&skill=speaking&source=cambridge': page([]),
  '/api/prompts?page=1&part=1&skill=speaking': page(speakingBank.filter((x) => x.part === 1)),
  '/api/prompts?page=1&part=2&skill=speaking': page(speakingBank.filter((x) => x.part === 2)),
  '/api/prompts?page=1&part=3&skill=speaking': page(speakingBank.filter((x) => x.part === 3)),
  '/api/prompts?page=1&part=2&skill=speaking&source=generated': page(speakingBank.filter((x) => x.part === 2)),
  '/api/prompts?page=1&skill=writing': page(writingBank),
  '/api/prompts?page=1&skill=writing&source=generated': page(writingBank),
  '/api/prompts/random?part=1&skill=speaking': sp1,
  '/api/prompts/random?part=2&skill=speaking': sp2,
  '/api/prompts/random?part=3&skill=speaking': sp3,
  '/api/prompts/random?part=1&skill=speaking&source=generated': sp1,
  '/api/prompts/random?part=2&skill=speaking&source=generated': sp2,
  '/api/prompts/random?part=3&skill=speaking&source=generated': sp3,
  '/api/prompts/random?part=2&skill=writing': w2,
  '/api/prompts/random?part=1&skill=writing&variant=academic': w1a,
  '/api/prompts/random?part=1&skill=writing&variant=general': w1g,
  '/api/speaking/test': { part1: [sp1], part2: sp2, part3: sp3 },
  '/api/prompts/meta': { groups: metaGroups },
  '/api/models?capability=tts': { models: [{ id: 'google/gemini-3.8-flash-tts', name: 'Google: Gemini 3.8 Flash TTS', voices: ['Charon', 'Puck', 'Kore'], pricing: { prompt: '0', completion: '0' } }] },
};
const liveStart = { sessionId: 'live-demo', examinerText: "Good morning. My name is Daniel, and I'll be your examiner today. Can you tell me your full name, please?", audioUrl: null, voiceError: null, phase: 'p1', prepSeconds: null, cueCard: null, test: { part1: [sp1], part2: sp2, part3: sp3 } };
fx['/api/live/start'] = liveStart;
fx['POST /api/live/start'] = liveStart;
for (const x of allPrompts) fx[`/api/prompts/${x.id}`] = x; // the editor and the prompt bank open a task by id

// Community mode (docs/community.md). Nusrat runs on her own key (unlimited, every live examiner); the community and guest screens keep their own
// answers. "@@DAY@@" / "@@WEEK@@" in a resetAt are filled in at run time (next 00:00 UTC / next Monday 00:00 UTC), so "Resets in 5 h" never goes stale.
// "path#screen" keys answer only that `-screen`; "path#guest" answers every guest-* screen.
const sq = (used, limit, window, resetAt, blocked = null) => ({ used, limit, remaining: limit === null ? null : Math.max(0, limit - used), resetAt, window, blocked });
const unlimited = { used: 0, limit: null, remaining: null, resetAt: null, window: null, blocked: null };
const bal = (remaining) => ({ limit: 20, used: +(20 - remaining).toFixed(2), remaining, updatedAt: day(0) });
const quota = (tier, speaking, writing, liveProviders, communityBalance = bal(12.4)) => ({ tier, speaking, writing, liveProviders, communityBalance });
const community = quota('community', sq(0, 1, 'day', '@@DAY@@'), sq(0, 1, 'day', '@@DAY@@'), []);
const ownKey = quota('own-key', unlimited, unlimited, ['turn', 'gpt-live', 'gemini-live'], { limit: null, used: null, remaining: null, updatedAt: day(0) });
fx['/api/quota'] = ownKey;
fx['/api/quota#guest'] = quota('guest', sq(0, 1, 'week', '@@WEEK@@'), sq(0, 1, 'week', '@@WEEK@@'), []);
fx['/api/quota#fair-use'] = community;
fx['/api/quota#live'] = ownKey;
fx['/api/quota#live-locked'] = community;
fx['/api/quota#quota-exhausted'] = quota('community', sq(1, 1, 'day', '@@DAY@@', 'quota_exceeded'), sq(0, 1, 'day', '@@DAY@@'), []);
fx['/api/quota#writing-quota-exhausted'] = quota('community', sq(0, 1, 'day', '@@DAY@@'), sq(1, 1, 'day', '@@DAY@@', 'quota_exceeded'), []);
fx['/api/quota#guest-quota-exhausted'] = quota('guest', sq(1, 1, 'week', '@@WEEK@@', 'quota_exceeded'), sq(0, 1, 'week', '@@WEEK@@'), []);
fx['/api/quota#balance-exhausted'] = quota('community', sq(0, 1, 'day', '@@DAY@@', 'community_balance_exhausted'), sq(0, 1, 'day', '@@DAY@@', 'community_balance_exhausted'), [], bal(0.18));
fx['/api/quota#balance'] = quota('community', sq(0, 1, 'day', '@@DAY@@'), sq(1, 1, 'day', '@@DAY@@', 'quota_exceeded'), [], bal(1.4));
fx['/api/quota#keys-settings'] = quota('own-key', unlimited, unlimited, ['turn']);
fx['/api/keys'] = { keys: [{ provider: 'openrouter', last4: 'q7Rk', addedAt: day(19), valid: true }] };
fx['/api/keys#keys-settings'] = { keys: [
  { provider: 'openrouter', last4: 'ab12', addedAt: day(2), valid: true },
  { provider: 'gemini', last4: '9xQ2', addedAt: day(9), valid: false },
] };
fx['/api/community/balance'] = bal(12.4);
mkdirSync(dirname(out), { recursive: true });

// ---------------------------------------------------------------- Listening & Reading (/api/lr/*)
// Our own practice tests (the server dev fixtures, apps/server/src/test/fixtures/lr). Asset URLs are placeholders: the iOS demo maps them to
// bundled files (IELTS/Demo/demo-audio.mp3, a silent recording as long as the longest part, and demo-map.png).
{
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../server/src/test/fixtures/lr');
  const load = (f, o) => ({ ...JSON.parse(readFileSync(join(dir, f), 'utf8')), ...o });
  const L = load('lr-listening.json', { slug: 'original-listening-1', ref: 'Original L1', title: 'Original practice: Listening 1', source: 'generated' });
  const R = load('lr-reading.json', { slug: 'original-reading-1', ref: 'Original R1', title: 'Original practice: Reading 1', source: 'generated' });
  // Part 1: the class time is one question with two blanks ("from {{3}} to {{3}}"), as in the real form-completion task.
  {
    const s = L.sections[0], g = s.groups[0];
    const content = g.content.replace('| Start time | {{3}} pm |', '| Class time | {{3}} pm to {{3}} pm |');
    const transcript = s.transcript.replace('starting at six thirty.', 'from six thirty to eight thirty.');
    must(content !== g.content && transcript !== s.transcript, 'listening part 1 changed upstream');
    g.content = content;
    s.transcript = transcript;
    g.questions.find((q) => q.n === 3).answer = ['6.30 / 8.30'];
  }
  const titled = (t, n) => ({ ...t, slug: `original-${t.skill}-${n}`, ref: `Original ${t.skill[0].toUpperCase()}${n}`, title: `Original practice: ${t.skill === 'listening' ? 'Listening' : 'Reading'} ${n}` });
  const A = 'https://demo.ielts.local/lr-assets/';
  const assetsOf = (t) => Object.fromEntries(t.sections.flatMap((s) => [s.audio, ...s.groups.map((g) => g.image)]).filter(Boolean)
    .map((k) => [k, A + (k.endsWith('.svg') ? 'map.png' : k.split('/').pop())]));
  const strip = (t) => ({ ...t, sections: t.sections.map(({ transcript, vocab, timings, ...s }) => ({ ...s, groups: s.groups.map((g) => ({ ...g, questions: g.questions.map(({ answer, review, ...q }) => q) })) })) });

  // What Nusrat got wrong (10 of 40 each: band 7.0); '' = left blank. Every other answer is the key's first form.
  const WRONG = {
    listening: { 5: 'aprone', 8: '5 pm', 12: 'C', 17: 'A', 19: 'B', 23: 'A', 27: 'suit', 28: 'wieght', 34: 'beatles', 39: '' },
    reading: { 2: 'NOT GIVEN', 5: 'FALSE', 9: 'sedement', 12: 'C', 16: 'v', 21: 'NO', 25: 'A', 30: 'A', 36: 'harshley', 38: '' },
  };
  // ---- review enrichment (what the server adds after submit): per-question evidence / why / wrong / paraphrase, vocab, word timings ----
  const REVIEW = {
    reading: {
      1: { evidence: 'prized for their fur and for castoreum, a secretion once used in medicine and perfume', why: 'Castoreum is a product other than fur, so the statement is TRUE.', paraphrase: [['products other than their fur', 'castoreum, a secretion once used in medicine and perfume']] },
      2: { evidence: 'four families of beavers from Norway were released', why: 'The animals came from Norway, not Scotland, so the statement is FALSE.',
        wrong: { 'NOT GIVEN': 'The passage does say where they came from: Norway. When the text contradicts the statement, the answer is FALSE, not NOT GIVEN.' }, paraphrase: [['born in Scotland', 'from Norway']] },
      3: { evidence: 'In 2009 a small trial began in Knapdale, Scotland', why: 'The Knapdale release (2009) came before the Tay population was found (2012).' },
      4: { evidence: 'although some villagers remained unconvinced', why: 'Only some villagers were unconvinced; "all were convinced" is the opposite of that.', wrong: { TRUE: '"All" is too strong. The passage says some villagers stayed unconvinced.' }, paraphrase: [['All the villagers', 'some villagers']] },
      5: { evidence: 'the evidence for trout is less certain', why: 'The passage only says the evidence for trout is uncertain. It never says dams stop trout, so there is nothing to agree or disagree with.',
        wrong: { FALSE: 'FALSE needs the passage to say that dams do not stop trout. "Less certain" says neither, so the answer is NOT GIVEN.' }, paraphrase: [['prevent trout from migrating', 'the evidence for trout is less certain']] },
      6: { evidence: 'only as a last resort are animals moved', why: 'Moving animals is the last resort, so it is not the first measure.' },
      7: { evidence: 'prized for their fur and for castoreum, a secretion once used in medicine and perfume' },
      8: { evidence: 'a chain of lochs', why: 'Look for the word after "a chain of".' },
      9: { evidence: 'the ponds behind them trap sediment that would otherwise cloud the river', why: 'Spelling counts: sediment, with an "i".', paraphrase: [['catch', 'trap'], ['make the river cloudy', 'cloud the river']] },
      10: { evidence: 'it can be modified with a pipe that lowers the pond level' },
      12: { evidence: 'Farmers on low-lying land report that burrows weaken riverbanks and that felled trees block drainage ditches.', why: 'The farmers complain about damage to banks and blocked drains.',
        wrong: { A: 'Crops are never mentioned.', C: 'Fish come up in the same paragraph, but it is anglers, not farmers, who talk about them.', D: 'Flooding is the benefit in paragraph C, not the farmers\' complaint.' } },
      16: { evidence: 'Critics point to practical problems.', why: 'Paragraph C lists practical objections (sports, jobs, bus routes): heading iii.', wrong: { v: 'Cost appears in paragraph C, but who pays is the main idea of paragraph E.' } },
      19: { evidence: 'a time chosen long before anyone studied adolescent sleep', why: 'The start time was chosen before anyone studied adolescent sleep.' },
      20: { evidence: 'Grades rose by about four per cent in biology', why: 'Grades rose in biology, so at least one subject improved.', wrong: { NO: 'The passage reports a four per cent rise in biology.' }, paraphrase: [['higher grades', 'Grades rose'], ['The Seattle change', 'moved their start time']] },
      21: { evidence: 'Some parents also worry that children will simply stay up later', why: 'Parents are only said to worry. Nothing says how many support a later start, so NOT GIVEN.',
        wrong: { NO: 'NO needs the writer to say that most parents are against it. The passage only mentions some parents worrying.' } },
      25: { evidence: 'Later finishes collide with sports practice and part-time jobs', why: 'Later finishes clash with sports practice: D, sports.', wrong: { A: 'Sleep is the benefit, not the thing that is disrupted.' } },
      30: { evidence: 'withdrawn after complaints that it sounded artificial', why: 'People complained that it sounded artificial: B.', wrong: { A: 'Cost is never given as a reason.' } },
      31: { evidence: 'a city has a "soundscape" in the same way that it has a skyline' },
      32: { evidence: 'people who could identify the source of a sound tolerated it better', paraphrase: [['knew their', 'could identify the']] },
      36: { evidence: 'sounds imposed from above are judged more harshly', why: 'Spelling counts: harshly.' },
      38: { evidence: 'the data are discarded after analysis', why: 'The data are thrown away after analysis: discarded.' },
    },
    listening: {
      1: { evidence: "It's Whitlock, W-H-I-T-L-O-C-K" },
      2: { evidence: 'The class meets on Thursday evenings' },
      3: { evidence: 'from six thirty to eight thirty', why: 'One question, two blanks: the start time goes in the first, the finish time in the second.' },
      4: { evidence: "It's eighty-five pounds for eight weeks", why: 'The £ sign is printed in the form, so write the figure only.' },
      5: { evidence: 'Just an apron', why: 'Spelling counts. "aprone" is marked wrong even though you heard the right word.' },
      8: { evidence: 'Parking is free after five pm', why: 'The sentence already ends in "pm", so the gap needs the number only.' },
      9: { evidence: 'Your tutor is Elena' },
      10: { evidence: 'the course ends with a small exhibition of your work' },
      11: { evidence: 'This year two facilities are new: the bike hire stand and the boat tours', why: 'The cafe and the playground "have been here for years", so only B and D are new.' },
      12: { evidence: 'This year two facilities are new: the bike hire stand and the boat tours', why: 'The cafe and the playground "have been here for years", so only B and D are new.',
        wrong: { C: 'The playground has been there for years, so it is not new.' } },
      17: { evidence: 'It was a rail yard until the 1990s', why: 'A rail yard is railway land, so B.', wrong: { A: 'No factory is mentioned. The straight paths come from the railway.' } },
      18: { evidence: 'Volunteers do most of the planting' },
      19: { evidence: 'the best time for birdwatching is early morning', why: 'The park is busiest in summer, but birdwatching is best early in the morning.', wrong: { B: 'Midday is never mentioned.' } },
      20: { evidence: 'the only thing you cannot do in the park is light a barbecue' },
      23: { evidence: 'we should both visit the apiary on campus next week', why: '"We should both" means Priya and Marcus together: C.', wrong: { A: 'Priya says "we should both", so not Priya alone.' } },
      26: { evidence: 'First, we select a sunny terrace for the hives' },
      27: { evidence: 'Second, buy protective suits', why: 'You need the plural: the speaker says "suits".' },
      28: { evidence: 'record the weight of each hive every week', why: 'Spelling counts: weight, with "ei".' },
      31: { evidence: 'a fatty structure called an elaiosome' },
      32: { evidence: 'Ants carry the seed to their nest' },
      34: { evidence: 'This protects it from seed-eating beetles', why: 'The insects are beetles, b-e-e-t-l-e-s.' },
      36: { evidence: 'Ants typically move seeds no more than ten metres', why: 'The gap needs the number only; "metres" is already printed.' },
      37: { evidence: 'most common in heathland' },
      39: { evidence: 'some invasive ants eat the seeds instead of burying them', why: 'After "instead of", the verb takes -ing: burying.' },
    },
  };
  const VOCAB = {
    reading: { 1: [{ word: 'castoreum', meaning: 'an oily secretion from beavers, once used in medicine and perfume', example: 'Beavers were prized for castoreum as well as their fur.' }, { word: 'sediment', meaning: 'small pieces of soil and stone that settle at the bottom of water', example: 'Ponds trap sediment that would cloud the river.' }, { word: 'unconvinced', meaning: 'not persuaded that something is true or good' }], 3: [{ word: 'soundscape', meaning: 'the mix of sounds that make up the character of a place', example: 'A city has a soundscape in the same way it has a skyline.' }] },
    listening: { 1: [{ word: 'apron', meaning: 'a garment worn over clothes to keep them clean', example: 'Just an apron, we provide everything else.' }], 3: [{ word: 'apiary', meaning: 'a place where bees are kept', example: 'We should both visit the apiary on campus.' }], 4: [{ word: 'elaiosome', meaning: 'a fatty body on a seed that attracts ants' }, { word: 'dispersal', meaning: 'the spreading of something over a wide area', example: 'Seed dispersal by ants.' }] },
  };
  /** [word, start, end] rows as the timings importer writes them: ~2.7 words a second, short pauses at sentence ends and lines. */
  const timingsOf = (text) => {
    let t = 0.6;
    const rows = [];
    for (const line of text.split('\n')) {
      for (const w of line.split(/\s+/).filter(Boolean)) {
        const d = 0.18 + 0.035 * w.replace(/[^\p{L}\p{N}]/gu, '').length;
        rows.push([w, +t.toFixed(2), +(t + d).toFixed(2)]);
        t += d + (/[.?!]$/.test(w) ? 0.45 : 0.06);
      }
      t += 0.5;
    }
    return rows;
  };
  const enrich = (t) => ({
    ...t,
    sections: t.sections.map((s) => ({
      ...s,
      ...(VOCAB[t.skill][s.part] ? { vocab: VOCAB[t.skill][s.part] } : {}),
      ...(s.transcript ? { timings: timingsOf(s.transcript) } : {}),
      groups: s.groups.map((g) => ({ ...g, questions: g.questions.map((q) => {
        const base = REVIEW[t.skill][q.n] ? JSON.parse(JSON.stringify(REVIEW[t.skill][q.n])) : {};
        // a "why this option is wrong" note for every other wrong option of a choice question
        if (g.type === 'mcq' || g.type === 'match') {
          base.wrong ??= {};
          for (const o of q.options ?? g.options ?? []) if (!q.answer.includes(o.key) && !base.wrong[o.key]) base.wrong[o.key] = o.text ? `"${o.text}" is not what the ${t.skill === 'listening' ? 'speaker says' : 'passage says'}; look again at the evidence.` : 'This letter does not match the evidence.';
        }
        return Object.keys(base).length ? { ...q, review: base } : q;
      }) })),
    })),
  });
  const responsesOf = (t, wrong) => {
    const r = {};
    for (const s of t.sections) for (const g of s.groups) g.questions.forEach((q, i) => { r[q.n] = g.type === 'mcq-multi' ? g.questions[0].answer[i] : q.answer[0]; });
    for (const [n, v] of Object.entries(wrong)) if (v) r[n] = v; else delete r[n];
    return r;
  };
  const attempt = (id, testId, t, mode, extra = {}) => ({ id, testId, mode, parts: null, status: 'in_progress', responses: {}, elapsedS: 0, startedAt: day(0), submittedAt: null, raw: null, total: null, band: null, marks: null, test: strip(t), assets: assetsOf(t), ...extra });
  const STATS = {
    reading: { partS: { 1: 1150, 2: 1040, 3: 1210 }, changes: { 5: 2, 16: 1, 21: 2, 25: 1 }, late: [35, 36, 37, 38, 39, 40] },
    listening: { partS: { 1: 610, 2: 580, 3: 540, 4: 570 }, changes: { 8: 1, 27: 1 }, late: [] },
  };
  const BEFORE = { sediment: 2, weight: 1 };
  const submitted = (id, testId, t, mode, d) => {
    const full = enrich(t), responses = responsesOf(full, WRONG[t.skill]);
    const { raw, total, band, marks } = scoreLr(full, responses);
    must(raw === 30 && band === 7, `${t.skill} demo score is ${raw} (band ${band}), expected 30 (7.0)`);
    const analysis = analyseAttempt(full, marks, responses, (w) => BEFORE[w.toLowerCase()] ?? 0);
    return attempt(id, testId, t, mode, { status: 'submitted', responses, elapsedS: t.skill === 'reading' ? 3400 : 2300, startedAt: day(d), submittedAt: day(d), raw, total, band, marks, test: full, stats: STATS[t.skill], analysis });
  };
  const L1 = titled(L, 1), L2 = titled(L, 2), R1 = titled(R, 1), R2 = titled(R, 2);
  const only = (t, ns) => Object.fromEntries(Object.entries(responsesOf(enrich(t), {})).filter(([n]) => ns.includes(+n)));
  // Practice listening in progress: the form half done, the recording left just before the class times (Q2-Q4 are typed in the video).
  const p1Timings = timingsOf(L.sections[0].transcript);
  const resumeAt = +(p1Timings.find(([w]) => w === 'meets')[1] - 4).toFixed(1);
  const lraL = attempt('lra-l', 'lt-l2', L2, 'practice', { responses: only(L2, [1, 5, 6, 7, 8, 9, 10]), elapsedS: 410, startedAt: day(0), stats: { partS: { 1: 410 }, changes: {}, late: [], audio: { pos: { 1: resumeAt }, rate: 1 } } });
  const lraP2 = attempt('lra-p2', 'lt-l2', pickParts(L2, [2]), 'practice', { parts: [2] });
  const lraLe = attempt('lra-le', 'lt-l2', L2, 'exam');
  const lraR = attempt('lra-r', 'lt-r2', R2, 'exam', { responses: only(R2, [1, 2, 3]), elapsedS: 540 });
  const lraLs = submitted('lra-ls', 'lt-l1', L1, 'practice', 1);
  const lraRs = submitted('lra-rs', 'lt-r1', R1, 'exam', 2);

  const item = (id, t, n, o) => ({ id, slug: `original-${t.skill}-${n}`, skill: t.skill, variant: t.variant, source: 'generated', ref: `Original ${n}`, title: `Original practice: ${t.skill === 'listening' ? 'Listening' : 'Reading'} ${n}`, total: 40, status: 'new', attemptId: null, mode: null, parts: null, answered: 0, bestBand: null, attempts: 0, ...o });
  const answered = (a) => Object.keys(a.responses).length;
  fx['/api/lr/tests?skill=listening'] = { items: [
    item('lt-l1', L, 1, { status: 'submitted', bestBand: 7, attempts: 2 }),
    item('lt-l2', L, 2, { status: 'in_progress', attemptId: 'lra-l', mode: 'practice', answered: answered(lraL) }),
    item('lt-l3', L, 3, { status: 'submitted', bestBand: 6.5, attempts: 1 }),
    item('lt-l4', L, 4, { status: 'submitted', bestBand: 6, attempts: 1 }),
    item('lt-l5', L, 5, {}),
    item('lt-l6', L, 6, {}),
  ] };
  fx['/api/lr/tests?skill=reading'] = { items: [
    item('lt-r1', R, 1, { status: 'submitted', bestBand: 7, attempts: 1 }),
    item('lt-r2', R, 2, { status: 'in_progress', attemptId: 'lra-r', mode: 'exam', answered: answered(lraR) }),
    item('lt-r3', R, 3, { status: 'submitted', bestBand: 6.5, attempts: 1 }),
    item('lt-r4', R, 4, { status: 'submitted', bestBand: 6, attempts: 1 }),
    item('lt-r5', { ...R, variant: 'general' }, 5, {}),
    item('lt-r6', { ...R, variant: 'general' }, 6, {}),
  ] };
  const lrRow = (id, testId, skill, n, mode, band, d, status = 'submitted', answeredN = 40) => ({ id, testId, skill, variant: 'academic', ref: `Original ${n}`, title: `Original practice: ${skill === 'listening' ? 'Listening' : 'Reading'} ${n}`,
    mode, parts: null, status, raw: status === 'submitted' ? { 7: 30, 6.5: 27, 6: 24 }[band] : null, total: status === 'submitted' ? 40 : null, band: status === 'submitted' ? band : null, answered: answeredN, startedAt: day(d), submittedAt: status === 'submitted' ? day(d) : null });
  fx['/api/lr/attempts'] = { items: [
    lrRow('lra-r', 'lt-r2', 'reading', 2, 'exam', null, 0, 'in_progress', answered(lraR)),
    lrRow('lra-ls', 'lt-l1', 'listening', 1, 'practice', 7, 1), lrRow('lra-rs', 'lt-r1', 'reading', 1, 'exam', 7, 2),
    lrRow('lra-l1b', 'lt-l1', 'listening', 1, 'exam', 6.5, 6), lrRow('lra-r3', 'lt-r3', 'reading', 3, 'exam', 6.5, 9),
    lrRow('lra-l3', 'lt-l3', 'listening', 3, 'exam', 6.5, 12), lrRow('lra-r4', 'lt-r4', 'reading', 4, 'exam', 6, 16), lrRow('lra-l4', 'lt-l4', 'listening', 4, 'exam', 6, 18),
  ] };
  for (const a of [lraR, lraL, lraP2, lraLe, lraRs, lraLs]) fx[`/api/lr/attempts/${a.id}`] = a;

  // /api/lr/progress and /api/lr/spelling (the server aggregates submitted attempts; this is what it would say for this account)
  const tfRows = [lraRs, lraLs].flatMap((a) => a.analysis.tfng);
  const byType = [...lraRs.analysis.byType.map((x) => ({ skill: 'reading', ...x })), ...lraLs.analysis.byType.map((x) => ({ skill: 'listening', ...x }))];
  fx['/api/lr/progress'] = {
    trend: [['lra-l4', 'listening', 18, 6], ['lra-l3', 'listening', 12, 6.5], ['lra-l1b', 'listening', 6, 6.5], ['lra-ls', 'listening', 1, 7], ['lra-r4', 'reading', 16, 6], ['lra-r3', 'reading', 9, 6.5], ['lra-rs', 'reading', 2, 7]]
      .map(([attemptId, skill, d, band]) => ({ attemptId, skill, date: day(d), band })),
    byType,
    weakest: byType.filter((x) => x.total >= 3 && x.right < x.total).sort((a, b) => a.right / a.total - b.right / b.total).slice(0, 3),
    suggested: { id: 'lt-r5', title: 'Original practice: Reading 5', skill: 'reading', label: 'True / False / Not Given', count: 6 },
    tfng: { pattern: tfngPattern([...tfRows, { kind: 'tfng', chose: 'FALSE', answer: 'NOT GIVEN' }, { kind: 'tfng', chose: 'FALSE', answer: 'NOT GIVEN' }]), rows: tfRows.length + 2 },
  };
  fx['/api/lr/spelling'] = { items: [
    { word: 'weight', kind: 'spelling', count: 2, typed: ['wieght', 'wait'], lastAt: day(1) },
    { word: 'sediment', kind: 'spelling', count: 3, typed: ['sedement', 'sedimant'], lastAt: day(2) },
    { word: 'accommodation', kind: 'spelling', count: 2, typed: ['accomodation'], lastAt: day(6) },
    { word: 'beetles', kind: 'spelling', count: 1, typed: ['beatles'], lastAt: day(1) },
    { word: 'suits', kind: 'plural', count: 1, typed: ['suit'], lastAt: day(1) },
  ] };
  // Mutations are answered by "METHOD path" keys (DemoURLProtocol): start/resume returns the attempt, submit the scored one.
  fx['POST /api/lr/tests/lt-l1/attempts'] = lraL;
  fx['POST /api/lr/tests/lt-l2/attempts'] = lraP2; // Start new, Part 2 only (the single-part video)
  fx['POST /api/lr/tests/lt-r1/attempts'] = lraR;
  fx['POST /api/lr/tests/lt-r2/attempts'] = lraR;
  fx['POST /api/lr/tests/lt-r5/attempts'] = lraR;
  fx['POST /api/lr/attempts/lra-r/submit'] = lraRs;
  fx['POST /api/lr/attempts/lra-l/submit'] = lraLs;
  fx['POST /api/lr/attempts/lra-le/submit'] = lraLs;
  for (const id of ['lra-r', 'lra-l', 'lra-le', 'lra-p2']) fx[`PUT /api/lr/attempts/${id}`] = { savedAt: day(0) };
}

writeFileSync(out, JSON.stringify(fx));
console.log(`wrote ${Object.keys(fx).length} fixtures (${(JSON.stringify(fx).length / 1024).toFixed(0)} KB) → ${out}`);
console.log(`speaking P2: ${p2.words.length} words, ${p2.dur}s; P1: ${p1.words.length} words, ${p1.dur}s; essay ${essayWords} words`);
