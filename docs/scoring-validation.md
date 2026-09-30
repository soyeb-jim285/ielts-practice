# Scoring validation: writing grader, 2026-09-30

Scope: the neutral anchored writing scorer of `docs/scoring-research.md` (§2, §7), run through `pnpm eval:scoring` against the private gold set. Skill: Writing only (Speaking is not covered). Every number below is regenerated from the harness output in `.eval/scoring/*.json` (gitignored). No script text is quoted here or committed.

## 0. Shipped default (iteration 4)

The shipped default is `openai/gpt-6-luna` with a fixed default map (`DEFAULT_MAPS` in `apps/server/src/ai/calibration.ts`, still labelled unvalidated in the UI) and the revised prompt. Through the production path on the 42-script TEST split:

| Metric | Old default (identity map) | Shipped default |
|---|---|---|
| MAE | 0.74 | 0.50 |
| Within ±0.5 | 55% | 81% |
| SMD | -0.57 | -0.25 |
| QWK | 0.61 | 0.76 |
| Band >= 7 bias | -1.12 | -0.62 |

Ceiling probes: 19 of 48 pass (0 before), bias -0.89. The authored band 3 floor scripts still score 4.5 to 5. The "fitted" numbers in the sections below describe an inactive record: what the scorer would give if that record were activated. They are not what users get.

## 1. Verdict

- **No model meets the §4.4 release gate on both panels.** `deepseek/deepseek-v4.1-flash` comes closest. On the frozen TEST split it has QWK 0.85, MAE 0.45, within ±0.5 83% and SMD 0.11; on leave-one-prompt-out CV it fails one of the harness's activation gates (QWK, abs SMD, within ±0.5, MAE, band-group bias): the band >= 7 bias of -0.50. The wider §4.4 list also flags per-family SMD and over-coverage (97%). `openai/gpt-6-luna` fails QWK, MAE, within ±0.5 and the band >= 7 bias on CV, and MAE, within ±0.5, exact, SD ratio, per-family SMD, the band >= 7 bias and coverage on TEST.
- **Both fitted records are stored inactive** (the CV gate failed), so production still serves every model as "uncalibrated" (identity map, q = 1). The fitted maps help a lot (TEST SMD raw -0.57 against -0.01 fitted for luna; -0.22 against 0.11 for deepseek), so keeping them inactive has a cost; see §7.
- **Best on TEST is `deepseek/deepseek-v4.1-flash`, not `openai/gpt-6-luna`.** Paired bootstrap on the same 42 scripts: QWK +0.08 [0.02, 0.14], within ±0.5 +12 points [0, 24], MAE -0.06 [-0.16, 0.05] (not distinguishable). On CV (n = 64) the two are not distinguishable (QWK +0.03 [-0.07, 0.11]). Deepseek costs about 7 times as much per essay, is about 1.8 times slower, and its provider is not pinned (§7, §9). **`DEFAULT_SETTINGS.models.analysis` is unchanged**: the web `ModelPicker.tsx` mirrors it and its test fails on drift, and no record is active for either model. The change is one line per file (§7).
- **The ends of the scale are not reached.** Band 9 model answers come back about 0.88 bands low on luna (48 answers) and 0.60 on deepseek (15 answers); the authored band 3 floor scripts come back at 4.5 on luna and 4.5 / 4 / 5 on deepseek (gate: at most 4). The ceiling gate (overall at least 8.5 and every criterion at least 8) passes on 5 of 15 common answers for luna and 9 of 15 for deepseek.
- **`qwen/qwen3.8-flash` was not validated.** Alibaba serves it at about 60 tokens per second and `effort` does not shorten its reasoning (3000 of 3000 completion tokens were reasoning at both low and medium), so one anchored scoring call needs minutes and the shared upstream pool returned 429 under K = 3. Two of 64 calibration scripts finished. See §9 for the guard someone else added to the harness.

## 2. What was run

