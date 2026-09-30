import { computeSpeechMetrics, PAUSE_MS, roundBand, speakingOverall, type SpeechMetrics, type Word } from '@ielts/core';
import type { Settings } from '../settings';
import { bandDescriptor, EXAMINER_RULES, fmt, SPEAKING_DESCRIPTORS } from './descriptors';
import { chatJson, transcribe } from './openrouter';
import { keepVerbatimEvidence, poolCriteria, PronLlmSchema, settleRanges, SpeakingLlmSchema, SpeakingScoreSchema, withScoringSamples } from './schemas';
import type { AnalysisResult, PronunciationLlm } from './types';

export const REWRITE_NOTE = "Study the upgrades, don't memorise — examiners penalise rehearsed answers.";
const r1 = (x: number) => Math.round(x * 10) / 10;

const PART_CONTEXT: Record<1 | 2 | 3, string> = {
  1: 'Part 1 (interview on familiar topics): answers are naturally short (2-4 sentences, ~15-40 s). Do not penalise brevity alone, but one-word or yes/no answers show no extension and cannot evidence long turns.',
  2: 'Part 2 (long turn from a cue card, target 1-2 minutes): must be a sustained, organised monologue covering the card points. Under ~60 s means the candidate could not keep going; judge FC accordingly.',
  3: 'Part 3 (abstract discussion): answers should be extended (~30-60 s), giving opinions, reasons, comparisons, speculation. Evaluate ability to handle abstract ideas, not just personal experience.',
};

const SYSTEM = `You are a senior IELTS Speaking examiner and trainer of examiners. You rate against the official public band descriptors with best-fit marking, the way a certified examiner would in the live test. Your ratings are used for self-study: inflated or deflated scores both mislead the candidate, so accuracy beats encouragement.

INPUT: the test part, the examiner questions, an ASR transcript with word indices "[i]word" (question boundaries marked "Q<n>:"), deterministic timing metrics, ASR low-confidence ("unclear") words, and optionally an audio-model pronunciation report.

HOW TO READ THE EVIDENCE:
- The transcript is machine-generated: ignore punctuation and capitalisation, never flag spelling. Whisper deletes most "um/uh" and may "repair" mispronounced words from context, so the metrics are the primary fluency evidence, not the text's apparent smoothness.
- The metrics are for you, not the candidate: never copy metric keys or raw numbers into evidence; evidence must be verbatim transcript quotes, and metric observations go in "summary" in plain English ("You spoke for about 40 seconds").
- Fluency heuristics (research-based, not official; fillers are already excluded from word counts and end a run): speech rate < ~100 wpm or MLR < ~5 words suggests slow, fragmented speech (band 5 features); ~120-160 wpm with MLR >= 8-10, few mid-clause pauses and < ~5 fillers/min is consistent with band 7. Pauses at clause boundaries are normal; long (>= 1 s) and mid-clause pauses signal language search. "Voiced" fillers are filled pauses Whisper dropped. Repetitions and self-corrections are repair phenomena. A fast rate does not compensate for fragmented, incoherent content.
- Pronunciation: you cannot hear the audio. Base P on the pronunciation report if given (weight it heavily), plus unclear-word density, rhythm evidence (pause placement, rate) and ASR artefacts (nonsense or wrong words in otherwise sensible sentences often mean mispronunciation). Without an audio report, keep P conservative (never above 7) and use a range at least one band wide. Do not flag accent itself; only what reduces intelligibility.
- Words flagged as unclear or obvious ASR artefacts are NOT lexical/grammar errors; if relevant, log them as "pronunciation.word".
- Grammar is judged on sentences as spoken: count how many are error-free and how many are complex (subordinate/relative clauses, conditionals, passives, perfect aspects), and how accurate the complex ones are.
- Very short samples cannot demonstrate range: with few words, cap LR and GRA where range cannot be shown.
- Off-topic or evidently memorised/rehearsed chunks do not count as evidence of ability; note them in relevance. An off-topic answer lowers FC through coherence and relevance (fluent but off-topic connected speech is typically FC 4-5), never to 0; LR, GRA and P are still rated on the language produced. Band 0 in speaking is only for no rateable language at all.
- "lexical" metrics (MTLD and type-token ratio = diversity; lessCommonPct = share of words outside the 5,000 most common spoken forms; overused = repeated content words) support LR range judgements; precision, collocation and paraphrase come from the transcript.
- "spokenFormsDifferingFromTranscript" (when present): words the audio model heard differently from the transcript. Both recognisers repair grammar far more often than they invent errors, so when they disagree assume the non-standard form is what the candidate said, and count it as GRA/LR evidence (spoken "she help me" is an error even though the transcript says "helped"; transcript "he say" is an error even if the audio model heard "said"). Log such an error with "original" as the non-standard form (e.g. "she help"), start/end on the transcript words.
- "audioDisfluencies" (when present) are filled pauses, repetitions and false starts an audio model heard that the transcript may have deleted: treat them as fluency evidence alongside the metrics.

OUTPUT RULES:
- errors: "start"/"end" are inclusive word indices from the transcript; "original" is exactly those words. Keep spans tight (the minimal words containing the error). Use "fluency.hesitation" only for a specific breakdown (a false start, abandoned sentence) and "pronunciation.word" only for words the evidence says were unclear.
- relevance: exactly one entry per question (questionIdx is 0-based: Q1 → 0), onTopic false if the answer does not address it; note says briefly how well it was answered.
- rewrite: spoken register (contractions and natural discourse markers are fine), keep the part's natural length, keep the same question order, no headings.

${EXAMINER_RULES}

OFFICIAL SPEAKING BAND DESCRIPTORS (condensed, May 2023):
Fluency and Coherence (fc):
${fmt(SPEAKING_DESCRIPTORS.fc)}
Lexical Resource (lr):
${fmt(SPEAKING_DESCRIPTORS.lr)}
Grammatical Range and Accuracy (gra):
${fmt(SPEAKING_DESCRIPTORS.gra)}
Pronunciation (p):
${fmt(SPEAKING_DESCRIPTORS.p)}`;

