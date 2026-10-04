#!/usr/bin/env node
// Demo data for the Android video tour (`--ez tour true`, see core/Demo.kt): one fictional student, Nusrat Jahan, who moves from band 6.0 to 7.0
// in speaking and writing over three weeks (13 Sep to 3 Oct 2026). Layered over the shared demo fixtures (apps/ios/IELTS/Demo/fixtures.json, only
// read here) at run time, so keys here win. Our own prompts and answers only: no Cambridge material, no model calls.
// Run: node apps/android/scripts/gen-tour-fixtures.mjs   → apps/android/app/src/main/assets/tour-fixtures.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../app/src/main/assets/tour-fixtures.json');
const base = JSON.parse(readFileSync(join(here, '../../ios/IELTS/Demo/fixtures.json'), 'utf8'));
/** `d` days before Sat 3 Oct 2026 (the demo clock), at hh:mm UTC (Dhaka is UTC+6). */
const day = (d, h = 11, m = 30) => new Date(Date.UTC(2026, 9, 3 - d, h, m)).toISOString();
const half = (x) => { const f = x - Math.floor(x); return Math.floor(x) + (f < 0.25 ? 0 : f < 0.75 ? 0.5 : 1); }; // IELTS rounding (core roundBand)
const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

const settings = { ...base['/api/me'].settings, targetBand: 7 };
const me = { user: { id: 'nusrat', email: 'nusrat.jahan@example.com', name: 'Nusrat Jahan', emailVerified: true, isAnonymous: false }, settings, cambridgeAccess: false, gptLiveAvailable: true, geminiLiveAvailable: true };

// ---------------------------------------------------------------- prompts (our own bank)
const p = (o) => ({ variant: null, type: null, topic: null, bullets: null, followUps: null, chart: null, imageUrl: null, groupId: null, done: false, source: 'generated', audio: null, ...o });
const tts = (id) => `https://demo.ielts.local/tts/${id}.mp3`; // placeholder: demo mode has no audio engine, the examiner "speaks" for the length of the line
const voiced = (o) => ({ ...o, audio: { intro: null, lead: o.lead ? { text: o.lead, url: tts(`${o.id}-lead`) } : null, questions: (o.followUps ?? [o.title]).map((text, i) => ({ text, url: tts(`${o.id}-q${i + 1}`) })) }, lead: undefined });
const sp = (part, id, topic, title, extra) => voiced(p({ id, skill: 'speaking', part, topic, title, type: part === 1 ? 'p1-topic' : part === 2 ? 'cue-card' : 'p3-discussion', ...extra }));

const spWeekends = sp(1, 'sp-weekends', 'Weekends', 'Weekends', { body: "Let's talk about your weekends.", lead: "Now, let's talk about weekends.", done: true,
  followUps: ['What do you usually do at the weekend?', 'Do you prefer to spend your weekends with family or with friends?', 'Did you do different things at the weekend when you were a child?', 'Would you like to have a longer weekend?'] });
const spSkill = sp(2, 'sp-skill', 'Skills', 'Describe a useful skill you learned outside of school.', { done: true,
  body: 'Describe a useful skill you learned outside of school.\nand explain why this skill is useful to you.', bullets: ['what the skill is', 'who taught it to you', 'how long it took you to learn it'] });
const spLearning = sp(3, 'sp-learning', 'Learning', 'Learning new skills', { body: "Let's discuss learning new skills.", bullets: ['Learning as an adult', 'Skills and technology'],
  followUps: ['Is it harder to learn a new skill as an adult than as a child?', 'Why do some people give up when they are learning something new?', 'Should employers pay for their staff to learn new skills?', 'Which skills will be most useful in twenty years?', 'Can people really learn a practical skill from online videos?', 'Will machines make some human skills unnecessary?'] });
const more = [
  sp(1, 'sp-neighbourhood', 'Neighbourhood', 'Your neighbourhood', { body: "Let's talk about where you live.", done: true, followUps: ['Do you like the area where you live?', 'What is there to do near your home?', 'Has your neighbourhood changed in recent years?'] }),
  sp(1, 'sp-phones', 'Technology', 'Mobile phones', { body: "Let's talk about mobile phones.", done: true, followUps: ['How often do you use your phone?', 'What do you mostly use it for?', 'Could you live without a phone for a week?'] }),
  sp(1, 'sp-music', 'Music', 'Music', { body: "Let's talk about music.", done: true, followUps: ['What kind of music do you enjoy?', 'Do you listen to music while you study?', 'Did you learn a musical instrument as a child?'] }),
  sp(1, 'sp-food', 'Food', 'Food and cooking', { body: "Let's talk about food.", followUps: ['What food do you like to cook?', 'Who does most of the cooking in your family?', 'Do you prefer eating at home or eating out?'] }),
  sp(1, 'sp-weather', 'Weather', 'Weather', { body: "Let's talk about the weather.", followUps: ['What is the weather like where you live?', 'Which season do you like most?', 'Does the weather change your mood?'] }),
  sp(2, 'sp-journey', 'Travel', 'Describe a journey you remember well.', { done: true, body: 'Describe a journey you remember well.\nand explain why you remember it so well.', bullets: ['where you went', 'who you travelled with', 'what happened on the way'] }),
  sp(2, 'sp-teacher', 'Education', 'Describe a teacher who helped you.', { done: true, body: 'Describe a teacher who helped you.\nand explain how this teacher helped you.', bullets: ['who the teacher was', 'what subject they taught', 'what they did for you'] }),
  sp(2, 'sp-place', 'Places', 'Describe a place in your city you like to visit.', { done: true, body: 'Describe a place in your city you like to visit.\nand explain why you like going there.', bullets: ['where it is', 'how often you go there', 'what you do there'] }),
  sp(2, 'sp-meal', 'Food', 'Describe a meal you enjoyed with other people.', { body: 'Describe a meal you enjoyed with other people.\nand explain why you enjoyed it.', bullets: ['where you ate', 'who you were with', 'what you ate'] }),
  sp(2, 'sp-mind', 'Decisions', 'Describe a time you changed your mind.', { body: 'Describe a time you changed your mind.\nand explain why you changed it.', bullets: ['what the decision was', 'what you thought at first', 'what made you change your mind'] }),
  sp(3, 'sp-transport', 'Transport', 'Transport in cities', { body: "Let's discuss transport in cities.", done: true, bullets: ['Getting around', 'The future of transport'], followUps: ['Why do so many people still drive to work?', 'How could cities make public transport more attractive?'] }),
  sp(3, 'sp-education', 'Education', 'Education and teachers', { body: "Let's discuss education.", done: true, bullets: ['Good teachers', 'Learning online'], followUps: ['What makes a good teacher?', 'Will online classes replace classrooms?'] }),
  sp(3, 'sp-foodculture', 'Food', 'Food and culture', { body: "Let's discuss food and culture.", bullets: ['Traditional food', 'Fast food'], followUps: ['Why do people still cook traditional dishes?', 'Is fast food changing family life?'] }),
];