| Item | Value |
|---|---|
| Scorer | joint anchored call, K = 3 samples (rotated anchors and criterion order), temperature 0.7, reasoning effort **medium**, scoring only (no feedback call, so the relevance cap is not exercised) |
| promptHash | `577e1ac4520418e5` (unchanged in this round; the code changes below are in `settleWriting`, which is not hashed) |
| Anchors | 22 private scripts (Cambridge 10, 11, 14 and ielts.org), official bands 3.5 to 8.5: T1 Academic 11, T1 GT 1, T2 10. One script each at 8.5 (T1 Academic, T2) and none above |
| Calibration pool | 64 scripts: Cambridge 12, 13, 15 (Academic and GT), 16, 17, 18 (2), 19 and 6 from ielts.org; official bands 4 to 7.5 (SD 0.76); leave-one-prompt-out CV over 62 prompt groups |
| TEST (frozen) | 42 scripts: Cambridge 2, 3, 5, 7, 8, 9 sample answers (34) and 8 ielts.org scripts held out of the anchors; bands 4 to 8; T2 25, T1 Academic 11, T1 GT 6 |
| Probes | 83 scripts: 48 model answers (ceiling, nominal band 9), 3 authored very weak scripts (floor, nominal 3), 3 degraded model answers (nominal 3.5), 4 prompt-copy floors and controlled variants of 4 band 9 answers (error density 1 to 3, off-topic paragraph, truncated, prompt sentences pasted in, overview removed). Luna ran all 83; deepseek ran 50 (15 ceiling answers, including the 4 variant bases) to save cost |
| Models | `openai/gpt-6-luna` (served by OpenAI, json_schema). `deepseek/deepseek-v4.1-flash` (json_schema; 10 different providers served the calls: Together, Wafer, InferenceNet, DeepInfra, AtlasCloud, CoreWeave, DekaLLM, Io Net, Morph, Makora). No Anthropic, no Google, no qwen |
| Fit | `fitCalibration`, lambda = 1 (mean/SD equating), conformal q90 = 1.0 for both models |
| Commands | `pnpm eval:scoring --model <id> --split calib --fit`, then `--split test --fitted` and `--split probe --fitted`; the same without `--fitted` for raw panels |

`--fitted` is a small addition to the harness made in this round: it applies the stored record even when it is inactive. Without it, `--split test` reports the identity map, because neither record passed the gate. The harness heading still reads "Calibrated with active record" on these runs.

### Changes made in this round

1. **Half-band snapping in `settleWriting` (`apps/server/src/ai/writing.ts`).** The calibrated estimate was split into whole criterion bands summing to `round(4 x estimate)`. That gives quarter-band averages, and the IELTS rounding rule (.25 rounds up) then lifts every estimate in [x.125, x.25) and [x.625, x.75) by half a band: a systematic upward bias of about 0.125 and extra variance, neither of which the fit saw. The estimate is now snapped to the half-band grid before the split, so the four shown criteria average exactly to the overall. No new API calls were needed (raw samples are cached). Effect on leave-one-prompt-out CV, before and after:

| Model | MAE | QWK | Exact |
|---|---|---|---|
| luna | 0.52 to 0.48 | 0.66 to 0.68 | 25% to 31% |
| deepseek | 0.48 to 0.45 | 0.69 to 0.71 | 27% to 31% |

2. **Scoring-call timeout 90 s to 480 s (`writing.ts`).** Anchored reasoning calls pass the 90 s default of `chat` and then surface as "Could not reach the AI service".
3. **Effort stays `medium`** (§6): `high` is no better and times out; `low` is worse.
4. Harness and ablation knobs, none of which change production paths: `--fitted`, `SCORING_EFFORT`, `SCORING_ANCHORS=none`.

## 3. Results against the release gates (§4.4)

Predictions are the pipeline's `overallRaw` (the four whole criterion bands averaged, after the rule layer), compared with the official band. Brackets are 95% bootstrap intervals grouped by prompt.

### 3.1 Panels