const PRON_SYSTEM = `You are an IELTS Speaking examiner rating Pronunciation only, from the audio. You receive the audio and its ASR transcript with word start times in seconds.
- List up to 20 words that were actually pronounced differently from their dictionary form or were hard to understand, with the word's start time from the transcript, the issue ("sound" = wrong phoneme, "stress" = wrong word stress, "intonation" = unnatural pitch pattern, "unclear" = mumbled/unintelligible), "heard" (what was actually said, e.g. "de-ve-LOP"), "expected" (the dictionary form, e.g. "de-VEL-op") and a short, practical tip. Only list a word when heard differs from expected: never list a correctly pronounced word to restate its stress.
- "expected" is the dictionary pronunciation of the SAME word form the speaker said. Never list tense, plural or article differences in "words" (those go in "misheard").
- "misheard": every word where the audio differs from the transcript. The ASR tends to repair grammar ("she help me" transcribed "she helped me", "two year" as "two years", a dropped "a" restored). Report inflections (tense, plural and third-person -s) and articles exactly as spoken, with the transcript word's start time.
- Do not list accent features that do not reduce intelligibility. Native-like, clear speech lists 0-2 words and scores band 8-9.
- "disfluencies": start times (s) of every filled pause (um, uh, er, erm) you hear, of every repetition (a word or phrase said twice in a row, e.g. "he... he") and of every false start (a sentence abandoned or restarted), whether or not the transcript shows them.
- "prosody": 2-3 sentences on rhythm, stress-timing, chunking, intonation and connected speech.
- "band": the IELTS Pronunciation band (whole number), rated strictly:
${fmt(SPEAKING_DESCRIPTORS.p)}`;

