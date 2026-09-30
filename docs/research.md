# IELTS AI Practice App: Research Notes

Sources: official descriptors, Speaking ([PDF](https://ielts.org/cdn/ielts-guides/ielts-speaking-band-descriptors.pdf)) and Writing, rev. May 2023 ([PDF](https://ielts.org/cdn/Guides/ielts-writing-band-descriptors.pdf)); scoring ([ielts.org](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail)).

## 1. Band descriptors: what separates the bands

### Speaking
| Band | Fluency & Coherence | Lexical Resource | Grammar (GRA) | Pronunciation |
|---|---|---|---|---|
| 8 | Only very occasional repetition/self-correction; hesitation mostly *content-related* | Wide, flexible; *skilful* less common + idiomatic items; occasional collocation slips; effective paraphrase | Wide range; **majority of sentences error-free**; occasional non-systematic errors | Sustained rhythm, flexible stress/intonation over long turns; easily understood; accent minimal effect |
| 7 | Long turns without noticeable effort; some mid-sentence hesitation/self-correction (language search) that does **not** hurt coherence; **flexible** discourse markers | *Some* less common/idiomatic items; awareness of style & collocation; effective paraphrase | Range flexibly used; **error-free sentences frequent**; simple + complex used effectively; a few basic errors persist | All of 6 + some of 8 |
| 6 | Willing to produce long turns; coherence *sometimes lost* through hesitation/repetition/self-correction; markers used "not always appropriately" | Enough to discuss topics at length; inappropriate word choice but meaning clear; paraphrase generally OK | Mix of short + complex forms, limited flexibility; **frequent errors in complex structures** that rarely impede | Range of features, variable control; rhythm affected by lack of stress-timing or fast rate; occasional mispronounced words |
| 5 | Keeps going via repetition, self-correction, **slow speech**; mid-sentence searches for *basic* lexis; **overuse** of certain connectives; complex speech → disfluency | Enough for familiar + unfamiliar topics, limited flexibility; paraphrase attempted, often fails | Basic forms fairly controlled; complex attempted, **nearly always with errors**, reformulation | All of 4 + some of 6 |

### Writing (Task 1 = Task Achievement, Task 2 = Task Response; CC/LR/GRA shared)
- **TA/TR 8**: sufficiently addressed; well-developed position; ideas well extended; *occasional* lapses. **7**: all main parts addressed, clear developed position; T1 Academic *clear overview*, data categorised, main trends/differences identified; GT consistent tone, clear purpose; risk: over-generalising. **6**: main parts addressed, some more than others; T1 overview *attempted*, figures support; T2 position relevant but conclusions *unclear/repetitive*, some ideas underdeveloped. **5**: incompletely addressed; T1 detail recounted *mechanically*, no bigger picture/data; T2 position unclear, ideas limited, irrelevant detail.
- **CC 8**: logical sequencing, cohesion well managed, paragraphing skilful. **7**: clear progression; reference/substitution used flexibly with some over/under-use. **6**: cohesion "faulty or mechanical" through misuse/**overuse**/omission; paragraphing not always logical. **5**: not wholly logical, sentences not fluently linked, limited/overused devices, paragraphing inadequate/missing.
- **LR 8**: wide, precise; skilful uncommon/idiomatic items; spelling/word-formation errors rare. **7**: some less common/idiomatic items; awareness of style & collocation; few spelling errors. **6**: adequate; restricted range or imprecise; "risk-taker" = wider but less accurate. **5**: limited; frequent simplification/repetition; noticeable spelling errors.
- **GRA 8**: majority error-free, punctuation well managed. **7**: variety of complex structures; **error-free sentences frequent**. **6**: mix simple/complex, complex less accurate; errors rarely impede. **5**: limited, repetitive range; complex sentences mostly faulty; frequent errors.
- Rules: a script must *fully* fit a band's positive features. Copied rubric is not counted. Responses of 20 words or fewer = Band 1. Under 150/250 words is penalised under TA/TR.

### Rounding
- Criterion scores are whole bands (1-9). Speaking band = mean of 4 criteria. Writing band = (T1 + 2*T2)/3 across the criteria (Task 2 weighted double). ([blog](https://blog.myieltsclassroom.com/how-is-your-overall-ielts-writing-band-score-calculated/))
- Overall = mean of L/R/W/S, rounded to the nearest 0.5. **x.25 rounds up to x.5, and x.75 rounds up to the next whole band** (6.25 → 6.5, 6.75 → 7.0). Anything below .25 rounds down. ([ielts.org](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail))
- Examiners are believed to round the writing section *down* internally (e.g. 6.33 → 6). This is unofficial, so show the raw value next to the rounded one.

## 2. Format and timing
- **Speaking** (11-14 min, 1:1, recorded). **P1** 4-5 min: intro plus ~3 familiar topics (work/study, home, hobbies), short answers. **P2** 3-4 min: cue card ("Describe a…" + 3-4 bullets "you should say…" + "and explain…"), **1 min prep with notes, speak 1-2 min**, examiner stops you at 2 min, then 1-2 follow-up questions. **P3** 4-5 min: abstract discussion linked to P2 topic (compare, speculate, evaluate).
- **Writing** (60 min). **T1** ~20 min, ≥150 words. Academic: line/bar/pie/table/mixed, process diagram, map comparison. GT: letter (formal/semi/informal, 3 bullets). **T2** ~40 min, ≥250 words. Types: opinion (agree/disagree), discussion (both views + opinion), problem/cause-solution, advantages/disadvantages (incl. "outweigh"), two-part/direct question.

## 3. Measurable speech metrics
- **Core utterance-fluency features** (De Jong & Bosker 2013; [Kormos & Dénes 2004](https://www.semanticscholar.org/paper/Choosing-a-threshold-for-silent-pauses-to-measure-Jong-Bosker/38cdf805dcaac32e79f27b19d4f2dfd8877c7486)):
  - *Silent pause* = silence **≥250 ms** (the standard threshold). Flag *long pauses* at **≥1 s**.
  - *Speech rate* = syllables (or words) ÷ total time including pauses.
  - *Articulation rate* = syllables ÷ phonation time only.
  - *Mean length of run (MLR)* = syllables or words between pauses.
  - *Phonation-time ratio*.
  - Filled pauses (um/uh/er) per minute.
  - Repair fluency: repetitions and self-corrections per 100 words.
- **Predictive power**: meta-analysis puts speech rate at r≈.76, MLR ≈.72, pause frequency ≈-.59 against proficiency. A 2026 automated-scoring study ([arXiv 2608.26137](https://arxiv.org/html/2608.26137)) found MLR ρ=.75, pause ratio ρ=-.72, speech rate ρ=.68, long-pause rate ρ=-.58, and **articulation rate ≈ .08 (useless alone)**. Its key finding: LLM fluency scoring from transcripts is coarse, and the signal comes from **measured timing features passed as aggregate stats**. Single human raters reach only ρ≈.62, so that is a realistic ceiling.
- **Speed benchmarks**:
  - Natives speak ~120-260 wpm (conversation 190-230), about 4-5.3 syll/s ([ResearchGate](https://www.researchgate.net/publication/340996472_Speech_Rate_and_Pausing_in_English_Comparing_learners_at_different_levels_of_proficiency_with_native_speakers), [Wikipedia](https://en.wikipedia.org/wiki/Speech_tempo)).
  - The B2→C1 step shows up as higher rate and **fewer mid-clause pauses** (clause-boundary pauses are normal).
  - A heuristic band-7 zone: ~120-160 wpm (~3-4 syll/s) and MLR ≥ 8-10 words. Mid-clause pauses are rare, and filled pauses stay under ~5 per minute. This is an **inference, not an official IELTS standard**, so calibrate it on your own labelled data.
  - Faster is not better: descriptor band 6 penalises a "rapid speech rate" that damages rhythm.
- **Pronunciation proxy**:
  - GOP = forced-alignment posterior of the target phone vs. the best competing phone.
  - Word-level ASR confidence (Whisper token log-prob averaged per word, [whisper-timestamped](https://github.com/linto-ai/whisper-timestamped)) is a cheap proxy.
  - **Limitations**: posteriors are overconfident on L2 speech and forced alignment breaks on mispronunciations ([arXiv 2507.16838](https://arxiv.org/html/2507.16838v1)). Whisper's language model "repairs" words from context, so a mispronounced word can still be transcribed confidently. It also **drops um/uh**, which hides filled pauses and shifts timestamps.
  - Mitigations: prompt for verbatim fillers, or use a disfluency-aware model / wav2vec2 phoneme CTC (e.g. Azure/Speechace pronunciation APIs). Present results as "unclear words", not a precise band.
  - Prosody (stress, intonation, chunking) is in the descriptors but barely covered by GOP.

## 4. Methods that improve scores
- **Focused, immediate corrective feedback**: focused WCF g≈0.69 vs unfocused g≈0.33 ([TESL-EJ](https://tesl-ej.org/wordpress/issues/volume24/ej95/ej95a3/)). So show the top 2-3 error patterns, not 40 red marks.
- **Automated writing evaluation over many sessions**: g≈0.55 overall and 0.72 for L2. More than 2 sessions gives g≈0.66, a single shot g≈0.18 ([Frontiers](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2023.1162454/full)). Retention loops matter.
- **Task repetition**: re-doing the same prompt improves complexity, accuracy and fluency ([SSLA](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/abs/task-repetition-and-second-language-speech-processing/0EA95A4C7D9E90CD2AB30043F84A4635)). This supports "record again" with a delta view.
- **Planning**: pre-task planning raises complexity, and online planning raises accuracy ([Springer](https://sfleducation.springeropen.com/articles/10.1186/s40862-016-0015-6)). Simon's T2 method is 4 paragraphs, ~5-10 min of planning, 13 "sentence jobs" ([ielts-simon](https://ielts-simon.study/ielts-writing-task-2/)).
- **Lexical measures**: MTLD separates band 6 from band 8, while AWL % and mean sentence length separate adjacent bands only weakly ([IJTE](https://i-jte.org/index.php/journal/article/view/660)). Use them as diagnostics, not as score drivers.
- **Also useful** (general SLA/memory evidence):
  - Spaced repetition of collocations from the user's own errors.
  - Shadowing model audio for rhythm and chunking.
  - Personal error logs.
  - Band+1 rewrites of the user's *own* answer, which beat generic model essays.
  - Timed conditions.
  - Detection of overused connectives (Moreover/Furthermore/In addition used as a template), which the band 5-6 CC wording directly penalises.

## 5. Competitors
| App | Loved | Gaps |
|---|---|---|
| [SmallTalk2Me](https://smalltalk2.me/ielts) | Full speaking mock, transcript with highlighted errors, pause/filler metrics, per-criterion band | Generic advice; no longitudinal error tracking |
| [ELSA Speak](https://elsaspeak.com/en) / [Speakometer](https://www.speakometer.net/compare/speakometer-vs-elsa-speak/) | Phoneme-level colour-coded pronunciation, minimal pairs, IPA | Weak on content, coherence and IELTS task structure |
| [Writing9](https://ieltsonlinecourses.net/writing9-review/) | Instant T1/T2 scoring, large essay bank | Scores seen as inflated |
| [UpScore.ai](https://aichief.com/ai-education-tools/upscore-ai/) | Deep criterion analysis + rewrites | Admits ±0.5 typical, up to 1.5 off; mixed reviews |
| [LingoLeap](https://lingoleap.ai/) | Fast scoring, mind-map planning, question bank | "Generate answer" encourages memorisation (penalised) |
| IELTS Liz / Simon | Trusted structure (overview, 13-sentence essay), band-9 models | Static; no personal feedback |

**Common gaps**:
- Score inflation and variance. IELTS itself (2026) judges AI not yet fit to examine ([ieltspeaking.com](https://ieltspeaking.com/guides/ai-ielts-speaking-score-accuracy.html)).
- No confidence ranges on scores.
- Feedback is not tied to the exact descriptor wording.
- No progress tracking of recurring errors.
- Little support for re-attempts or Part 2 → Part 3 flow.

## 6. Prioritised features
1. **Descriptor-anchored rubric scoring** that cites the exact descriptor phrase for each criterion and shows a band *range*. This builds trust and counters inflation.
2. **Deterministic fluency metrics** (speech rate, MLR, 250 ms / 1 s pauses, fillers/min, repairs), passed as stats to the LLM. Research shows timing features carry the fluency signal.
3. **Real exam simulator**: P1 → P2 (60 s prep timer, notes pad, 2 min hard stop) → linked P3, plus timed W1/W2 with a live word count. Timed realism is what transfers to the test.
4. **Top-3 focused fixes per attempt** rather than exhaustive markup. Focused feedback roughly doubles the effect size.
5. **"Try again" loop on the same prompt** with a side-by-side metric delta. Task repetition improves CAF.
6. **Personal error log**: auto-tagged recurring errors (articles, tense, collocation, connective overuse) with trend charts. Enables deliberate practice.
7. **Band+1 rewrite of the user's own answer** with diff highlighting. Shows the gap concretely.
8. **SRS deck built from the user's errors and upgrade suggestions** (collocations, paraphrases). Spacing helps retention.
9. **T1 overview checker** (present? states main trends? no data in it?) and a T2 position/paragraph structure check. Overview and position are hard caps in TA/TR.
10. **Cohesion analyser** that flags overused or mechanical linkers and low reference/substitution. This is the named band 5-6 CC penalty.
11. **Lexical profile** (MTLD, AWL/less-common word %, repetition hotspots) as a diagnostic. It separates band 6 from band 8.
12. **Pronunciation "unclear words"** from ASR confidence/GOP with replay and a shadowing clip. Label it as low-precision.
13. **Planning scaffolds**: T2 idea planner and P2 note template, with no answer generation. Planning improves complexity, while memorised answers are penalised.
14. **Progress dashboard with predicted band per criterion and a streak**. Multi-session use drives the AWE effect.
15. **Prompt bank tagged by essay type and topic**, with weak-area recommendations. Targets practice where it matters.