| Panel | QWK | SMD | SD ratio | MAE | Exact | ±0.5 | Bias <=5 / 5.5-6.5 / >=7 | Coverage |
|---|---|---|---|---|---|---|---|---|
| luna, CV (n=64, leave-one-prompt-out) | 0.68 | -0.08 | 0.92 | 0.48 | 31% | 77% | 0.15 / 0.03 / -0.43 | 95% |
| luna, TEST raw (identity map, n=42) | 0.61 | -0.57 | 1.83 | 0.74 | 14% | 55% | 0.36 / -0.50 / -1.12 | 81% |
| luna, TEST fitted map (n=42) | 0.77 | -0.01 | 1.50 | 0.51 | 29% | 71% | 0.73 / 0.00 / -0.50 | 98% |
| deepseek, CV (n=64, leave-one-prompt-out) | 0.71 | -0.01 | 1.00 | 0.45 | 31% | 83% | 0.20 / 0.13 / -0.50 | 97% |
| deepseek, TEST raw (identity map, n=42) | 0.78 | -0.22 | 1.57 | 0.52 | 26% | 69% | 0.55 / -0.25 / -0.68 | 100% |
| deepseek, TEST fitted map (n=42) | 0.85 | 0.11 | 1.27 | 0.45 | 26% | 83% | 0.64 / 0.11 / -0.21 | 100% |

Uncalibrated (identity) CV panels on the calibration pool, for reference: luna raw mean 5.63 against official 6.15 (SMD -0.70); deepseek raw mean 5.81 (SMD -0.48).

The fitted record on TEST is out of sample: it was fitted on the calibration pool only, and TEST was never used to choose the prompt, effort, K, lambda or the snapping change.

### 3.2 Gates: `openai/gpt-6-luna`

| Gate | Threshold | CV (n=64) | Result |
|---|---|---|---|
| QWK (half-band) | >= 0.70 | 0.68 [0.52, 0.79] | FAIL |
| abs(SMD) overall | <= 0.15 | -0.08 | pass |
| abs(SMD) per task family | <= 0.10 | t2 -0.12 (n=29), t1a -0.11 (n=30), t1g 0.47 (n=5) | FAIL |
| SD ratio human/machine | 0.80 to 1.25 | 0.92 | pass |
| Bias, band <=5 | abs(bias) <= 0.35 (n<15: reported, not gated) | 0.15 (n=10, CI [-0.12, 0.44]) | n/a |
| Bias, band 5.5-6.5 | abs(bias) <= 0.35 (CI bound) | 0.03 (n=39, CI [-0.18, 0.23]) | pass |
| Bias, band >=7 | abs(bias) <= 0.35 (CI bound) | -0.43 (n=15, CI [-0.70, -0.14]) | FAIL |
| MAE | <= 0.45 | 0.48 [0.38, 0.58] | FAIL |
| Within ±0.5 | >= 80% | 77% | FAIL |
| Exact | >= 30% | 31% | pass |
| 90% range coverage | 85% to 95% | 95.3% (mean width 2.01) | FAIL |

| Gate | Threshold | TEST, fitted map (n=42) | Result |
|---|---|---|---|
| QWK (half-band) | >= 0.70 | 0.77 [0.69, 0.84] | pass |
| abs(SMD) overall | <= 0.15 | -0.01 | pass |
| abs(SMD) per task family | <= 0.10 | t2 -0.10 (n=25), t1a -0.06 (n=11), t1g 0.49 (n=6) | FAIL |
| SD ratio human/machine | 0.80 to 1.25 | 1.50 | FAIL |
| Bias, band <=5 | abs(bias) <= 0.35 (n<15: reported, not gated) | 0.73 (n=11, CI [0.38, 1.00]) | n/a |
| Bias, band 5.5-6.5 | abs(bias) <= 0.35 (n<15: reported, not gated) | 0.00 (n=14, CI [-0.19, 0.21]) | n/a |
| Bias, band >=7 | abs(bias) <= 0.35 (CI bound) | -0.50 (n=17, CI [-0.69, -0.31]) | FAIL |
| MAE | <= 0.45 | 0.51 [0.39, 0.63] | FAIL |
| Within ±0.5 | >= 80% | 71% | FAIL |
| Exact | >= 30% | 29% | FAIL |
| 90% range coverage | 85% to 95% | 97.6% (mean width 2.10) | FAIL |

Gates passed: CV 4 of 10, TEST 2 of 9.

### 3.3 Gates: `deepseek/deepseek-v4.1-flash`