/** transcript as "[0]I [1]like …" with "Q<n>:" headers at question boundaries */
function indexedTranscript(words: Word[], questions: { text: string; startWord: number }[]) {
  const heads: string[] = [];
  questions.forEach((q, n) => q.startWord >= 0 && (heads[q.startWord] = `${heads[q.startWord] ?? ''}\nQ${n + 1}: ${q.text}\n`));
  return words.map((w, i) => `${heads[i] ?? ''}[${i}]${w.w}`).join(' ').trim();
}

function metricsSummary(m: SpeechMetrics, words: Word[], pron?: PronunciationLlm) {
  const nextWord = (t: number) => words.findIndex((w) => w.start >= t - 1e-6);
  const d = pron?.disfluencies;
  const filled = Math.max(m.fillers.length, d?.filledPauses.length ?? 0);
  return {
    durationS: r1(m.durationS),
    wordCount: m.wordCount,
    speechRateWpm: Math.round(m.speechRate),
    articulationRateWpm: Math.round(m.articulationRate),
    meanLengthOfRunWords: r1(m.mlr),
    pauseRatio: r1(m.pauseRatio * 100) / 100,
    pauses: m.pauses.length,
    longPauses: m.longPauses,
    midClausePauses: m.midClausePauses,
    // Both sources under-count (Whisper deletes "um"s, the audio model misses some): the larger is the better estimate.
    fillersPerMin: r1(filled / (Math.max(m.durationS, 1) / 60)),
    fillers: { lexical: m.fillers.filter((f) => f.kind === 'lexical').length, voiced: m.fillers.filter((f) => f.kind === 'voiced').length, total: filled },
    repetitions: m.repetitions.length,
    selfCorrections: m.selfCorrections.length,
    wpmStdDev: Math.round(m.wpmStdDev),
    longPauseBeforeWord: m.pauses.filter((p) => p.kind === 'long').map((p) => ({ word: nextWord(p.end), s: r1(p.dur), midClause: p.midClause })),
    lexical: m.lexical && { ...m.lexical, overused: m.lexical.overused.map((o) => `${o.word} ×${o.count}`) },
    ...(d && {
      audioDisfluencies: {
        filledPauses: d.filledPauses.length,
        filledPausesPerMin: r1(d.filledPauses.length / (Math.max(m.durationS, 1) / 60)),
        repetitions: d.repetitions.length,
        falseStarts: d.falseStarts.length,
      },
    }),
  };
}

const toks = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);

/** LLM word spans drift: re-anchors an error on the occurrence of its `original` words nearest its start (or nearest time `t`, in seconds). Null when not in the transcript. */
export function anchorSpan(words: Word[], e: { start: number; original: string }, t?: number) {
  const key = (w: string) => toks(w).join(''); // "well-known" stays one word on both sides
  const norm = words.map((w) => key(w.w));
  const want = e.original.split(/\s+/).map(key).filter(Boolean);
  const dist = (s: number) => (t == null ? Math.abs(s - e.start) : Math.abs(words[s]!.start - t));
  let best = -1;
  for (let s = 0; want.length && s <= words.length - want.length; s++)
    if (want.every((w, k) => norm[s + k] === w) && (best < 0 || dist(s) < dist(best))) best = s;
  return best < 0 ? null : { start: best, end: best + want.length - 1 };
}

const SOUND_EVENT = /^[*[(].*[*\])][.,!?]*$/;
/** Whisper's usual output for silence or noise. */
const HALLUCINATION = /\b(thanks for watching|thank you|you)\b/g;
/** Fewer than 3 real words or under 2 s of speech: silence, noise or a bad mic, not an answer. `words` has sound events already removed. */
export function isNoSpeech(words: Word[]) {
  const lexical = toks(words.map((w) => w.w).join(' ').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(HALLUCINATION, ' '));
  return lexical.length < 3 || words.reduce((s, w) => s + w.end - w.start, 0) < 2;
}

