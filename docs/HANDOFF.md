# Handoff — 2026-10-07

State of the scoring and mistake-analysis work, written so another agent (Codex) can continue. Read `AGENTS.md` first for the project rules.

## 1. Uncommitted work in the tree: Listening/Reading mistake reasons (DONE, tested, not committed)

Every lost Listening/Reading mark now gets a reason, grouped into four "causes" shown on the results Summary tab under **"Why you lost marks"**.

- **`packages/core/src/lr-review.ts`**
  - New `GapKind`s: `lost-place` (the answer belongs to a question within ±3), `wrong-type` (a word where a number was needed, or the reverse), `trap` (the answer appears in the section text but isn't the key; number words and digits both count), `number`, `misheard` (Listening only: a near-miss that is a real common word), and the model-decided kinds `synonym` / `misheard` / `other`.
  - `GAP_COACH` entries can carry a `reading` wording.
  - `CAUSES` and the `FAMILY` map (`slip | trap | missed | blank`). Option picks count as `trap`; TRUE/FALSE/NOT GIVEN mistakes count as `missed`.
  - `classifyGap(given, accepted, wordLimit, ctx?)` applies the new rules only when given a `ctx`.
  - `residualGaps()` lists the answers no rule explains.
  - `analyseAttempt(..., ai?)` returns `causes`.
- **`apps/server/src/ai/openrouter.ts`**: `decideChoice()` calls TypeSafe **Jev** (`typesafe/jev-1.13`, `POST /api/v1/systemone`). It records cost with stage `lr_mistake`.
- **`apps/server/src/ai/lr-mistakes.ts`** (new): `aiGapReasons()` makes one Jev call per residual answer, in parallel. It has a 4 s budget, a confidence floor of 0.65, and never throws. Without a reason, the answer reads "Different detail".
- **`apps/server/src/routes/lr.ts`**: submit calls `aiGapReasons(residualGaps(...))` and passes the result to `analyseAttempt`. The schema gained `causes`, `other`, and `/api/lr/progress.causes`, which totals each cause per skill.
- **Web**:
  - `components/lr/Results.tsx`: "Why you lost marks" (RankedList in count mode, with question-number buttons that open the answer, plus a cross-test trend caption).
  - `ReviewPanels.tsx`: the line "This is the answer to question N".
  - `openapi.json` / `schema.d.ts` were regenerated.
- **Tests:**
  - New cases in `packages/core/src/lr-review.test.ts` and `apps/server/src/routes/lr.test.ts`.
  - Last full run: core 176/176, server 362/362, web all passing (two web tests timed out under load and passed when rerun alone).
  - A live run through the app took 989 ms per submit, at about $0.000018 per Jev call.
- **Mobile:** Android and iOS read `kind`/`label`/`message` as strings, so they show the new reasons already. Only the "Why you lost marks" section is web-only.
- **Leave alone:** `scripts/demo-seed.ts`, `scripts/local-owner.ts` and `apps/web/tsconfig.tsbuildinfo` are the owner's untracked files, not part of this work.
- **Suggested commit:** `feat(lr): explain every lost mark — causes, distractor/lost-place/number rules, Jev reasons for the rest`.

## 2. Research results (no production change; scripts in gitignored `.eval/`)

- **Speaking scoring:** per-criterion (4 criteria × 3 calls) vs one joint call (×3), on 18 local recordings. Script: `apps/server/.eval/ab-speaking.mts`, report: `ab-report.py`.
  - The joint call was 27% cheaper ($0.0027 vs $0.0037 per part) but slower (median 17.8 s vs 13.8 s).
  - It was more repeatable, but gave flatter bands across the four criteria (spread 1.4 vs 2.3).
  - **Decision:** keep per-criterion.
  - The **feedback call is the latency bottleneck** (about 25 s with it live vs about 14 s for scoring alone).
- **Jev for Writing bands:** full report in `.eval/jev/REPORT.md`; code in `apps/server/.eval/jev/`. On the frozen 41-essay TEST split:

  | | RMSE | MAE | Within ±0.5 | Macro-F1 (whole band) | F1 for "reached 7+" |
  |---|---|---|---|---|---|
  | luna | 0.59 | 0.45 | 80% | 0.46 | 0.74 |
  | Jev raw + calibration map | 0.67 | 0.52 | 73% | 0.43 | 0.79 |
  | Jev with luna's evidence | 0.62 | 0.48 | 76% | 0.39 | 0.77 |

  - Jev with no calibration reads about 1 band low; it needs the calibration map (`fitKnotMap`).
  - Jev costs about 1/10–1/20 as much, takes about 1 s, and moves only about 0.03 bands between runs.
  - It can't see Task 1 chart images, and Jev can't be fine-tuned (there are no weight updates).
  - Predictions are dumped in `.eval/jev/test-preds.json`.
- **Jev probes (all worked):**
  - Off-topic per question: P = 0.98 when on topic, 0.02 when off, 0.54 when partly on topic.
  - Part 2 bullet coverage: it caught a skipped "explain why" bullet (0.10).
  - Residual Listening/Reading reasons: 10/12 correct.

## 3. Next tasks, in order

### A. Retry the failed download (`ieltsorg-speaking-12`, band 9; completed on retry)
```bash
cd .eval/speaking-gold-audio && rm -f ieltsorg-speaking-12.wav && \
yt-dlp -x --audio-format wav --postprocessor-args "ffmpeg:-ac 1 -ar 16000" -o "ieltsorg-speaking-12.%(ext)s" -- "https://www.youtube.com/watch?v=PHsQ0Dc0I48"
```
The other 11 WAVs (16 kHz mono, 3–5 min Part 3 excerpts) are in `.eval/speaking-gold-audio/`. Gold IDs map to bands in `data/scoring-gold/scripts.json` (01 = 5, 02 = 5, 03 = 6, 04 = 6, 05 = 6.5, 06 = 7, 07 = 7, 08 = 7.5, 09 = 8, 10 = 8, 11 = 8.5, 12 = 9).

Follow-up corrections: the retry succeeded with `yt-dlp --force-overwrites`; IDs 01 and 05 are **Part 2**, not Part 3. All 12 gold transcripts store speaker labels on a single line, so split on `Examiner:` / candidate-name labels, not newlines. The cached diarized Scribe preparation script is `apps/server/.eval/jev/audio-prepare.mts`; candidate-only WAVs and remapped metadata are in `.eval/jev/audio/`. Total source duration is 3,314.7 s (estimated Scribe cost $0.3683 at $0.40/h).

### B. Speaking gold eval with real audio (the owner's question: does Jev do well when fed the measured fluency data?)

Goal: compare three ways of scoring on the 12 gold recordings:
1. **luna:** the production `analyzeSpeaking`.
2. **Jev + measurements:** Jev answers about the transcript (FC coherence, LR, GRA as `score` questions with the official descriptors), and the **numeric fluency measurements go straight into the calibration step** (knot map or small ridge), not into Jev's input. Jev is weak with numbers.
3. **Jev transcript-only:** already known to read about 1.5 bands low; this is the baseline.

Steps:
1. **Candidate-only speech.**
   - Call ElevenLabs Scribe directly with `diarize=true`, using the same form as `scribe()` in `apps/server/src/ai/openrouter.ts`. Words then carry `speaker_id`.
   - The gold transcript (`scoring_scripts.text`) labels turns `Examiner:` / `<Name>:`. The candidate is the speaker whose words best match the non-Examiner lines.
   - Cut the examiner spans with ffmpeg, or pass candidate windows as `segments` to `analyzeSpeaking` so the gaps count as transitions and not as pauses.
   - Cost: about 1 h of audio, roughly $0.40 on Scribe.
2. **Measurements.**
   - Use the core functions (`alignWords`, `computeSpeechMetrics`, `fluencyFeatures`, `fluencyComposite`, `fluencyBand`, `fuseDisfluencies`, `tagDisfluencies`; see the order in `analyzeSpeaking`).
   - Energy: compute RMS per frame from the WAV (`frameMsOf` gives the frame length).
3. **Questions per part:** use the manifest's `taskFamily`: IDs 01/05 are Part 2, the other ten Part 3. Use the actual preceding diarized examiner turn for each candidate answer window; the gold dialogue is a single line, not separate `Examiner:` lines.
4. **Report:** QWK, MAE, RMSE, within ±0.5, Spearman. With n = 12, results are **descriptive only**. Calibration must be leave-one-out. Write it to `.eval/jev/SPEAKING-AUDIO.md`.
5. **Budget:** luna about $0.02 per recording; Jev negligible. Don't use Anthropic models.

Reproduction for the audio comparison (research-only, no production changes):
```bash
cd apps/server
npx tsx --env-file-if-exists=../../.env .eval/jev/audio-prepare.mts
npx tsx --env-file-if-exists=../../.env .eval/jev/audio-eval.mts --self-test
npx tsx --env-file-if-exists=../../.env .eval/jev/audio-eval.mts --run-paid
```
Preparation and OpenRouter responses are disk-cached. The harness injects cached candidate-only Scribe into the real production scorer, including feedback and all 12 criterion samples; this is production scoring with replayed STT, not a second end-to-end transcription. It matches the recorder's compressed byte energy scale (`255 * sqrt(RMS)`). It reports raw Jev, leave-one-recording-out affine calibration, and matched fixed-lambda ridge arms with/without measured fluency. `fitKnotMap` requires at least 20 scripts, so it cannot be fitted on these 12. Gold bands never enter scorer inputs. Current production has no speaking anchors, caps its pronunciation heuristic at 7, and constrains FC within +/-1 of a provisional fluency band. Report those limits alongside agreement.

**Completed audio eval (2026-10-07):** report `.eval/jev/SPEAKING-AUDIO.md`, detailed results `.eval/jev/audio/audio-eval-results.json`. Windows preserve candidate onset thinking time after examiner speech. Part 2 scores only the sustained main turn with its actual topic; setup/followup excluded. Jev gets the same question/answer grouping and cleaned language as Luna. An interrupted pilot with narrower cuts is archived separately and not included in agreement.

| Method (n=12; descriptive only) | QWK | MAE | RMSE | Within +/-0.5 | Spearman |
|---|---|---|---|---|---|
| Production Luna overall | 0.368 | 1.083 | 1.384 | 33% | 0.842 |
| Jev raw | 0.263 | 1.239 | 1.476 | 25% | 0.739 |
| Luna overall, LOO affine (diagnostic) | 0.682 | 0.712 | 0.868 | 58% | 0.584 |
| Jev transcript, LOO affine | 0.688 | 0.700 | 0.886 | 58% | 0.683 |
| Jev transcript, LOO ridge lambda 10 | 0.431 | 0.841 | 1.007 | 33% | 0.637 |
| Jev + measured fluency, same LOO ridge | 0.472 | 0.816 | 0.999 | 50% | 0.623 |

Conclusion: both raw systems underscored high bands; with the same affine calibration they are descriptively similar. Measured fluency gives only a small MAE gain over its matched ridge baseline, not an established advantage. The measured arm still uses Luna's disfluency pass. Do not deploy a calibrator from n=12; next evidence should come from the larger, source-separated corpus in task G. Final evaluation OpenRouter usage cost $0.0984; all saved responses including pilot $0.1173, plus estimated Scribe $0.3683, about $0.486 total (in-flight interrupted responses might be missing). Jev wall time 0.42-1.06 s, production scoring/feedback 26.8-54.5 s, excluding original STT. Targeted tests passed: speaking 10, OpenRouter 18 (1 optional test skipped), core speech 17 and calibration 23; calibration timeout was rerun with `--testTimeout=30000`. No production changes or commits.

### C. Jev checks per question (the owner wants these): relevance, development, Part 2 bullets
- **Part 1/3, per question:**
  - `noul` "Does the candidate actually answer the examiner question?"
  - `score` [bare answer / gives a reason / reason plus example or detail].
  - Part 3 adds `noul` "gives an opinion and supports it".
- **Part 2:**
  - one `noul` per cue-card bullet ("Does the talk cover '<bullet>'?")
  - `noul` on-topic throughout
  - `score` development
  - talk length from the audio timing (deterministic; under 60 s gets flagged)
- **Wiring:**
  - Run one Jev call per part in parallel inside `analyzeSpeaking`, using the per-question windows (`questionBoundaries`).
  - Show it on the result page: a per-question strip ("Answered · Extended with an example" / "Too short, add a reason" / "Drifted off topic") and a Part 2 bullet checklist.
  - Pass the outcomes to the scorers as evidence. **No direct band penalty** for a missed bullet (IELTS doesn't mark bullets; it marks topic development).
  - Thresholds: P < 0.3 shows "Didn't answer", 0.3–0.7 shows "Partly answered".
  - Once in place, drop the `relevance` field from luna's feedback call.
- The probes were one-off inline scripts and weren't saved; the results are in section 2. Request format: `{model, state:{examiner_question, candidate_answer}, questions:{addresses:{type:'noul', instructions}, level:{type:'score', instructions, criteria:[...]}}}`.

### D. Writing: shadow mode, then Jev scoring
1. Run a Jev scoring call (4 criterion `score` questions, official descriptors, bands 3–9, plus a `fitKnotMap` map fitted on the gold calibration split) **alongside** luna on every real Writing attempt. Store the result, but show users luna's.
2. If real-user agreement holds, switch Writing scoring to Jev. Show the band instantly, and fill in the luna feedback when it arrives.
3. Keep luna scoring for Task 1 Academic essays whose figure is an image until task E is done.
4. Don't ship the 40+-question ridge model from the experiment; it overfit.

### E. Task 1 Academic charts as data for Jev
- The 60 generated prompts already have `prompts.chart` JSON. The **72 Cambridge prompts are image-only**.
- Convert each image to JSON once, by agents (not OpenRouter). Maps and processes get a structured description instead: before/after features, ordered stages.
- Verify each conversion: convert twice and compare, or redraw from the JSON and compare with the image.
- Build a **deterministic number-checker**: extract the figures from the essay, match them to the JSON values with a tolerance for "about" and rounding, and feed the result as a feature. Jev can't do arithmetic.
- Rerun the Jev eval on the 52 Task 1 Academic gold essays, gold-set prompts first.

### F. Optional: speed up the speaking feedback call
It is the real wait. Options: shorter output, streaming each section as it's ready, or showing the bands first.

### G. Grow the gold sets (owner asked 2026-10-07; licences: research/non-commercial, check before using for production calibration)
1. **EdUHK English Speech Corpus** (https://corpus.eduhk.hk/english_speaking/): audio, transcripts, and the speaker's achieved IELTS Speaking score, with annotations along the four criteria. 48 learner sets plus 30 sets cut from official IELTS videos. **Follow-up source audit:** these are speaker-achieved scores attached to practice recordings, not verified recording-specific examiner gold; annotation views are linguistic features, not numeric criterion labels. Keep them out of `scoring_scripts`. Exclude official videos from learner calibration, group related parts by speaker, and keep research artifacts private. Research downloads are explicitly permitted, but commercial calibration rights are unconfirmed. Access, label evidence, duplicate examples and the frozen method are documented in `docs/scoring-eduhk.md`.
2. **EWCCE-DATA**: checked and **unusable** (no labels in the deposit; not an IELTS task). Original note: (https://data.mendeley.com/datasets/cd874w6g5k/1) 200 handwritten essays, said to be double-marked by certified instructors on TR/CC/LR/GRA. Transcribe them **verbatim** (keep the students' spelling and grammar errors), then add them to the writing calibration pool. That gives about 4× the current 70, which addresses the ridge overfitting seen in the Jev experiment.
3. **Speak & Improve 2025** (https://researchdatasets.cambridge.org/datasets/speak-and-improve-corpus-2025): CEFR labels, so don't use it to calibrate bands. Use the ~60 h hand-transcribed with disfluencies to validate `tagDisfluencies` / `llmDisfluencies` / the fluency composite. Non-commercial; no redistribution.
4. Avoid **Writing9** and the untraceable "scored essays" collections (crowd- or AI-scored labels) and **ASAP** (not IELTS). ICNALE: fluency norms only; check its licence first.

Every dataset the owner proposed, with the verdict. We calibrate, not train, so a few hundred trustworthy labels beat 100k noisy ones.

| Skill | Dataset | Size | Labels | Verdict | Use |
|---|---|---|---|---|---|
| Speaking | EdUHK English Speech Corpus | 78 speaker/session entries, not necessarily 78 independent speakers | speaker-achieved IELTS score; linguistic feature annotations, not numeric criterion gold | **Research first** | Proxy-label calibration experiment only; group by speaker, exclude official videos; commercial rights unconfirmed |
| Speaking | EdUHK IELTS Speaking Corpus | Earlier 24-set version | IELTS bands / achieved-score metadata | Included in the expanded corpus, not independent | Do not add again |
| Speaking | Speak & Improve 2025 | Current release ~315 h; ~55 h hand-transcribed | Indicative CEFR (not IELTS) | Registration and licence required; **not for bands** | Non-commercial disfluency research only; derived-product and API-retention restrictions apply |
| Speaking | ICNALE Spoken Monologues | 73 h / 4,400 | CEFR group (seems to come from the learner's general test score, not from rating each recording) | Limited | Norms for the fluency composite only. Licence not confirmed |
| Speaking | ICNALE Spoken Dialogues | 4,250 | CEFR group | Limited | Same as above; interview format resembles IELTS Part 1/3 |
| Writing | EWCCE-DATA | 200 handwritten | **None in the deposit** (checked 2026-10-07: the CC BY 4.0 zip holds only 200 scanned PDFs, no score sheet) | **Unusable as is** | Prompt is a 100–150-word paragraph on technology, not IELTS Task 1/2. Only revisit if the authors send the score sheet. Details: `.eval/jev/EWCCE-WRITING.md` |
| Writing | IELTS Writing Scored Essays | ~1,400 | "reported" examiner scores | Only if the source is traceable | Sanity check, not calibration |
| Writing | IELTS Task 2 Evaluation | 9,000+ | overall + criteria, unclear raters | Probably avoid | Possibly website/AI-scored |
| Writing | Writing9 | 163k | website/crowd scores (some automated) | **Avoid** | Noisy labels; scraped, no reuse licence |
| Writing | ASAP 2.0 | ~24k | human raters, non-IELTS scale | Not useful | Different task and scale; only for training from scratch, which we don't do |
| Writing | ASAP-AES | ~13k | double human scoring, non-IELTS | Not useful | Same as above |

Rules: split calibration and test by source and by prompt (as `data/scoring-gold` already does). Never score an item that shares a prompt or recording with an anchor. Most of these are research/non-commercial licences, so private evaluation is fine, but using them to calibrate a paid product may need permission.

### H. EdUHK speaking result (completed 2026-10-07) and next step
Report: `apps/server/.eval/jev/EDUHK-SPEAKING.md`. Feature search: `apps/server/.eval/jev/eduhk-improve.mts` (outputs `eduhk/improve-cv.json`, `eduhk/improve-heldout.json`). Spend: about $0.31 OpenRouter plus about $0.88 Scribe (estimate).
- 41 learner clips from 29 speakers (22 calibration, 7 held out, a frozen speaker-disjoint split). Labels are the speaker's achieved IELTS score (a proxy, not a per-recording examiner mark).
- Calibration speakers, leave-one-speaker-out CV:
  - luna affine: MAE 0.67
  - Jev affine: 0.69
  - **Jev + measured fluency (normalised on the training speakers), ridge λ=10: MAE 0.47, QWK 0.73**
  - λ=3 reached 0.44 in CV but was worse on held-out (0.34), i.e. noise
  - Adding MTLD, less-common-word share, the extra Jev questions (development, answers directly, cue coverage, opinion), cumulative thresholds or luna's score did **not** help.
- Held-out (n=7, bands 5–6.5 only): luna affine MAE 0.25 vs **Jev + fluency λ10 MAE 0.29, 7/7 within ±0.5**, i.e. a tie. Says nothing about bands 7+.
- Transfer to the official 12 (bands 5–9): everything is weak (MAE 0.85–0.97); Jev + fluency slightly ahead of luna. High bands remain the open problem.
- **Candidate production design** (not shipped): one Jev call (FC coherence / LR / GRA `score` questions) plus deterministic fluency features in a small ridge. It still needs a high-band test.
- **Next:** test on high bands using EdUHK's 30 official-video clips (already downloaded, `sourceType: 'official'`; 12 are band 7+). Confirm duplicates of our 12 by the actual video, not by token overlap, then score the rest with the frozen calibration fitted on the 22 learners. Also check the chinaielts.org official per-band samples, official IELTS/IDP/British Council YouTube samples where an examiner gives the band, and Cambridge C1/C2 official speaking videos as high-band probes only.

### I. Speaking high-band test (completed 2026-10-07): keep luna for Speaking
Report: `apps/server/.eval/jev/OFFICIAL-HIGHBAND.md`; scripts `apps/server/.eval/jev/official-*.mts`; data `apps/server/.eval/jev/official/`. Spend about $0.83.
- 12 of EdUHK's 30 official clips duplicate our gold-12; matched by 5-gram transcript containment, since the YouTube IDs differ. Excluded: EdUHK 4, 8, 34, 35, 43, 55, 56, 63, 69, 70, 74, 77.
- Of the 18 left, 11 were scored. 7 have no findable video (chinaielts.org / iqiyi / Tencent players), which costs 3 of the 5 band 7+ clips.
- All 11, frozen fits: luna raw MAE 0.64; luna affine 0.51; Jev affine 0.49; Jev + empirical fluency λ10 0.50 (Spearman 0.73).
- Band 7+ (n=2): luna raw bias −1.75; Jev + fluency −0.89. On the gold-12's 7 band 7+ clips: Jev + fluency MAE 0.95 vs luna raw 1.64, but Spearman −0.24 vs +0.81. Jev only shifts scores up; it doesn't rank high bands better.
- **Jev raw never exceeds 5.9 on these clips, even for a fluent band 8 speaker.** The ceiling is in the inputs, so no calibration map can recover it. A refit with official clips added doesn't fix it either (exploratory leave-one-out).
- **Decision: keep luna for Speaking scoring.** Every scorer under-scores bands 7.5–9 by 1–2.5 bands. A real fix needs more examiner-banded band 7+ audio and a high-band-aware prompt. Untested idea: a luna + measured-fluency blend.

### J. PRODUCTION CHANGE (2026-10-07, uncommitted): Jev replaces the LLM scoring calls in Writing and Speaking
- **`openrouter.ts`**: `decide()` sends any mix of Jev `score` / `choice` / `noul` questions and validates every answer. `decideChoice()` (Listening/Reading) wraps it. Writing and Speaking use **`score`** (a continuous expected step plus per-band probabilities).
- **Writing** (`writing.ts` `jevScoreWriting`, used by `analyzeWriting`):
  - One Jev call (the four criteria, bands 3–9) replaces the K=3 luna scoring calls.
  - The overall comes from `DEFAULT_MAPS['typesafe/jev-1.13']` in `calibration.ts`, fitted with `apps/server/.eval/jev/fit-writing-map.mts`: CV MAE 0.53, TEST MAE 0.52 / QWK 0.80, vs luna 0.45 / 0.85.
  - Task 1 Academic prompts whose figure is only an image stay on luna, and any Jev failure falls back to luna.
  - Criterion evidence comes from the feedback call's located errors; descriptor and summary come from the official descriptors.
  - Live run: scoring 1.3–3 s (was up to 36 s); the feedback call (23–35 s) is now the wait.
- **Speaking** (`speaking.ts` `jevSpeaking` and `speakingCurve`):
  - One Jev call (FC coherence / LR / GRA, bands 4–9) replaces the 12 luna `criterion_score` calls.
  - The overall comes from a top-stretched curve on [Jev mean, max(0, mean−6), Jev P(band 8+), measured fluency composite with `SPEAKING_FLUENCY_NORMS`]. Each input is clipped to ±3 SD of the fitting data.
  - Fitted with `apps/server/.eval/jev/curve.mts` on 66 trusted samples. Leave-one-group-out: MAE 0.59 vs 0.86 for production luna raw, band 7+ 0.84 vs 1.74, and it reaches 9. Weak speakers (band ≤5) read about 0.4 high.
  - FC = (Jev coherence + fluency band)/2; P sits at the mean of the others (no P cap on this path); pooling apportions the curve's overall.
  - Feedback, the disfluency tagger and STT stay. Luna calls per part: 15 → 2 (plus the Jev call). Any Jev failure falls back to the 12-call luna scorer.
  - Live check on two ElevenLabs TTS demo recordings: 8.5 and 9 (luna said 7). TTS delivery is perfectly fluent and nothing hears pronunciation, so treat synthetic voices as unreliable test cases.
- **Licence:** the Speaking constants and the Writing map are fitted on research/non-commercial data (EdUHK, ielts.org, Cambridge gold). Get permission before charging for the product.
- **Tests:** speaking 12/12 and writing 25/25, including new Jev-path and fallback tests. The full server suite was not re-run after the Speaking change.
- **Next:** refit the Speaking curve when more examiner-banded 7.5–9 audio arrives; consider showing "8–9" instead of an exact band above 8; run the full suites; commit.

### K. Live mode, transcription cost and dashboard (2026-10-09; built and tested, needs one real live test)
- **One Whisper pass** (`openrouter.ts` `transcribe` / `verbatimAlone`): the disfluency-primed pass alone when it is sane on its own (no loop, no prompt echo, no >8 s / >25% stretch without words); the plain pass only as a fallback. Halves Whisper cost; production has no ElevenLabs key, so every Speaking test was paying two passes.
- **Live recordings hold the candidate only:**
  - `web/src/live/examinerVoice.ts` measures when the examiner is audible from the examiner's own output audio (GPT-Live remote track; Gemini via a `MediaStreamDestination` tap on `PcmPlayer`).
  - `usePartRecorder` (`turn.ts`) pauses the part recorder while the examiner is audible and records answer windows (`answerWindows`) sent as `segments` / `marks` to `/live/finish`. Turn mode drives the same windows from its own examiner playback and closes the window when the candidate's turn ends.
  - Effects: Whisper is billed only for the candidate's speech, the fluency plot no longer dips while the examiner talks, and answers line up with the examiner's questions (transcript headers).
  - Risk: speech over the examiner's tail (within ~600 ms) is not in the scoring audio.
- **Conversation playback:** duplex parts also record the mic mixed with the examiner (`live/mix.ts`). It is uploaded as `conversationKey` (new column `attempts.conversation_key`, migration `0015_live_conversation.sql`, applied on container start by `docker/entrypoint.sh`), served as `conversationUrl`, and played via a "Your answers / With the examiner" switch on the Speaking result.
- **Parts analysed during the test:** new `POST /api/live/part` creates, reserves (under the session's one test) and analyses a part as soon as it ends; it saves a GPT-Live transcript snapshot first so the part's questions are known. `/live/finish` creates only the missing parts (shared `addParts`, idempotent per part, 409 once the session is done). Mobile clients that send everything at finish still work.
- **Admin cost drawer:** a live attempt also lists the live session's own calls (realtime model, examiner voice/lines, per-turn STT) and the session's raw transcript (GPT-Live sideband / turn mode; none for Gemini).
- **Dashboard "holding your band back":** judged on the latest full test when the latest attempt belongs to one, else the last 5 attempts of that skill (was: 30 attempts, both skills mixed). The response carries `skill`, so a Writing LR weakness no longer sends you to Speaking practice.
- **Open:** false starts written as "word..." are not flagged by the rule tagger (on purpose: "well..." is hesitation). A smarter rule (an unfinished link word like "the" / "to" before "..." followed by a new sentence) waits on real examples from the owner.

## 4. Gotchas met this session
- `pgrep -f <pattern>` inside a wait loop matches the loop itself. Match on something more specific, e.g. `"tsx.*ab-speaking"`, and `pkill -f` can kill your own shell.
- Bare imports (`drizzle-orm`, `@ielts/core`) don't resolve from the repo root `.eval/`. Put scripts in `apps/server/.eval/`.
- Under vitest, the AI fetch returns 599 unless a test injects `fakeFetch`. `call()` retries 5xx twice, then fails, and the LR submit falls back cleanly.
- Jev score answers: `{score, confidence, probabilities, legend}`. Noul answers: `{noul}`. Choice answers: `{choice, confidence, probabilities}`. Usage comes back as `input_tokens`/`output_tokens`/`cost` (not `prompt_tokens`).