| Gate | Threshold | CV (n=64) | Result |
|---|---|---|---|
| QWK (half-band) | >= 0.70 | 0.71 [0.53, 0.82] | pass |
| abs(SMD) overall | <= 0.15 | -0.01 | pass |
| abs(SMD) per task family | <= 0.10 | t2 -0.15 (n=29), t1a 0.09 (n=30), t1g 0.42 (n=5) | FAIL |
| SD ratio human/machine | 0.80 to 1.25 | 1.00 | pass |
| Bias, band <=5 | abs(bias) <= 0.35 (n<15: reported, not gated) | 0.20 (n=10, CI [0.06, 0.36]) | n/a |
| Bias, band 5.5-6.5 | abs(bias) <= 0.35 (CI bound) | 0.13 (n=39, CI [-0.05, 0.31]) | pass |
| Bias, band >=7 | abs(bias) <= 0.35 (CI bound) | -0.50 (n=15, CI [-0.76, -0.25]) | FAIL |
| MAE | <= 0.45 | 0.45 [0.35, 0.55] | pass |
| Within ±0.5 | >= 80% | 83% | pass |
| Exact | >= 30% | 31% | pass |
| 90% range coverage | 85% to 95% | 96.9% (mean width 2.04) | FAIL |

| Gate | Threshold | TEST, fitted map (n=42) | Result |
|---|---|---|---|
| QWK (half-band) | >= 0.70 | 0.85 [0.79, 0.89] | pass |
| abs(SMD) overall | <= 0.15 | 0.11 | pass |
| abs(SMD) per task family | <= 0.10 | t2 -0.02 (n=25), t1a 0.34 (n=11), t1g 0.46 (n=6) | FAIL |
| SD ratio human/machine | 0.80 to 1.25 | 1.27 | FAIL |
| Bias, band <=5 | abs(bias) <= 0.35 (n<15: reported, not gated) | 0.64 (n=11, CI [0.45, 0.83]) | n/a |
| Bias, band 5.5-6.5 | abs(bias) <= 0.35 (n<15: reported, not gated) | 0.11 (n=14, CI [-0.18, 0.38]) | n/a |
| Bias, band >=7 | abs(bias) <= 0.35 (CI bound) | -0.21 (n=17, CI [-0.42, 0.00]) | FAIL |
| MAE | <= 0.45 | 0.45 [0.35, 0.55] | FAIL |
| Within ±0.5 | >= 80% | 83% | pass |
| Exact | >= 30% | 26% | FAIL |
| 90% range coverage | 85% to 95% | 100.0% (mean width 2.07) | FAIL |

Gates passed: CV 7 of 10, TEST 3 of 9.

Reading the failures:

- **Band >= 7 bias is the structural one.** Under mean/SD equating the expected bias at a true band y is -(1 - r)(y - mean), about -0.3 at band 7.5 for r = 0.7 (§2.4); the observed CV values are -0.43 (luna) and -0.50 (deepseek). With n = 15 the CI half-width is already about 0.25, so the CI-bound form of this gate cannot pass unless the bias is near zero.
- **Band <= 5 bias on TEST** (0.73 luna, 0.64 deepseek, n = 11) comes from the 4 official band 4 scripts and one 4.5, which both models place at 5 to 5.5. The gate is not enforced here because n < 15.
- **T1 task-family SMD** (luna 0.49 on T1 GT, deepseek 0.34 / 0.46 on T1 Academic / GT) is over the 0.10 per-family limit, with n = 6 to 11 per family.
- **Coverage.** Half-widths come from CV on the calibration pool, where q90 = 1.0 is the smallest half-band value that reaches 90%. TEST coverage is higher (98% luna, 100% deepseek) because the mean width of about 2 bands is conservative for the tails and ±0.5 bands are common.

## 4. Error by official band 3 to 9

Bias is prediction minus official band; the band column is the official band rounded down (band 3 holds 3 and 3.5, band 4 holds 4 and 4.5, and so on). The CV and TEST rows hold real candidate scripts; bands 3 and 9 exist only as probes (authored floor scripts and degraded model answers at 3 and 3.5, model answers at 9), so they are nominal.

### `openai/gpt-6-luna`