/** Drops pronunciation entries whose "heard" is just the dictionary form (e.g. the model restating correct stress), or, for sound issues, just the
 *  transcript word ("say", expected "said" is grammar, not pronunciation). Capitals mark stress, so case only counts for stress issues. */
const realMispronunciations = <T extends { word: string; issue: string; heard: string; expected: string }>(words: T[]) => {
  const key = (s: string, stress: boolean) => (stress ? s : s.toLowerCase()).replace(/[^\p{L}]/gu, '');
  return words.filter((w) => {
    const stress = w.issue === 'stress', heard = key(w.heard, stress);
    return heard !== key(w.expected, stress) && (stress || heard !== key(w.word, false));
  });
};

/** Whisper fills pauses with "you" / "Thank you": drops such a phrase when it is shaky (confidence < 0.3 or zero length) and next to a pause. */
export function dropHallucinations(words: Word[]) {
  const drop = new Set<number>();
  const norm = words.map((w) => toks(w.w).join(' '));
  const gap = (a: number, b: number) => (a < 0 || b >= words.length ? Infinity : words[b]!.start - words[a]!.end);
  for (let i = 0; i < words.length; i++)
    for (const phrase of [['thanks', 'for', 'watching'], ['thank', 'you'], ['you']]) {
      const j = i + phrase.length;
      if (!phrase.every((p, k) => norm[i + k] === p)) continue;
      const run = words.slice(i, j);
      const shaky = run.some((w) => (w.conf ?? 1) < 0.3 || w.end - w.start < 0.01);
      if (shaky && Math.max(gap(i - 1, i), gap(j - 1, j)) * 1000 >= PAUSE_MS) for (let k = i; k < j; k++) drop.add(k);
      break;
    }
  return words.filter((_, i) => !drop.has(i));
}

/** Maps question start marks (ms into the recording) to the first word spoken after each. */
export function questionBoundaries(questions: string[], words: Word[], marks?: number[] | null) {
  return questions.map((text, i) => {
    const mark = marks?.[i] ?? (i === 0 ? 0 : undefined);
    const startWord = mark == null ? -1 : words.findIndex((w) => w.end > mark / 1000);
    return { text, startWord };
  });
}