const wGap = p({ id: 'w-gap', skill: 'writing', part: 2, type: 'adv-disadv', topic: 'Education', title: 'Gap years', done: true,
  body: 'In many countries, school leavers are encouraged to take a year off to work or travel before they start university. Do the advantages of this outweigh the disadvantages?' });
const wRemote = p({ id: 'w-remote', skill: 'writing', part: 2, type: 'opinion', topic: 'Work', title: 'Working from home', done: true,
  body: 'More and more people now work from home for at least part of the week. Is this a positive or a negative development?' });
const wFast = p({ id: 'w-fastfood', skill: 'writing', part: 2, type: 'problem-solution', topic: 'Health', title: 'Fast food and health', done: true,
  body: 'Fast food is becoming more popular among teenagers. What problems does this cause, and what can be done about them?' });
const wLibraries = p({ id: 'w-libraries', skill: 'writing', part: 2, type: 'opinion', topic: 'Society', title: 'Public libraries',
  body: 'Some people think public libraries are no longer needed because information is available online. To what extent do you agree or disagree?' });
const wInternet = p({ id: 'w-internet', skill: 'writing', part: 1, variant: 'academic', type: 'line', topic: 'Technology', title: 'Internet use by age group', done: true,
  body: 'The graph below shows the percentage of adults in one country who used the internet every day, by age group, between 2008 and 2023. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  chart: { kind: 'line', title: 'Daily internet users (% of age group)', xLabel: 'Year', yLabel: '%', unit: '%', categories: ['2008', '2013', '2018', '2023'],
    series: [{ name: '16-34', values: [58, 79, 92, 97] }, { name: '35-54', values: [34, 60, 81, 90] }, { name: '55+', values: [12, 27, 49, 68] }] } });
const wLetter = p({ id: 'w-letter', skill: 'writing', part: 1, variant: 'general', type: 'letter-formal', topic: 'Housing', title: 'A problem with your flat', done: true,
  body: 'The heating in your rented flat has not worked for two weeks. Write a letter to your landlord. In your letter:', bullets: ['describe the problem', 'explain how it is affecting you', 'say what you would like the landlord to do'] });
const wEnergy = { ...base['/api/prompts/w1p'], id: 'w-energy', audio: null };
const wRain = { ...base['/api/prompts/w1pr'], id: 'w-rain', audio: null };
const prompts = [spWeekends, ...more.slice(0, 5), spSkill, ...more.slice(5, 10), spLearning, ...more.slice(10), wInternet, wEnergy, wRain, wLetter, wGap, wRemote, wFast, wLibraries];

// ---------------------------------------------------------------- speaking answers
/**
 * Word timings from a script: words by spaces; "." ends a sentence (0.55 s), "," is a short breath; "#1.3" is a 1.3 s pause inside a clause,
 * "##1.2" one between clauses (both listed as pauses). Unclear words: { word: conf }.
 */