| Source | Statistic | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|
| CV, calibration pool OOF (n=64) | n | 0 | 2 | 13 | 34 | 15 | 0 | 0 |
| | bias | – | 0.25 | 0.15 | 0.00 | -0.43 | – | – |
| | MAE | – | 0.25 | 0.31 | 0.50 | 0.63 | – | – |
| TEST, fitted map (n=42) | n | 0 | 4 | 11 | 10 | 13 | 4 | 0 |
| | bias | – | 1.00 | 0.32 | 0.05 | -0.38 | -0.88 | – |
| | MAE | – | 1.00 | 0.59 | 0.25 | 0.38 | 0.88 | – |
| Probes, ceiling and floor nominal bands (n=54) | n | 6 | 0 | 0 | 0 | 0 | 0 | 48 |
| | bias | 1.08 | – | – | – | – | – | -0.88 |
| | MAE | 1.08 | – | – | – | – | – | 0.88 |

### `deepseek/deepseek-v4.1-flash`

| Source | Statistic | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|
| CV, calibration pool OOF (n=64) | n | 0 | 2 | 13 | 34 | 15 | 0 | 0 |
| | bias | – | 0.25 | 0.23 | 0.10 | -0.50 | – | – |
| | MAE | – | 0.25 | 0.31 | 0.49 | 0.50 | – | – |
| TEST, fitted map (n=42) | n | 0 | 4 | 11 | 10 | 13 | 4 | 0 |
| | bias | – | 0.88 | 0.32 | 0.15 | -0.12 | -0.50 | – |
| | MAE | – | 0.88 | 0.41 | 0.45 | 0.35 | 0.50 | – |
| Probes, ceiling and floor nominal bands (n=21) | n | 6 | 0 | 0 | 0 | 0 | 0 | 15 |
| | bias | 1.00 | – | – | – | – | – | -0.60 |
| | MAE | 1.00 | – | – | – | – | – | 0.60 |

Tail sample sizes are small: CV has 2 scripts at band 4 and none at 8 or above; TEST has 4 at band 4 and 4 at band 8; there is no real script at band 3 or 9 anywhere. Every tail figure above rests on single-digit counts and is indicative only. The pattern is the same for both models: weak scripts are over-scored, strong scripts are under-scored, and only the middle (5.5 to 6.5) is unbiased. That is conditional central tendency, which no linear map can remove at r of about 0.7.

## 5. Probes (ceiling, floor, controlled variants)

Probe results use the fitted map. Checks per probe kind (pass counts):

| Kind (expectation) | luna (all 83) | luna (same 50 as deepseek) | deepseek (50) |
|---|---|---|---|
| ceiling (overall >= 8.5, every criterion >= 8) | 18/48 | 5/15 | 9/15 |
| floor, authored (overall <= 4) | 0/3 | 0/3 | 1/3 |
| floor, degraded model answer (overall <= 4) | 2/3 | 2/3 | 3/3 |
| prompt copied as the whole response (Band 1 rule) | 4/4 | 4/4 | 4/4 |
| prompt sentences pasted into a band 9 answer (not above base) | 4/4 | 4/4 | 4/4 |
| error density 1, 2, 3 (non-increasing score) | 12/12 | 12/12 | 11/12 |
| off-topic paragraph added (below base) | 3/4 | 3/4 | 4/4 |
| truncated under length (below the base, <= 6.5) | 3/4 | 3/4 | 2/4 |
| T1 overview removed (TA <= 5) | 0/1 | 0/1 | 0/1 |

- **Ceiling.** Luna: mean overall 8.12 on 48 answers (22 at 8.5 or more, 22 with every criterion at 8 or more, 18 passing both). On the 15 common answers luna passes 5 and deepseek 9 (deepseek mean 8.40). The best-case raw scores (before the map) sit near 7.5; the fitted map lifts them but its slope is fixed by a pool whose top band is 7.5, and outside the pool's raw range the map continues with slope 1 (§2.4 step 5).
- **Floor.** The lowest anchor is 3.5 and the lowest bin is 4, and both models answer 4 to 5 for scripts that are band 3. Degraded model answers (3.5) score 4 to 4.5. The prompt-copy rule (Band 1) works: 4 of 4 on both models.
- **Monotonic error chains** (a band 9 answer, then error density 1, 2, 3, which may repeat a score but not raise it): all 8 chains are non-increasing. Luna passes 12 of 12 checks. Deepseek passes 11 of 12: one Task 1 answer with density 3 stayed at 7.5 where the probe expects 7 or less. Base answers score 8 to 8.5 on luna and 8 to 9 on deepseek; density 3 brings them to 7 (luna) and 6.5 to 7.5 (deepseek).
- **Weak penalties.** With the overview removed from a band 9 Task 1 answer, TA falls to 6 on both models but CC, LR and GRA stay at 8, so the overall stays 7.5 (the probe expects TA of 5 or less). A truncated answer (under the minimum length) gets TA 5 but LR and GRA of 7 to 9, so the overall stays at 7 to 7.5: two of four answers on deepseek and one of four on luna miss the expected 6.5 or less. One off-topic paragraph costs at most one band, and on one answer luna gave the base score.