export async function analyzeSpeaking(i: {
  audio: Uint8Array;
  format: 'webm' | 'm4a' | 'wav' | 'mp3' | 'ogg';
  durationMs: number;
  energy?: number[] | null;
  marks?: number[] | null;
  questions: string[];
  part: 1 | 2 | 3;
  settings: Settings;
}): Promise<AnalysisResult> {
  const { models } = i.settings;
  const stt = await transcribe({ model: models.stt, audio: i.audio, format: i.format });
  const words = dropHallucinations(stt.words.filter((w) => !SOUND_EVENT.test(w.w))); // "*Ding*", "[music]", "(coughs)"
  const questions = questionBoundaries(i.questions, words, i.marks);
  const noSpeech = (): AnalysisResult => ({
    v: 1, skill: 'speaking', part: i.part, overall: 0, overallRaw: 0, range: [0, 0], criteria: {}, topFixes: [], errors: [], vocabUpgrades: [],
    rewrite: { text: '', note: 'No speech detected. Check your microphone and speak clearly, then try again.' },
    words, questions, noSpeech: true,
  });
  if (isNoSpeech(words)) return noSpeech();

  const durationS = i.durationMs > 0 ? i.durationMs / 1000 : stt.duration;
  const metrics = computeSpeechMetrics(words, { durationS, energy: i.energy ?? undefined, frameMs: 50 });

  let pron: PronunciationLlm | undefined;
  if (i.settings.audioPronEnabled) {
    try {
      const p = await chatJson({
        model: models.audioPron,
        system: PRON_SYSTEM,
        user: [
          { type: 'text', text: `Transcript (word@startSeconds):\n${words.map((w) => `${w.w}@${r1(w.start)}`).join(' ')}` },
          { type: 'input_audio', input_audio: { data: Buffer.from(i.audio).toString('base64'), format: i.format } },
        ],
        schema: PronLlmSchema,
        schemaName: 'pronunciation',
      });
      pron = { ...p, words: realMispronunciations(p.words) };
    } catch (e) {
      console.error('pronunciation pass failed, continuing without it', e);
    }
  }

  const misheard = (pron?.misheard ?? []).filter((m) => toks(m.transcript).join(' ') !== toks(m.spoken).join(' '));
  const base = {
    model: models.analysis,
    system: SYSTEM,
    temperature: 0.2,
    effort: 'low' as const,
    user: JSON.stringify({
      part: i.part,
      partContext: PART_CONTEXT[i.part],
      questions: i.questions,
      transcript: indexedTranscript(words, questions),
      metrics: metricsSummary(metrics, words, pron),
      unclearWords: metrics.unclear.map((u) => ({ i: u.wordIdx, w: u.w, conf: Math.round(u.conf * 100) / 100 })),
      pronunciationReport: pron ? { ...pron, misheard: undefined } : 'none (no audio-based pronunciation evidence; be conservative on P)',
      spokenFormsDifferingFromTranscript: misheard.length ? misheard.map((m) => ({ i: anchorSpan(words, { start: 0, original: m.transcript }, m.time)?.start, transcript: m.transcript, spoken: m.spoken })) : undefined,
    }),
  };
  const llm = await withScoringSamples(
    () => chatJson({ ...base, schema: SpeakingLlmSchema, schemaName: 'speaking_analysis' }),
    () => chatJson({ ...base, schema: SpeakingScoreSchema, schemaName: 'speaking_scores' }),
  );

  const c = poolCriteria(llm.samples, undefined, (key, band) => bandDescriptor(SPEAKING_DESCRIPTORS[key], band));
  if (Object.values(c).every((x) => x.band === 0)) return noSpeech(); // the examiner found nothing rateable
  keepVerbatimEvidence(c, words.map((w) => w.w).join(' '));
  const { raw, band } = speakingOverall({ fc: c.fc.band, lr: c.lr.band, gra: c.gra.band, p: c.p.band });
  const range = settleRanges(c, (b) => roundBand((b.fc + b.lr + b.gra + b.p) / 4));
  // Pronunciation errors anchor on the audio report's time for that word; the rest on the nearest occurrence of their words. Unfindable errors are dropped.
  const pronTime = (o: string) => pron?.words.find((w) => toks(w.word).join(' ') === toks(o).join(' '))?.time;
  // An error quoting a spoken form the transcript repaired ("she help") anchors on the transcript words ("she helped") at the misheard time.
  const asTranscribed = (o: string) => {
    const m = misheard.find((m) => toks(o).includes(toks(m.spoken).join(' ')));
    return m && { original: toks(o).map((w) => (w === toks(m.spoken).join(' ') ? m.transcript : w)).join(' '), time: m.time };
  };
  const errors = llm.errors.flatMap((e) => {
    // A "correction" that is the same words says nothing ("Two" -> "two", "helped me" -> "helped me").
    if (toks(e.original).join(' ') === toks(e.correction).join(' ')) return [];
    const start = Math.min(e.start, e.end), alt = asTranscribed(e.original);
    const span = anchorSpan(words, { ...e, start }, e.category === 'pronunciation.word' ? pronTime(e.original) : undefined) ?? (alt && anchorSpan(words, { start, original: alt.original }, alt.time));
    return span ? [{ ...e, ...span, time: words[span.start]!.start }] : [];
  }).map((e, k) => ({ ...e, id: `e${k}` }));

  return {
    v: 1, skill: 'speaking', part: i.part, overall: band, overallRaw: raw, range, criteria: c, topFixes: llm.topFixes, errors,
    vocabUpgrades: llm.vocabUpgrades, rewrite: { text: llm.rewrite, note: REWRITE_NOTE },
    words, metrics, questions, pronunciation: { unclear: metrics.unclear, ...(pron && { llm: pron }) }, relevance: llm.relevance,
  };
}
