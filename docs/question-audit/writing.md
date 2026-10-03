# Writing bank audit against Cambridge IELTS 1-19

Method: parsed `data/cambridge/C1-19.json` (92 Task 1 prompts: 73 Academic, 19 General Training; 99 Task 2) and looked at about 15 Task 1 figures in `data/cambridge/img`. Ours: 60 Academic Task 1, 40 GT letters, 120 Task 2. Cambridge text is only paraphrased here.

## What Cambridge does

**Academic Task 1.** 59 of 73 use the exact line "Summarise the information by selecting and reporting the main features, and make comparisons where relevant." (every book from C10 on, including processes and maps; the older "Write a report for a university lecturer" form is C1-C9 only). First sentence: "The graph/chart/table/diagrams/maps below show(s) | give(s) information about ...", with what, where ("in one country", "in four Asian countries") and when. Figure mix: line/graph about 25%, bar and unspecified "chart" about 35%, table about 12%, maps/plans 14%, process diagrams 12%, multi-figure (graph plus table, two charts) about 19%. Charts have 3-5 series, 5-8 categories or time points, even time intervals, short titles, one clear trend plus an exception. Processes have 6-9 labelled steps. Page header: "You should spend about 20 minutes on this task." then "Write at least 150 words."

**GT Task 1.** 1-2 sentence situation, "Write a letter to ...", "In your letter" and exactly 3 bullets starting with explain/describe/say/give details/suggest. Then "Write at least 150 words.", "You do NOT need to write any addresses.", "Begin your letter as follows:", then "Dear Sir or Madam," (formal) or a blank "Dear ......," (friend, neighbour, manager, tutor; the name is never given). Tone: about 45% formal, 30% semi-formal (manager, tutor, neighbour), 25% informal.

**Task 2.** Modern books (C10-C19, 47 prompts): discussion ("Discuss both these views and give your own opinion.") 34%, agree/disagree 23%, positive/negative single question 8%, advantages/disadvantages or "outweigh" 12%, causes/problems plus solutions 10%, two-question forms (why + positive/negative, why + what) 12%. Statement median 21 words (7-53), generalised claim first ("In many countries...", "Some people believe..."), then each question as its own paragraph, then "Give reasons for your answer and include any relevant examples from your own knowledge or experience." (79 of 99), then "Write at least 250 words." "Write about the following topic:" appears in 16%. Topics are broad (education, work, environment, technology, media, health, society); nothing niche.

## Gaps found in our bank (before)

| Area | Gap |
|---|---|
| GT (all 40) | Body ended with "Begin your letter as follows: Dear Mr Harris," placed before the bullets; named salutations for semi/informal letters (Cambridge leaves the name blank); no "You do NOT need to write any addresses."; heading rendered "In your letter:" |
| Renderer | Header read "Task 1 Academic, about 20 minutes" instead of the Cambridge sentence |
| T2-a (60) | No "Give reasons for your answer..." line (T2-b had it); "Discuss both views" instead of "these views"; "To what extent do you agree or disagree?" without "with this statement"; two questions run together on one line |
| T2 types | Evenly 24/24/24/24/24 across the five types; Cambridge is discussion and opinion heavy. Several adv/disadv and problem prompts were stretched to fit the quota |
| T1 Academic (7 processes) | Instruction dropped "and make comparisons where relevant"; 9-11 steps (Cambridge 6-9) |
| T1 Academic tables | 13 tables (22%, Cambridge about 12%); 8 of them were the same shape (two metrics by month/year); two had 12 rows; one cafe table skipped months (Jan, Mar, ...) |
| T1 Academic charts | EV line chart had an uneven last interval (2020, 2022, 2023); China cars/1,000 started at 0 |
| T1 wording | Every body used "shows"; Cambridge also uses "gives information about" (about 40%) |
| T1 maps | The `map` spec is two bullet lists (before/after), not a drawing. Positions are only in the text. Faithful enough for the writing task, but not Cambridge-like; not fixable without a new renderer |
| T1 mixed | No multi-figure prompts (19% of Cambridge). `ChartSpec` holds one figure (a pie spec with two pies is the only multi-panel form), so mixed is not generated |
| Near-copies | 5-gram check of every prompt against all 190 Cambridge Task 1/2 bodies (boilerplate stripped): only genuine overlap was `t1g-restaurant-food-poisoning` and the bullet in `t1g-hotel-lost-property` (reworded). Remaining hits are rubric phrases |

## Fixes (slugs unchanged; seed upserts body, bullets, chart, type, topic on conflict, so no seed change needed)

- GT: removed the "Begin your letter" paragraph from all 40 bodies; renderer (web `PromptPanel.tsx` + `lib/writing.ts#letterOpening`, Android `PromptPanel.kt`/`WritingLogic.kt`, iOS `WritingEditorView.swift`) now prints, after "Write at least 150 words.": "You do NOT need to write any addresses." / "Begin your letter as follows:" / "Dear Sir or Madam," (type `letter-formal`) or "Dear ..............," (others). Skipped for imported Cambridge rows whose body already has the text. "In your letter:" became "In your letter".
- Renderer header: "Task 1 Academic. You should spend about 20 minutes on this task." (same on all three apps).
- T2: all 120 normalised to statement / question paragraphs / "Give reasons..." (the renderer adds "Write at least 250 words."). 22 prompts re-typed in place to reach discussion 34 (28%), opinion 30 (25%), two-part 26 (22%), problem-solution 16 (13%), adv-disadv 14 (12%); 4 statements shortened or de-niched (smart homes, wearables, gig economy, global food supply). I did not add the optional "Write about the following topic:" header because the list title is the first sentence of the body.
- T1 Academic: all 60 bodies now end with the single Cambridge instruction, separated as its own paragraph; 15 use "gives information about"; 7 processes cut to 8 steps; 3 tables rebuilt (cafe by day of week, rainfall by season, gym members by membership type and year); EV chart on even 2-year intervals; China 1970 = 1.
- Not changed: table share stays 22% (no slug may be deleted; new slugs could rebalance later). Maps and mixed figures need renderer work.

## Process
No LLM calls; all rewrites by hand. OpenRouter cost: $0.00. Screenshots: `/tmp/claude-1000/-stuff-Study-projects-portfolio-ielts-prtactice/audit-shots/` (gt-letter, t1-line, t2) match the Cambridge page order (rubric, body, bullets, word count, addresses line, salutation).
