import { computeSpeechMetrics, roundBand, speakingOverall, type SpeechMetrics, type Word } from '@ielts/core';
import type { Settings } from '../settings';
import { EXAMINER_RULES, SPEAKING_DESCRIPTORS } from './descriptors';
import { chatJson, transcribe } from './openrouter';
import { keepVerbatimEvidence, PronLlmSchema, settleRanges, SpeakingLlmSchema, SpeakingScoreSchema, withScoringSamples } from './schemas';
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
- Off-topic or evidently memorised/rehearsed chunks do not count as evidence of ability; note them in relevance.

OUTPUT RULES:
- errors: "start"/"end" are inclusive word indices from the transcript; "original" is exactly those words. Keep spans tight (the minimal words containing the error). Use "fluency.hesitation" only for a specific breakdown (a false start, abandoned sentence) and "pronunciation.word" only for words the evidence says were unclear.
- relevance: exactly one entry per question (questionIdx is 0-based: Q1 → 0), onTopic false if the answer does not address it; note says briefly how well it was answered.
- rewrite: spoken register (contractions and natural discourse markers are fine), keep the part's natural length, keep the same question order, no headings.

${EXAMINER_RULES}

OFFICIAL SPEAKING BAND DESCRIPTORS (condensed, May 2023):
Fluency and Coherence (fc):
${SPEAKING_DESCRIPTORS.fc}
Lexical Resource (lr):
${SPEAKING_DESCRIPTORS.lr}
Grammatical Range and Accuracy (gra):
${SPEAKING_DESCRIPTORS.gra}
Pronunciation (p):
${SPEAKING_DESCRIPTORS.p}`;

const PRON_SYSTEM = `You are an IELTS Speaking examiner rating Pronunciation only, from the audio. You receive the audio and its ASR transcript with word start times in seconds.
- List up to 20 words that were actually mispronounced or hard to understand, with the word's start time from the transcript, the issue ("sound" = wrong phoneme, "stress" = wrong word stress, "intonation" = unnatural pitch pattern, "unclear" = mumbled/unintelligible), and a short, practical tip (e.g. "stress the 2nd syllable: de-VEL-op").
- Do not list accent features that do not reduce intelligibility.
- "prosody": 2-3 sentences on rhythm, stress-timing, chunking, intonation and connected speech.
- "band": the IELTS Pronunciation band (whole number), rated strictly:
${SPEAKING_DESCRIPTORS.p}`;

/** transcript as "[0]I [1]like …" with "Q<n>:" headers at question boundaries */
function indexedTranscript(words: Word[], questions: { text: string; startWord: number }[]) {
  const heads: string[] = [];
  questions.forEach((q, n) => q.startWord >= 0 && (heads[q.startWord] = `${heads[q.startWord] ?? ''}\nQ${n + 1}: ${q.text}\n`));
  return words.map((w, i) => `${heads[i] ?? ''}[${i}]${w.w}`).join(' ').trim();
}

function metricsSummary(m: SpeechMetrics, words: Word[]) {
  const nextWord = (t: number) => words.findIndex((w) => w.start >= t - 1e-6);
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
    fillersPerMin: r1(m.fillersPerMin),
    fillers: { lexical: m.fillers.filter((f) => f.kind === 'lexical').length, voiced: m.fillers.filter((f) => f.kind === 'voiced').length },
    repetitions: m.repetitions.length,
    selfCorrections: m.selfCorrections.length,
    wpmStdDev: Math.round(m.wpmStdDev),
    longPauseBeforeWord: m.pauses.filter((p) => p.kind === 'long').map((p) => ({ word: nextWord(p.end), s: r1(p.dur), midClause: p.midClause })),
  };
}

const toks = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);

/** LLM word spans drift by a word or two: re-anchors an error on the nearest occurrence of its `original` words within ±5 of its start. Null when not found. */
export function anchorSpan(words: Word[], e: { start: number; original: string }) {
  const norm = words.map((w) => toks(w.w).join(''));
  const want = toks(e.original);
  let best = -1;
  for (let s = Math.max(0, e.start - 5); want.length && s <= Math.min(words.length - want.length, e.start + 5); s++)
    if (want.every((t, k) => norm[s + k] === t) && (best < 0 || Math.abs(s - e.start) < Math.abs(best - e.start))) best = s;
  return best < 0 ? null : { start: best, end: best + want.length - 1 };
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
  const words = stt.words;
  const questions = questionBoundaries(i.questions, words, i.marks);
  if (!words.length) {
    return {
      v: 1, skill: 'speaking', part: i.part, overall: 0, overallRaw: 0, range: [0, 0], criteria: {}, topFixes: [], errors: [], vocabUpgrades: [],
      rewrite: { text: '', note: 'No speech detected. Check your microphone and speak clearly, then try again.' },
      words: [], questions, noSpeech: true,
    };
  }

  const durationS = i.durationMs > 0 ? i.durationMs / 1000 : stt.duration;
  const metrics = computeSpeechMetrics(words, { durationS, energy: i.energy ?? undefined, frameMs: 50 });

  let pron: PronunciationLlm | undefined;
  if (i.settings.audioPronEnabled) {
    try {
      pron = await chatJson({
        model: models.audioPron,
        system: PRON_SYSTEM,
        user: [
          { type: 'text', text: `Transcript (word@startSeconds):\n${words.map((w) => `${w.w}@${r1(w.start)}`).join(' ')}` },
          { type: 'input_audio', input_audio: { data: Buffer.from(i.audio).toString('base64'), format: i.format } },
        ],
        schema: PronLlmSchema,
        schemaName: 'pronunciation',
      });
    } catch (e) {
      console.error('pronunciation pass failed, continuing without it', e);
    }
  }

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
      metrics: metricsSummary(metrics, words),
      unclearWords: metrics.unclear.map((u) => ({ i: u.wordIdx, w: u.w, conf: Math.round(u.conf * 100) / 100 })),
      pronunciationReport: pron ?? 'none (no audio-based pronunciation evidence; be conservative on P)',
    }),
  };
  const llm = await withScoringSamples(
    () => chatJson({ ...base, schema: SpeakingLlmSchema, schemaName: 'speaking_analysis' }),
    () => chatJson({ ...base, schema: SpeakingScoreSchema, schemaName: 'speaking_scores' }),
  );

  const c = llm.criteria;
  keepVerbatimEvidence(c, words.map((w) => w.w).join(' '));
  const { raw, band } = speakingOverall({ fc: c.fc.band, lr: c.lr.band, gra: c.gra.band, p: c.p.band });
  const range = settleRanges(c, (b) => roundBand((b.fc + b.lr + b.gra + b.p) / 4));
  const last = words.length - 1;
  const errors = llm.errors.map((e, k) => {
    const clampedStart = Math.min(Math.max(0, Math.min(e.start, e.end)), last);
    const { start, end } = anchorSpan(words, { ...e, start: clampedStart }) ?? { start: clampedStart, end: Math.min(Math.max(clampedStart, e.start, e.end), last) };
    return { ...e, id: `e${k}`, start, end, time: words[start]!.start };
  });

  return {
    v: 1, skill: 'speaking', part: i.part, overall: band, overallRaw: raw, range, criteria: c, topFixes: llm.topFixes, errors,
    vocabUpgrades: llm.vocabUpgrades, rewrite: { text: llm.rewrite, note: REWRITE_NOTE },
    words, metrics, questions, pronunciation: { unclear: metrics.unclear, ...(pron && { llm: pron }) }, relevance: llm.relevance,
  };
}
