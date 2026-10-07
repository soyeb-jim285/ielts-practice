# EdUHK Speaking Evaluation

Research-only extension of the completed 12-recording experiment in `docs/HANDOFF.md`. The original scores and paid responses remain cached under `.eval/jev/audio/`; do not repeat their transcription or scoring.

## Source Audit

The public corpus entry point is https://corpus.eduhk.hk/english_speech_corpus/. Its actual application is https://lml-elearning.eduhk.hk/englishspeechcorpus/index.aspx. Use https://lml-elearning.eduhk.hk/englishspeechcorpus/BrowseSpeakers.aspx for the inventory, rather than the broken lowercase browse link on its homepage.

The current inventory exposes 78 numbered speaker/session entries, with FC, LR, GA and PN annotation views. These are not necessarily 78 independent speakers. The newer overview says 48 learner sets and 30 official-video sets; the older application About page still says 42 learner sets and 30 official sets. Treat the downloaded inventory as the actual sample count.

The authoritative usage explanation is https://lml-elearning.eduhk.hk/englishspeechcorpus/howto_g.aspx:

> All raw recordings and transcripts are open for download for your own research.

> All the annotations that have been added for the current recordings are solely our suggestions. We do not claim that these are 100% accurate or the only way the speech can be analyzed.

The same page describes the labels as "the IELTS Speaking score they achieved". Therefore learner practice recordings have **speaker-achieved IELTS labels**, not verified recording-specific examiner scores. The four annotation views describe linguistic features, not four numeric criterion gold scores. Do not store these records as examiner-marked `scoring_scripts` or infer four criterion labels from the overall score.

Research downloading is explicitly permitted. Commercial calibration, redistribution and product-use permission are unconfirmed; there is no verified blanket Creative Commons licence. Keep all downloaded recordings, transcripts and calibration artifacts gitignored, and do not activate their maps in production.

Citation supplied by the source: Chen, H. C. (2022). The English Speech Corpus with Different Proficiency Levels. The Education University of Hong Kong. Retrieved from http://corpus.eduhk.hk/english_speech_corpus/.

## Duplicate Audit

Official-video duplicates can have different YouTube upload IDs. Confirmed examples are EdUHK 8 matching Katsuharu (`ieltsorg-speaking-02`), 74 matching Kenn (`ieltsorg-speaking-11`) and 77 matching Anuradha (`ieltsorg-speaking-12`). Exclude all official-video entries from the learner calibration pool, not merely these three examples. The older 24-set EdUHK IELTS corpus is an earlier version of this corpus, not an additional independent dataset.

Public learner MP3s are already split into examiner and candidate turns, for example `audio/record/5.0-M-S5-P1-S1.mp3`. Use only candidate clips for scoring, preserving internal pauses. Group related parts using the learner identity in the source filename, not the numbered page ID. Source segmentation can omit pre-answer thinking time, so these measurements cannot directly establish new recorder pause norms.

## Frozen Method

- Freeze a speaker-disjoint, band-stratified learner calibration/held-out split before paid scoring. Keep all parts of a speaker together. Report the number of independent speakers as well as clips.
- Run real production Luna scoring with cached candidate-only Scribe, including disfluency tagging, feedback and three samples per criterion. Match the recorder's byte-energy scale: `min(255, round(255 * sqrt(RMS)))`.
- Give Jev the same question/answer boundaries and cleaned language, with official FC coherence, LR and GRA descriptors. Do not give numerical fluency measurements or labels to Jev.
- Predeclare affine maps for Luna and Jev, plus matched ridge arms with fixed lambda 10: Jev mean alone versus Jev mean plus measured fluency band. Fit with equal weight per speaker, not repeated weight for speakers with more parts.
- Report training-only leave-one-speaker-out calibration diagnostics and separate frozen held-out speaker results. Do not select variants or hyperparameters using held-out results.
- Apply maps fitted only on the learner calibration pool to the original cached 12 official samples as an exploratory cross-source transfer check. Those 12 are previously seen, not a newly untouched release test.
- Report topic overlap. A speaker split alone is not a source-and-prompt-independent test; shared topics and achieved-score proxies prevent a deployment-quality validation claim.

An additional predeclared, zero-API-cost diagnostic can replace the guessed fluency normalization with empirical training-speaker means/standard deviations. Keep the seven existing feature signs and clipping fixed, refit normalization inside every training CV fold, and combine the resulting scalar with Jev mean using the same fixed-lambda ridge. Evaluate against the unchanged held-out split. This checks whether the normalization helps; it does not validate new production pause norms from pre-cut source clips.

Compare this diagnostic to a matched continuous provisional-composite arm, not only the rounded fluency-band arm, so normalization changes are not confounded with removing half-band quantization. Both continuous arms use averaged per-speaker measurements before applying their seven signed, clipped components.

Agreement metrics: QWK on half-band categories, continuous MAE/RMSE and within +/-0.5, and tied-rank Spearman. Gold/proxy labels never enter scorer requests. The measured Jev arm still depends on Luna's disfluency pass; it is not a Luna-free runtime.

## Other Datasets

Speak & Improve 2025 requires registration, a proposed-use form and CAPTCHA. Its current official description lists approximately 315 hours, with 55 manually transcribed hours, rather than the older 340/60-hour paper figures. It has indicative CEFR labels, not IELTS bands. Its licence restricts research to non-commercial use and excludes using derived information in sold products. Its data-security instructions also restrict commercial-API retention and release of derived artifacts. No registration or dataset transfer has been performed.

EWCCE-DATA is a separate writing task. No handwritten essays have been downloaded, transcribed or evaluated in this speaking extension.

## Resume State

The server restarted before the EdUHK importer and evaluator were saved. The completed official-12 artifacts survived and must not be rerun. The resumed implementation uses `apps/server/.eval/jev/eduhk-import.mts` for free research downloads and `apps/server/.eval/jev/eduhk-eval.mts` for the separately budgeted evaluation. Both scripts and downloaded artifacts are gitignored. No EdUHK transcription or model scoring had been paid for at the time this checkpoint was written.

The evaluator and empirical-normalization helper pass offline self-tests and a targeted TypeScript check. `apps/server/.eval/jev/eduhk-smoke.mts` passes an end-to-end synthetic report test under `/tmp/opencode`: frozen disjoint speaker split, train-only normalization, inactive exports, and reuse of all 12 official cached results. Synthetic report metrics are test fixtures, not EdUHK findings. The evaluator converts imported question-text segments to numeric production indices only after checking exact question-array correspondence. It rejects an incomplete or duplicated official transfer ID set and freezes scorer/calibration fingerprints alongside the split.

Estimate paid costs from the importer manifest's usable audio duration and sample count before running `--run-paid`. The source permission is for own research; maps produced here must remain inactive. The final detailed output is intended for `.eval/jev/EDUHK-SPEAKING.md`.