## 6. Diagnosis and ablations (all decided on calibration-pool CV, not on TEST)

Luna only (cheapest, and the model with a complete cache), leave-one-prompt-out CV on the 64 calibration scripts, same scripts and folds for every row; effort medium, K = 3 samples.

| Variant | QWK | MAE | Exact | ±0.5 | Pearson r | SMD | Model calls per essay | Measured cost per essay |
|---|---|---|---|---|---|---|---|---|
| **Joint call with anchors (shipped)** | 0.68 | 0.48 | 31% | 77% | 0.69 | -0.08 | 3 | about $0.002 |
| Per-criterion calls with anchors (4 criteria x 3 samples) | 0.65 | 0.50 | 30% | 77% | 0.65 | 0.02 | 12 | about $0.011 ($0.60 for 57 essays) |
| Joint call, no anchors | 0.67 | 0.49 | 28% | 77% | 0.67 | -0.01 | 3 | about $0.005 ($0.34 for 64 essays) |

- **Per-criterion vs joint** (`--ablate per-criterion`, paired grouped bootstrap): QWK -0.04 [-0.12, 0.05], MAE +0.02 [-0.06, 0.09], Pearson -0.04 [-0.12, 0.04], SMD +0.10 [0.02, 0.18]. No gain, four times the calls, so the joint call stays (§7.2 item 4 of the design).
- **Anchors vs none** (paired on the same folds, map output rounded directly to half bands for both): QWK with anchors 0.69 against 0.67 without (difference -0.02 [-0.09, 0.04] for removing them), MAE 0.47 against 0.49 (+0.02 [-0.04, 0.09]), exact 33% against 28%. **Anchors show no measurable benefit on CV, and no measurable harm.** On the first half of the pool (32 scripts) removing them looked better (QWK +0.06 [0.01, 0.13]); on the other half it reversed, so that was noise. Anchors were kept because the design expects them to matter at the ends of the scale, where CV has no data, and because the no-anchor run cost more per essay in this measurement (the cause was not isolated; luna caches the long shared prefix). Whether they help at bands 4 and below or 8 and above is not measurable with this pool. Removing them was not tried on TEST or the probes, which would have been tuning on them.
- **Changing anchors invalidates records** (`promptHash`): both variants above were fitted and then deleted from `scoring_calibrations`; only the shipped luna and deepseek records remain.


### Other diagnoses on the calibration pool

| Question | Result |
|---|---|
| **K** (Pearson r of the raw criterion-mean score with the official band, K = 1, 2, 3 samples; all sample subsets averaged) | luna 0.687 / 0.706 / 0.713; deepseek 0.686 / 0.704 / 0.710. Extrapolating the trend, K = 5 would add roughly 0.005 to 0.01 (not measured). Within-script sample SD is 0.16 (luna) and 0.13 (deepseek) |
| **Effort** (luna, the 46 scripts all three efforts finished) | r: low 0.664, medium 0.704, high 0.706. High needs 60 to 240 s per essay and timed out on 5 scripts, so medium |
| **Noise or bias?** | Luna and deepseek raw scores correlate 0.89 with each other but only 0.71 with the official band; their mean gives r 0.73. The limit is shared compression and label noise on a range-restricted pool (official SD 0.76), not sample noise |
| **Criterion features** (ridge regression of the official band on the four criterion means, leave-one-prompt-out) | No gain over the equated mean: r 0.68 against 0.70, MAE 0.43 to 0.45 against 0.47, and the SD ratio worsens to 1.4 to 1.7 |
| **Steeper maps** (lambda > 1, removes more tail bias at a cost in MAE) | see the table below |