function speak(script, unclear = {}) {
  let t = 0.5;
  const words = [], pauses = [];
  for (const tok of script.split(' ')) {
    if (tok === '.') { t += 0.55; continue; }
    if (tok === ',') { t += 0.22; continue; }
    const m = tok.match(/^(##?)([\d.]+)$/);
    if (m) {
      const d = +m[2], s = words.at(-1).end;
      pauses.push({ start: s, end: +(s + d).toFixed(2), dur: d, kind: m[1] === '#' ? 'within' : 'between', midClause: m[1] === '#', voiced: false });
      t = s + d;
      continue;
    }
    const filler = tok === 'um' || tok === 'uh';
    const d = filler ? 0.38 : 0.15 + Math.min(tok.length, 10) * 0.034;
    words.push({ w: tok, start: +t.toFixed(2), end: +(t + d).toFixed(2), conf: unclear[tok] ?? 0.97 });
    t += d + (filler ? 0.28 : 0.06);
  }
  return { words, pauses, dur: +(t + 0.6).toFixed(1) };
}
/** Index of the [n]-th (0-based) occurrence of the word sequence [phrase]. */
const find = (words, phrase, n = 0) => {
  const ws = phrase.split(' ');
  let seen = 0;
  for (let i = 0; i + ws.length <= words.length; i++) if (ws.every((w, j) => words[i + j].w === w) && seen++ === n) return i;
  throw new Error(`not in transcript: ${phrase}`);
};
const crit = (band, descriptor, summary, evidence) => ({ band, range: [band - 0.5, band + 0.5], descriptor, evidence, summary });
const serr = (words, id, category, severity, phrase, original, correction, explanation) => {
  const i = find(words, phrase);
  return { id, category, severity, start: i, end: i + phrase.split(' ').length - 1, original, correction, explanation, time: words[i].start };
};

function speechMetrics(words, pauses, dur, extra) {
  const fillers = words.filter((w) => w.w === 'um' || w.w === 'uh').map((w) => ({ word: w.w, time: w.start, kind: 'lexical' }));
  const speaking = dur - pauses.reduce((s, x) => s + x.dur, 0);
  const wpmSeries = Array.from({ length: Math.floor(dur / 5) }, (_, i) => ({ t: (i + 1) * 5, wpm: [128, 141, 133, 119, 146, 138, 152, 131, 127, 144, 136, 149, 124, 139, 142, 130][i % 16] }));
  const rate = (n) => ({ n, perMin: +((n / dur) * 60).toFixed(1), per100w: +((n / words.length) * 100).toFixed(1) });
  return {
    durationS: dur, wordCount: words.length, speechRate: Math.round((words.length / dur) * 60), articulationRate: Math.round((words.length / speaking) * 60),
    phonationRatio: +(speaking / dur - 0.08).toFixed(2), pauseRatio: +(1 - speaking / dur + 0.04).toFixed(2), mlr: +(words.length / (pauses.length + 6)).toFixed(1),
    pauses, longPauses: pauses.filter((x) => x.dur >= 1).length, midClausePauses: pauses.filter((x) => x.midClause).length,
    fillers, fillersPerMin: +((fillers.length / dur) * 60).toFixed(1),
    repetitions: extra.repetitions, selfCorrections: extra.selfCorrections, unclear: extra.unclear, wpmSeries, wpmStdDev: 9.6,
    fluency: {
      events: [...fillers.map((f) => ({ kind: 'filled', start: f.time, end: +(f.time + 0.38).toFixed(2), sources: ['stt'] })), ...extra.events].sort((a, b) => a.start - b.start),
      profile: { byKind: { filled: rate(fillers.length), repetition: rate(extra.repetitions.length), repair: rate(extra.selfCorrections.length), false_start: rate(0) } },
    },
  };
}

// Part 2: a useful skill (swimming). Band 7: fluent and natural, three filled pauses, one restart, one repeat, small article / tense / collocation slips.
const s2 = speak("I'd like to talk about swimming , which I learned when I was nineteen , so quite late actually . Growing up in Dhaka I never had chance to learn because uh there was no pool near our house , and my parents were a bit #1.3 nervous about the river . ##1.1 Then in my first year at university a friend told me about a women-only session at the sports complex , and I thought , why not . The coach was a retired national swimmer and she was um incredibly patient with us . For the first two weeks I I couldn't even put my face in the water , I was that scared . What helped was she broke every I mean she divided the whole thing into small steps , first breathing , then floating , then kicking with a board . ##1.2 It took me about three months before I could swim one full length without stopping . I think it's useful for me because uh it's a good way to make exercise , but more than that it taught me that I can learn something difficult as an adult if I'm patient with myself . ##1.4 Now I am going every Saturday morning , and last summer I even helped my younger cousin to learn .", { breathing: 0.61, length: 0.68 });
{
  const W = s2.words, at = (ph) => W[find(W, ph)].start;
  var s2Analysis = {
    skill: 'speaking', part: 2, overall: 7, overallRaw: 6.875, range: [6.5, 7.5], calibrated: true,
    criteria: {
      fc: crit(7, 'Speaks at length without noticeable effort; some hesitation and self-correction.', 'You kept going for the whole talk and told the story in a clear order: no pool, the first lessons, the coach\'s method, and what it taught you. Three filled pauses and one restart are the only breaks in the flow.', ['"What helped was she broke every I mean she divided the whole thing"', 'pause of 1.3 s before "nervous"']),
      lr: crit(7, 'Uses vocabulary flexibly, with some less common items and collocations.', 'Precise, natural phrases such as "incredibly patient", "small steps" and "one full length". One collocation slip: "make exercise".', ['"a retired national swimmer"', '"one full length without stopping"']),
      gra: crit(6.5, 'A mix of simple and complex structures; frequent error-free sentences.', 'Good control of "What helped was…" and "It took me… before I could…". Small article and tense slips appear in simpler sentences.', ['"It took me about three months before I could swim one full length"', '"I never had chance to learn"']),
      p: crit(7, 'Easy to understand throughout; some sounds are less clear.', 'Word stress and intonation are natural. "breathing" and "length" lost their "th" sounds.', [`"breathing" at ${at('breathing').toFixed(1)} s`, `"length" at ${at('length').toFixed(1)} s`]),
    },
    topFixes: [
      { title: 'Swap filled pauses for a silent breath', why: 'Three "uh/um" in two minutes is fine at band 7, but a short silent pause sounds more controlled.', before: 'because uh there was no pool near our house', after: 'because — there was no pool near our house' },
      { title: 'Use the present simple for routines', why: 'Habits take the present simple; "I am going" sounds temporary.', before: 'Now I am going every Saturday morning', after: 'Now I go every Saturday morning' },
      { title: 'Practise the "th" sounds', why: '"breathing" and "length" sounded like "breeding" and "lenk".', before: 'first breathing, then floating', after: 'first breathing (tongue between the teeth), then floating' },
    ],
    errors: [
      serr(W, 'e1', 'grammar.article', 'minor', 'had chance', 'I never had chance to learn', 'I never had the chance to learn', '"Chance" needs "the" in "have the chance to do something".'),
      serr(W, 'e2', 'vocabulary.collocation', 'minor', 'make exercise', "it's a good way to make exercise", "it's a good way to get exercise", 'We "get" or "do" exercise; "make exercise" is not natural English.'),
      serr(W, 'e3', 'grammar.verb-tense', 'minor', 'am going', 'Now I am going every Saturday morning', 'Now I go every Saturday morning', 'Use the present simple for a regular habit.'),
    ],
    vocabUpgrades: [
      { original: 'a good way to make exercise', better: ['a great way to keep fit', 'good exercise'], note: '"Make exercise" is not natural English.' },
      { original: 'incredibly patient', better: ['endlessly patient', 'had the patience of a saint'], note: 'An idiomatic option for band 8.' },
    ],
    rewrite: { text: "I'd like to talk about swimming, which I only learned at nineteen. Growing up in Dhaka, I never had the chance, partly because there was no pool nearby and partly because my parents were wary of the river. In my first year at university, a friend mentioned a women-only session at the sports complex, so I decided to give it a go. The coach, a retired national swimmer, was endlessly patient. For the first fortnight I couldn't even put my face in the water, but she broke everything down into manageable steps: breathing, then floating, then kicking with a board. Three months later I swam my first full length without stopping. It keeps me fit, but more importantly, it showed me that I can master something difficult as an adult as long as I'm patient with myself. These days I swim every Saturday morning, and last summer I even taught my younger cousin.", note: 'Same story, no fillers, and the habit in the present simple.' },
    words: W,
    metrics: speechMetrics(W, s2.pauses, s2.dur, {
      repetitions: [{ phrase: 'I', time: W[find(W, 'I I') + 1].start, wordIdx: find(W, 'I I') + 1 }],
      selfCorrections: [{ time: at('mean'), wordIdx: find(W, 'mean') }],
      unclear: [{ wordIdx: find(W, 'breathing'), w: 'breathing', conf: 0.61, tier: 2 }, { wordIdx: find(W, 'length'), w: 'length', conf: 0.68, tier: 1 }],
      events: [
        { kind: 'repetition', start: W[find(W, 'I I')].start, end: W[find(W, 'I I') + 1].end, sources: ['asr', 'llm'] },
        { kind: 'repair', start: at('every I mean'), end: W[find(W, 'mean')].end, sources: ['asr', 'llm'] },
        { kind: 'filled', start: +(at('Then') - 0.6).toFixed(2), end: +(at('Then') - 0.25).toFixed(2), sources: ['acoustic'] },
      ],
    }),
    questions: [{ text: spSkill.title, startWord: 0 }],
    pronunciation: { unclear: [], llm: { words: [
      { word: 'breathing', time: at('breathing'), issue: 'The "th" was said as /d/.', tip: 'Put your tongue between your teeth: BREE-thing.' },
      { word: 'length', time: at('length'), issue: 'Final /θ/ dropped.', tip: 'Finish with a soft "th": lengkth.' },
    ], prosody: 'Natural rhythm and clear sentence stress; your voice rises nicely through the list of steps.', band: 7 } },
    relevance: [{ questionIdx: 0, onTopic: true, note: 'Covers all three cue-card points and explains why the skill is useful.' }],
    noSpeech: false,
  };
}

// Part 1: weekends, two questions answered (Friday and Saturday are the weekend in Bangladesh).
const s1 = speak("Well , on Fridays I usually um sleep a bit later and then we have a big family lunch after the prayers . On Saturdays I meet my friends for coffee in Dhanmondi , or I try to catch up my reading for the week . ##1.6 Honestly I prefer to spend it with family , because during the week I hardly see them . My friends I can uh see anytime at university , but that Friday lunch is kind of #1.1 special for us .");
{
  const W = s1.words;
  var s1Analysis = {
    skill: 'speaking', part: 1, overall: 7, overallRaw: 6.875, range: [6.5, 7.5], calibrated: true,
    criteria: {
      fc: crit(7, 'Speaks at length without noticeable effort.', 'Both answers are extended with a reason and a detail, and you move between them smoothly.', ['"Honestly I prefer to spend it with family, because during the week I hardly see them"']),
      lr: crit(7, 'Flexible vocabulary with natural collocations.', '"Catch up", "hardly see them" and "kind of special" sound natural and conversational.', ['"I hardly see them"']),
      gra: crit(6.5, 'Mix of simple and complex structures; a few slips.', 'Linked sentences with "because" and "but". One missing preposition.', ['"I try to catch up my reading"']),
      p: crit(7, 'Easy to understand throughout.', 'Clear, with good stress on key words.', ['"Dhanmondi"']),
    },
    topFixes: [{ title: 'Keep the preposition in phrasal verbs', why: '"Catch up on" something; without "on" it means something else.', before: 'I try to catch up my reading', after: 'I try to catch up on my reading' }],
    errors: [serr(W, 'e1', 'grammar.preposition', 'minor', 'catch up', 'I try to catch up my reading', 'I try to catch up on my reading', '"Catch up on something": the preposition is needed.')],
    vocabUpgrades: [{ original: 'kind of special', better: ['a real highlight', 'something we all look forward to'], note: 'More precise than "kind of".' }],
    rewrite: { text: 'On Fridays I usually have a lie-in, and then the whole family gets together for a big lunch after prayers. On Saturdays I meet friends for coffee in Dhanmondi or catch up on my reading for the week.', note: 'Fewer fillers and a more idiomatic "have a lie-in".' },
    words: W,
    metrics: speechMetrics(W, s1.pauses, s1.dur, { repetitions: [], selfCorrections: [], unclear: [], events: [] }),
    questions: [{ text: spWeekends.followUps[0], startWord: 0 }, { text: spWeekends.followUps[1], startWord: find(W, 'Honestly') }],
    pronunciation: { unclear: [], llm: { words: [], prosody: 'Clear and natural.', band: 7 } },
    relevance: [{ questionIdx: 0, onTopic: true, note: 'Answers the question directly.' }, { questionIdx: 1, onTopic: true, note: 'Gives a clear preference and a reason.' }],
    noSpeech: false,
  };
}

// ---------------------------------------------------------------- writing answers (Task 2, gap years)
const essay = `These days, a growing number of young people take a year out between finishing school and starting university, usually to work or to travel. Although this break can delay a student's education, I believe the benefits are greater than the drawbacks.

The main advantage of a gap year is that it gives young people experience of real life. Working in a shop or a restaurant teaches responsibility, time management and how to deal with different kind of people. Travelling abroad, on the other hand, broadens their horizons and makes them more independent, because they have to solve problems without their parents' help. As a result, many students return with a clearer idea of what they want to study, so they are less likely to change course or drop out later.

However, there are some disadvantages that should be considered. Firstly, a year without studying may cause students to lose their academic habits, and some of them find it difficult to return to classes. Secondly, travelling is expensive, so only students from wealthy families can afford a gap year abroad, which seem unfair. There is also a risk that a student who starts a well-paid job decides never to go to university at all.

In my view, these problems can be avoided with careful planning. Students can set a clear goal for the year, such as saving money for tuition or doing volunteer work related to their future degree, and universities can offer a deferred place so that the student know they have somewhere to return to.

In conclusion, while a gap year has some risks, I am convinced that its advantages outweigh its disadvantages, as long as it is used purposefully.`;

const essayBefore = `Nowadays many young people take a gap year after school. They work or travel before they go to university. In my opinion this has more advantages than disadvantages.

First, a gap year give students experience of life. If they work in a shop they learn responsibility and how to talk with different kind of people. If they travel to other countries they become more independent because their parents are not there. Also they can think about what they really want to study, so they will not change their subject later. For example, my cousin worked in a café for one year and now she is more confident. It is also good for their CV.

On the other hand there are some disadvantages. Students can forget how to study and it is difficult for them to go back to the classes. Also travelling is very expensive and not every family have enough money for it. This is not fair for poor students. Some students find a job and earn money and then they never go to university, this is a big problem for their future.

But I think these problems can be solved. Students should make a plan for the year, for example save money for university or do a volunteer work. Universities can also keep a place for the student so they can come back after one year.

In conclusion, a gap year has some problems but I think the advantages are more than the disadvantages if the students use the year in a good way.`;

const rewrite = `A growing number of young people now take a year out between leaving school and starting university, typically to work or travel. Although this pause can delay their education, I would argue that its benefits clearly outweigh its drawbacks.

The chief advantage of a gap year is the practical experience it provides. Working in a shop or a restaurant teaches responsibility, time management and how to deal with many different kinds of people. Travelling abroad, meanwhile, broadens young people's horizons and fosters independence, since they must solve problems without their parents' help. As a result, many return with a far clearer sense of what they want to study, making them less likely to switch courses or drop out later.

There are, admittedly, drawbacks to consider. A year away from formal study may erode students' study habits, and some struggle to readjust to the classroom. Travel is also expensive, so a gap year abroad is often an option only for students from wealthy families, which seems unfair. There is also a risk that a student who finds a well-paid job decides never to go to university at all.

In my view, however, these risks can largely be avoided through careful planning. Students can set a clear goal for the year, such as saving for tuition fees or volunteering in a field related to their future degree, while universities can offer deferred places so that students know they have somewhere to return to.

In conclusion, although a gap year carries some risks, I am convinced that its advantages outweigh its disadvantages, provided the year is used purposefully.`;

const werr = (text, id, category, severity, s, correction, explanation) => { const i = text.indexOf(s); if (i < 0) throw new Error(`not in essay: ${s}`); return { id, category, severity, start: i, end: i + s.length, original: s, correction, explanation, time: null }; };
const metricsOf = (text, extra) => ({ words: text.split(/\s+/).filter(Boolean).length, sentences: text.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, paragraphs: text.split(/\n\n/).length, ...extra });
const aw1Analysis = {
  skill: 'writing', part: 2, overall: 7, overallRaw: 6.875, range: [6.5, 7.5], calibrated: true,
  criteria: {
    ta: crit(7, 'Addresses all parts of the task; a clear position throughout.', 'Both sides are weighed and your view is clear from the first paragraph to the last. The solution paragraph turns the essay into a balanced argument.', ['"I believe the benefits are greater than the drawbacks"', '"these problems can be avoided with careful planning"']),
    cc: crit(7, 'Logical progression; a range of cohesive devices, with some misuse.', 'Each paragraph has one clear job. One linker signals a contrast where you are adding a point.', ['"As a result, many students return with a clearer idea"', '"Travelling abroad, on the other hand, broadens their horizons"']),
    lr: crit(7, 'A range of less common vocabulary with awareness of style and collocation.', 'Strong phrases such as "broadens their horizons", "drop out" and "a deferred place".', ['"broadens their horizons"', '"offer a deferred place"']),
    gra: crit(6.5, 'A mix of complex structures; errors are noticeable but rarely confuse.', 'Complex sentences are frequent and mostly accurate. Two agreement slips and one plural error.', ['"which seem unfair"', '"the student know they have somewhere to return to"']),
  },
  topFixes: [
    { title: 'Check agreement after "which" and singular nouns', why: 'Both slips cost Grammatical Range and Accuracy marks.', before: 'which seem unfair', after: 'which seems unfair' },
    { title: 'Match the linker to the logic', why: '"On the other hand" introduces a contrast, but travelling is another benefit.', before: 'Travelling abroad, on the other hand, broadens their horizons', after: 'Travelling abroad, meanwhile, broadens their horizons' },
    { title: 'Back each benefit with a concrete example', why: 'A specific example extends ideas fully, which band 8 Task Response needs.', before: 'teaches responsibility, time management', after: 'teaches responsibility: turning up for a 7 am shift, for example' },
  ],
  errors: [
    werr(essay, 'w1', 'grammar.agreement', 'major', 'which seem unfair', 'which seems unfair', '"Which" refers to the whole situation, so the verb is singular.'),
    werr(essay, 'w2', 'grammar.agreement', 'major', 'the student know', 'the student knows', '"The student" is singular: add -s to the verb.'),
    werr(essay, 'w3', 'grammar.plural', 'minor', 'different kind of people', 'different kinds of people', 'After "different", the noun is plural: "kinds of".'),
    werr(essay, 'w4', 'cohesion.linking', 'minor', 'on the other hand', 'meanwhile', '"On the other hand" signals a contrast, but this sentence adds a second benefit.'),
    werr(essay, 'w5', 'vocabulary.collocation', 'minor', 'lose their academic habits', 'lose their study habits', '"Study habits" is the usual collocation.'),
  ],
  vocabUpgrades: [{ original: 'the benefits are greater than the drawbacks', better: ['the benefits outweigh the drawbacks'], note: 'More concise and more academic.' }, { original: 'makes them more independent', better: ['fosters independence'], note: 'A less common verb for band 8.' }],
  rewrite: { text: rewrite, note: 'Same argument and paragraphing: agreement fixed, a more precise linker and a few less common verbs. Study what changed; don\'t memorise it.' },
  text: essay,
  structure: {
    paragraphs: [
      { role: 'intro', topicSentence: 'These days, a growing number of young people take a year out between finishing school and starting university…', ok: true, note: 'Paraphrases the question and gives a clear position.' },
      { role: 'body', topicSentence: 'The main advantage of a gap year is that it gives young people experience of real life.', ok: true, note: 'Two benefits, each with a result.' },
      { role: 'body', topicSentence: 'However, there are some disadvantages that should be considered.', ok: true, note: 'Three drawbacks, fairly presented.' },
      { role: 'body', topicSentence: 'In my view, these problems can be avoided with careful planning.', ok: true, note: 'Answers the drawbacks; a specific example would make it stronger.' },
      { role: 'conclusion', topicSentence: 'In conclusion, while a gap year has some risks, I am convinced…', ok: true, note: 'Restates the position with a condition.' },
    ],
    overview: null, position: { clear: true, consistent: true, note: 'Clear in the introduction and repeated in the conclusion.' }, planFollowed: { followed: true, note: 'Matches the plan you wrote.' },
  },
  textMetrics: metricsOf(essay, { avgSentenceLen: 21.4, mtld: 84.1, ttr: 0.61,
    linkers: [{ word: 'however', count: 1, overused: false }, { word: 'as a result', count: 1, overused: false }, { word: 'firstly', count: 1, overused: false }, { word: 'secondly', count: 1, overused: false }],
    repeated: [{ word: 'students', count: 6, forms: ['student', 'students'] }] }),
  tooShort: false,
  comparison: { parentAttemptId: 'aw0', parentOverall: 6, deltas: { ta: 1, cc: 1, lr: 1, gra: 0.5 } },
};
const aw0Analysis = {
  ...aw1Analysis, overall: 6, overallRaw: 5.875, range: [5.5, 6.5],
  criteria: { ta: crit(6, 'Addresses the task; ideas are not always extended.', 'A clear position, but each point is stated rather than developed.', []), cc: crit(6, 'Cohesion is used but can be mechanical.', 'Paragraphs are clear; linkers repeat ("Also" three times).', []), lr: crit(6, 'An adequate range for the task.', 'Mostly everyday vocabulary.', []), gra: crit(5.5, 'Mix of simple and complex forms; frequent errors.', 'Several agreement errors and a comma splice.', []) },
  errors: [
    werr(essayBefore, 'v1', 'grammar.agreement', 'major', 'a gap year give', 'a gap year gives', 'Singular subject: "gives".'),
    werr(essayBefore, 'v2', 'grammar.agreement', 'major', 'not every family have', 'not every family has', '"Every family" is singular.'),
    werr(essayBefore, 'v3', 'grammar.article', 'minor', 'do a volunteer work', 'do volunteer work', '"Work" is uncountable here.'),
  ],
  text: essayBefore, textMetrics: metricsOf(essayBefore, { avgSentenceLen: 14.2, mtld: 58.3, ttr: 0.49, linkers: [{ word: 'also', count: 3, overused: true }], repeated: [{ word: 'students', count: 5, forms: ['student', 'students'] }] }),
  rewrite: { text: '', note: '' }, comparison: null, structure: { ...aw1Analysis.structure, paragraphs: aw1Analysis.structure.paragraphs.map((x) => ({ ...x, ok: x.role !== 'body', note: x.role === 'body' ? 'Ideas are listed rather than explained.' : x.note })) },
};

const attempt = (id, prompt, analysis, d, extra = {}) => ({ id, promptId: prompt.id, skill: prompt.skill, part: prompt.part, mode: 'practice', sessionId: null, parentAttemptId: null, audioUrl: null, text: null, plan: null, durationMs: null, overtime: false, status: 'done', error: null, createdAt: day(d), analysis, prompt, ...extra });

// ---------------------------------------------------------------- three weeks of attempts: speaking 6.0 → 7.0, writing 6.0 → 7.0
const S = (fc, lr, gra, p) => ({ fc, lr, gra, p });
const T = (ta, cc, lr, gra) => ({ ta, cc, lr, gra });
const titleOf = Object.fromEntries(prompts.map((x) => [x.id, x.title]));
const history = [
  ['s-1', 'sp-neighbourhood', 'speaking', 1, 20, S(6, 6, 5.5, 6)], ['aw0', 'w-gap', 'writing', 2, 19, T(6, 6, 6, 5.5)],
  ['s-2', 'sp-journey', 'speaking', 2, 18, S(5.5, 6, 6, 6)], ['w-2', 'w-internet', 'writing', 1, 17, T(6, 6, 6, 6)],
  ['s-3', 'sp-transport', 'speaking', 3, 16, S(6, 6.5, 5.5, 6)], ['s-4', 'sp-phones', 'speaking', 1, 14, S(6.5, 6.5, 6, 6.5)],
  ['w-3', 'w-remote', 'writing', 2, 13, T(6.5, 6.5, 6.5, 6)], ['s-5', 'sp-teacher', 'speaking', 2, 12, S(6, 6.5, 6, 5.5)],
  ['s-6', 'sp-education', 'speaking', 3, 10, S(6.5, 6.5, 6, 6.5)], ['w-4', 'w-letter', 'writing', 1, 9, T(6.5, 6.5, 6.5, 6)],
  ['s-7', 'sp-music', 'speaking', 1, 7, S(6.5, 7, 6.5, 6)], ['w-5', 'w-fastfood', 'writing', 2, 5, T(7, 6.5, 6.5, 6)],
  ['s-8', 'sp-place', 'speaking', 2, 4, S(7, 7, 6.5, 6.5)], ['as2', 'sp-weekends', 'speaking', 1, 2, S(7, 7, 6.5, 7)],
  ['aw1', 'w-gap', 'writing', 2, 1, T(7, 7, 7, 6.5)], ['as1', 'sp-skill', 'speaking', 2, 0, S(7, 7, 6.5, 7)],
].map(([id, promptId, skill, part, d, criteria]) => ({ id, promptId, skill, part, d, criteria, overall: half(avg(Object.values(criteria))) }));
const trendRows = (skill) => history.filter((h) => !skill || h.skill === skill).map((h) => ({ attemptId: h.id, date: day(h.d), skill: h.skill, part: h.part, overall: h.overall, criteria: h.criteria }));
const progress = (skill) => {
  const rows = trendRows(skill), sums = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.criteria)) (sums[k] ??= []).push(v);
  const weakest = Object.entries(sums).map(([key, v]) => ({ key, avg: Math.round(avg(v) * 100) / 100 })).reduce((w, x) => (!w || x.avg < w.avg ? x : w), null);
  const last5 = (s) => half(avg(history.filter((h) => h.skill === s).slice(-5).map((h) => h.overall)));
  return {
    trend: rows, streak: 12, minutesThisWeek: 164, attempts: rows.length, weakest,
    topMistakes: [{ category: 'grammar.article', count: 11 }, { category: 'grammar.agreement', count: 8 }, { category: 'grammar.verb-tense', count: 6 }, { category: 'vocabulary.collocation', count: 5 }, { category: 'cohesion.linking', count: 3 }].slice(0, skill === 'writing' ? 4 : 5),
    predicted: { speaking: last5('speaking'), writing: last5('writing') }, lastFailed: null,
  };
};
const listItem = (h) => ({ id: h.id, promptTitle: titleOf[h.promptId], skill: h.skill, part: h.part, mode: 'practice', status: 'done', overall: h.overall, createdAt: day(h.d) });
const newest = [...history].reverse().map(listItem);
const page = (items) => ({ items, total: items.length });