Lambda sweep, leave-one-prompt-out CV, direct half-band rounding of the map output (lambda 1 is shipped):

| Model | lambda | slope | QWK | MAE | Exact | ±0.5 | SD ratio | Bias <=5 / 5.5-6.5 / >=7 |
|---|---|---|---|---|---|---|---|---|
| luna | 0 | 0.80 | 0.66 | 0.43 | 33% | 81% | 1.35 | 0.60 / 0.03 / -0.57 |
| luna | 0.5 | 0.95 | 0.67 | 0.46 | 31% | 77% | 1.12 | 0.50 / 0.04 / -0.47 |
| luna | 1 | 1.13 | 0.69 | 0.47 | 33% | 75% | 0.97 | 0.25 / 0.05 / -0.43 |
| luna | 1.5 | 1.33 | 0.67 | 0.52 | 31% | 70% | 0.86 | 0.20 / 0.05 / -0.33 |
| luna | 2 | 1.58 | 0.64 | 0.60 | 27% | 64% | 0.73 | -0.05 / 0.08 / -0.27 |
| deepseek | 0 | 0.87 | 0.63 | 0.45 | 30% | 83% | 1.39 | 0.55 / 0.12 / -0.63 |
| deepseek | 0.5 | 1.03 | 0.64 | 0.49 | 23% | 80% | 1.15 | 0.50 / 0.12 / -0.53 |
| deepseek | 1 | 1.22 | 0.71 | 0.45 | 31% | 83% | 1.00 | 0.20 / 0.13 / -0.50 |
| deepseek | 1.5 | 1.45 | 0.68 | 0.51 | 30% | 78% | 0.82 | 0.05 / 0.13 / -0.33 |
| deepseek | 2 | 1.72 | 0.66 | 0.63 | 19% | 67% | 0.70 | -0.20 / 0.15 / -0.23 |

Lambda = 1 has the best or tied-best QWK and MAE for both models. Steeper maps cut the band >= 7 bias (luna -0.43 to -0.33 at 1.5; deepseek -0.50 to -0.33) but raise MAE to 0.51 to 0.52, which fails the MAE gate, and push the SD ratio under 0.85. No lambda passes every gate on CV.

## 7. Activation and default

| Action | State |
|---|---|
| Records in `scoring_calibrations` | luna `27c0c1ccfa21...` (effort medium, K 3) and deepseek `eefc7c48b512...`: both `active = false` (CV gate failed) |
| Production behaviour | identity map, q = 1, "uncalibrated" label for every model, including the default |
| Default model | unchanged (`openai/gpt-6-luna`) |

To act on the TEST result (decisions for whoever owns those files, not applied here):

- Set `models.analysis` to `deepseek/deepseek-v4.1-flash` in `apps/server/src/settings.ts` and mirror it in `DEFAULT_MODELS` in `apps/web/src/components/settings/ModelPicker.tsx` (its test fails on drift; the speaking path reads the same setting). Expect about 7 times the scoring cost and about 1.8 times the latency.
- Before relying on the deepseek record, **pin its provider** (`provider: { order: [slug], allow_fallbacks: false }`). The fit was made on calls served by 10 providers, some at fp4 and fp8, so a different mix can shift the raw scores and invalidate the map.
- Provisional activation, if the team prefers a calibrated result to a labelled identity map: `update scoring_calibrations set active = true where key like 'eefc7c48b512%'` (deepseek) or `'27c0c1ccfa21%'` (luna). The only activation gate deepseek misses is the band >= 7 bias CI, which §3 argues is structural at r of about 0.7. Keep the "not validated" wording in the UI either way.

## 8. Cost and latency

Scoring only (K = 3 joint calls, effort medium, no feedback call). The feedback call adds about $0.005 on luna (measured once on a test script) and runs in parallel with scoring.

| Model | Cost per essay | Median wall time per essay (n) | 90th percentile | Notes |
|---|---|---|---|---|
| `openai/gpt-6-luna` | about $0.0018 ($0.113 for 62 fresh probe essays) | 35 s (185 essays) | 47 s | prompt caching applies; 4k completion tokens per call, about half reasoning |
| `deepseek/deepseek-v4.1-flash` | about $0.013 ($0.56 for 42 TEST essays; $0.62 for 50 probes) | 62 s (152 essays) | 134 s | 7.7k completion tokens per call, mostly reasoning; slowest calls reached 240 s before the timeout change |

Wall times include 3 to 6 essays in flight at once and up to 3 parallel calls per essay, so they overstate a lone request. Spend recorded by the harness for the kept runs: deepseek $1.50 (calibration, TEST, probes), luna probes $0.11, the two luna ablations $0.60 (per-criterion) and $0.34 (no anchors); luna calibration and TEST samples came from the cache of earlier runs. Discarded partial runs (luna at high effort, qwen) were not recorded. The OpenRouter account total rose from $31.89 to $36.81 (+$4.92) during this session, which also includes other agents' calls.

## 9. Caveats

- **Sample sizes.** The tails are single-digit: CV has no script at 8 or above and two at 4; TEST has 4 at band 4 and 4 at band 8; no real script at 3 or 9. Bootstrap CIs on n = 42 are wide (QWK about ±0.07, MAE about ±0.1), and only the QWK difference between the two models clears noise.
- **Contamination.** The scripts, their bands and the examiner commentary are public. Both models may have seen them; TEST scripts come from books 2 to 9 and ielts.org, which have been online longest. The paraphrase check of §4.2 was not run. The ceiling and floor probes are derived from the same public text. Treat TEST numbers as optimistic.
- **Label quality.** Bands for Cambridge 2 to 9 sample answers and the "model" answers used as ceiling probes come from the books, not from double-marked current examiners; the ielts.org bands are examiner-marked. No human-human baseline exists on this distribution.
- **Range restriction.** The calibration pool spans 4 to 7.5 (SD 0.76), TEST 4 to 8. Model outputs saturate (raw scores for band 7 to 9 scripts sit within about 1 band), so a slope fitted on the pool under-corrects wider populations: the TEST SD ratio is 1.50 (luna) and 1.27 (deepseek) against about 1.0 on CV.
- **Figures.** Eight calibration scripts (Cambridge 15 and ielts.org 2023, Task 1 Academic) have no figure and are scored as "figure not available"; reconstructed prompts (6 in TEST) are reported separately by the harness. Task 1 accuracy is bounded by figure data that is not stored for every prompt.
- **Conformal half-width** q90 = 1.0 is marginal, from 64 scripts, in half-band steps; it over-covers on TEST. The widening rules for flags and divergent samples are not tested here.
- **`scoringSamples` keeps partial results.** If some of the K calls fail, the rest are reused round-robin without a flag. Fewer than K distinct samples could therefore sit behind a cached record. The harness does not record how many calls succeeded.
- **Provider mix.** Deepseek calls were spread over 10 providers (§7). Luna was served by OpenAI for every kept panel; in the two ablation runs some calls were also served by Azure.
- **qwen guard.** `scripts/eval-scoring.ts` line 36 (not added by me) exits when the model id contains "qwen", with a message saying the user dropped it. I did not add, verify or remove it. My own measurements (§1) independently show qwen3.8-flash is not practical at K = 3. If qwen is wanted, the guard has to go and the timeout and concurrency need rework (roughly 4 minutes per essay).
- **Harness flakiness.** With more than about 30 calls in flight, bursts of "Could not reach the AI service" appeared and the harness skipped the script after 3 tries; reruns hit the cache and only re-score the gaps. No result in this report comes from a script with a missing score: each panel reports `n` and every panel has all its scripts.

## 10. Reproduce

```
pnpm eval:scoring --model <id> --split calib --fit              # fit + CV panel, writes an inactive record
pnpm eval:scoring --model <id> --split test --fitted            # TEST with the stored record, even if inactive
pnpm eval:scoring --model <id> --split probe --fitted
pnpm eval:scoring --model <id> --split calib --fit --ablate per-criterion
SCORING_ANCHORS=none pnpm eval:scoring --model <id> --split calib --ids <ids>
```

Raw samples are cached under `.eval/scoring-cache/` (gitignored), so a rerun only pays for new scripts. Any edit to `prompts.ts`, `descriptors.ts` or the anchors changes `promptHash` and invalidates the records.