const fx = {
  '/api/me': me,
  '/api/progress': progress(), '/api/progress?skill=speaking': progress('speaking'), '/api/progress?skill=writing': progress('writing'),
  '/api/attempts': page(newest), '/api/attempts?page=1': page(newest),
  '/api/attempts?skill=speaking': page(newest.filter((a) => a.skill === 'speaking')), '/api/attempts?skill=writing': page(newest.filter((a) => a.skill === 'writing')),
  '/api/attempts?page=1&skill=speaking': page(newest.filter((a) => a.skill === 'speaking')), '/api/attempts?page=1&skill=writing': page(newest.filter((a) => a.skill === 'writing')),
  '/api/attempts/as1': attempt('as1', spSkill, s2Analysis, 0, { durationMs: Math.round(s2.dur * 1000) }),
  '/api/attempts/as2': attempt('as2', spWeekends, s1Analysis, 2, { durationMs: Math.round(s1.dur * 1000) }),
  '/api/attempts/aw1': attempt('aw1', wGap, aw1Analysis, 1, { text: essay, parentAttemptId: 'aw0', durationMs: 38 * 60000 }),
  '/api/attempts/aw0': attempt('aw0', wGap, aw0Analysis, 19, { text: essayBefore, durationMs: 40 * 60000 }),
  // Review: a Listening spelling card first (its "Hear the word" button), then a mistake, a word and a fix.
  '/api/cards/due': { items: [
    { id: 'c1', front: "🎧 Listening · spell the word you heard: 'acco_____tion' (13 letters)", back: 'accommodation\nYou wrote: accomodation', source: 'mistake', ease: 2.3, interval: 2, reps: 2 },
    { id: 'c2', front: 'I never had chance to learn', back: 'I never had the chance to learn: "have the chance to do something".', source: 'mistake', ease: 2.5, interval: 4, reps: 3 },
    { id: 'c3', front: 'broaden your horizons', back: 'to learn about new things and see more of the world: "Travelling abroad broadens your horizons."', source: 'vocab', ease: 2.6, interval: 6, reps: 3 },
    { id: 'c4', front: 'Use the present simple for routines\n\nNow I am going every Saturday morning', back: 'Now I go every Saturday morning\n\nHabits take the present simple.', source: 'fix', ease: 2.5, interval: 1, reps: 1 },
  ], total: 9, deck: 46 },
  '/api/mistakes': {
    groups: [{ category: 'grammar.article', count: 11 }, { category: 'grammar.agreement', count: 8 }, { category: 'grammar.verb-tense', count: 6 }, { category: 'vocabulary.collocation', count: 5 }, { category: 'cohesion.linking', count: 3 }],
    items: [
      ['as1', 'speaking', 2, spSkill.title, 'grammar.article', 'I never had chance to learn', 'I never had the chance to learn', '"Chance" needs "the" in "have the chance to do something".', s2Analysis.errors[0].time, true, 0],
      ['as1', 'speaking', 2, spSkill.title, 'vocabulary.collocation', "it's a good way to make exercise", "it's a good way to get exercise", 'We "get" or "do" exercise.', s2Analysis.errors[1].time, false, 0],
      ['as1', 'speaking', 2, spSkill.title, 'grammar.verb-tense', 'Now I am going every Saturday morning', 'Now I go every Saturday morning', 'Use the present simple for a regular habit.', s2Analysis.errors[2].time, false, 0],
      ['aw1', 'writing', 2, wGap.title, 'grammar.agreement', 'which seem unfair', 'which seems unfair', '"Which" refers to the whole situation, so the verb is singular.', null, false, 1],
      ['aw1', 'writing', 2, wGap.title, 'grammar.agreement', 'the student know', 'the student knows', '"The student" is singular.', null, false, 1],
      ['aw1', 'writing', 2, wGap.title, 'cohesion.linking', 'Travelling abroad, on the other hand, broadens their horizons', 'Travelling abroad, meanwhile, broadens their horizons', '"On the other hand" signals a contrast.', null, false, 1],
      ['as2', 'speaking', 1, spWeekends.title, 'grammar.preposition', 'I try to catch up my reading', 'I try to catch up on my reading', '"Catch up on something".', s1Analysis.errors[0].time, false, 2],
    ].map(([attemptId, skill, part, promptTitle, category, original, correction, explanation, time, inDeck, d], i) => ({ id: `m${i}`, attemptId, skill, part, promptTitle, category, original, correction, explanation, time, inDeck, createdAt: day(d) })),
    total: 7,
  },
  '/api/prompts': { items: prompts, total: prompts.length, page: 1, pageSize: 30 },
  '/api/prompts?page=1': { items: prompts, total: prompts.length, page: 1, pageSize: 30 },
  '/api/prompts?page=1&skill=speaking': { items: prompts.filter((x) => x.skill === 'speaking'), total: prompts.filter((x) => x.skill === 'speaking').length, page: 1, pageSize: 30 },
  '/api/prompts?page=1&skill=writing': { items: prompts.filter((x) => x.skill === 'writing'), total: prompts.filter((x) => x.skill === 'writing').length, page: 1, pageSize: 30 },
  '/api/prompts/meta': { groups: [1, 2, 3].map((part) => ({ skill: 'speaking', part, topics: [...new Set(prompts.filter((x) => x.skill === 'speaking' && x.part === part).map((x) => x.topic))], types: [part === 1 ? 'p1-topic' : part === 2 ? 'cue-card' : 'p3-discussion'] }))
    .concat([1, 2].map((part) => ({ skill: 'writing', part, topics: [...new Set(prompts.filter((x) => x.skill === 'writing' && x.part === part).map((x) => x.topic))], types: [...new Set(prompts.filter((x) => x.skill === 'writing' && x.part === part).map((x) => x.type))] }))) },
  '/api/prompts/random?part=1&skill=speaking': spWeekends,
  '/api/prompts/random?part=2&skill=speaking': spSkill,
  '/api/prompts/random?part=3&skill=speaking': spLearning,
  '/api/prompts/random?part=2&skill=writing': wGap,
  '/api/prompts/random?part=1&skill=writing&variant=academic': wInternet,
  '/api/prompts/random?part=1&skill=writing&variant=general': wLetter,
  '/api/speaking/test': { part1: [spWeekends], part2: spSkill, part3: spLearning },
};
// The bank's search: typing "food" with Speaking picked.
for (const q of ['f', 'fo', 'foo', 'food']) {
  const hits = prompts.filter((x) => x.skill === 'speaking' && [x.title, x.body, ...(x.followUps ?? [])].join(' ').toLowerCase().includes(q));
  fx[`/api/prompts?page=1&q=${q}&skill=speaking`] = { items: hits, total: hits.length, page: 1, pageSize: 30 };
}
for (const x of prompts) fx[`/api/prompts/${x.id}`] = x;

// ---------------------------------------------------------------- Listening & Reading: the shared original tests, retitled, no Cambridge rows
{
  const retitle = (a, title) => ({ ...a, test: { ...a.test, title } });
  const L1 = 'Original practice · Listening 1', R1 = 'Original practice · Reading 1';
  const lraL = { ...retitle(base['/api/lr/attempts/lra-l'], L1), responses: { 1: 'Whitlock', 2: 'Thursday', 3: '6.30' }, elapsedS: 95, startedAt: day(0, 10) };
  // "Start new", Practice, Part 2 only: the server keeps just that section.
  const lraL2 = { ...lraL, id: 'lra-l2', parts: [2], responses: {}, elapsedS: 0, test: { ...lraL.test, sections: lraL.test.sections.filter((s) => s.part === 2) } };
  const lraLs = { ...retitle(base['/api/lr/attempts/lra-ls'], L1), startedAt: day(3, 9), submittedAt: day(3, 10) };
  const lraRs = { ...retitle(base['/api/lr/attempts/lra-rs'], R1), startedAt: day(6, 9), submittedAt: day(6, 10) };
  const lraR = { ...retitle(base['/api/lr/attempts/lra-r'], R1), startedAt: day(1, 14) };
  const item = (id, skill, n, o = {}) => ({ id, slug: `original-${skill}-${n}`, skill, variant: 'academic', source: 'generated', ref: `Original ${skill[0].toUpperCase()}${n}`, title: `Original practice · ${skill === 'listening' ? 'Listening' : 'Reading'} ${n}`, total: 40, status: 'new', attemptId: null, mode: null, answered: 0, bestBand: null, attempts: 0, ...o });
  fx['/api/lr/tests?skill=listening'] = { items: [
    item('lt-l1', 'listening', 1, { status: 'in_progress', attemptId: 'lra-l', mode: 'practice', answered: 3, bestBand: lraLs.band, attempts: 1 }),
    item('lt-l2', 'listening', 2, { status: 'submitted', bestBand: 6, attempts: 1 }), item('lt-l3', 'listening', 3, { status: 'submitted', bestBand: 5.5, attempts: 1 }),
    item('lt-l4', 'listening', 4), item('lt-l5', 'listening', 5), item('lt-l6', 'listening', 6),
  ] };
  fx['/api/lr/tests?skill=reading'] = { items: [
    item('lt-r1', 'reading', 1, { status: 'in_progress', attemptId: 'lra-r', mode: 'exam', answered: 16, bestBand: lraRs.band, attempts: 1 }),
    item('lt-r2', 'reading', 2, { variant: 'general' }), item('lt-r3', 'reading', 3, { status: 'submitted', bestBand: 6, attempts: 1 }),
    item('lt-r4', 'reading', 4, { status: 'submitted', bestBand: 5.5, attempts: 1 }), item('lt-r5', 'reading', 5),
  ] };
  const lrItem = (a, skill) => ({ id: a.id, testId: a.testId, skill, variant: 'academic', ref: a.test.ref ?? '', title: a.test.title, mode: a.mode, parts: a.parts ?? null, status: a.status, raw: a.raw, total: a.total, band: a.band, answered: Object.keys(a.responses).length, startedAt: a.startedAt, submittedAt: a.submittedAt });
  fx['/api/lr/attempts'] = { items: [lrItem(lraL, 'listening'), lrItem(lraR, 'reading'), lrItem(lraLs, 'listening'), lrItem(lraRs, 'reading')] };
  for (const a of [lraL, lraL2, lraLs, lraRs, lraR]) fx[`/api/lr/attempts/${a.id}`] = a;
  fx['POST /api/lr/tests/lt-l1/attempts'] = lraL2;
  fx['PUT /api/lr/attempts/lra-l2'] = { savedAt: day(0) };
  const lrp = base['/api/lr/progress'];
  fx['/api/lr/progress'] = { ...lrp,
    trend: [['listening', 18, 5.5], ['listening', 11, 5.5], ['listening', 7, 6], ['listening', 3, lraLs.band], ['reading', 16, 5.5], ['reading', 12, 5.5], ['reading', 6, lraRs.band]].map(([skill, d, band], i) => ({ attemptId: `lt-${i}`, skill, date: day(d), band })),
    suggested: { ...lrp.suggested, id: 'lt-r2', title: 'Original practice · Reading 2' } };
}

writeFileSync(out, JSON.stringify(fx));
const sw = s2.words.length;
console.log(`wrote ${Object.keys(fx).length} fixtures (${(JSON.stringify(fx).length / 1024).toFixed(0)} KB) → ${out}`);
console.log(`speaking P2: ${sw} words, ${s2.dur} s; essay ${aw1Analysis.textMetrics.words} words (before ${aw0Analysis.textMetrics.words}); predicted`, fx['/api/progress'].predicted, 'weakest', fx['/api/progress'].weakest);
