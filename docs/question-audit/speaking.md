# Speaking bank audit against Cambridge IELTS (books 3 to 19)

Reference: the private extraction in `data/cambridge/C*.json` (81 Part 2 cards, 89 Part 1 topics, 86 Part 3 sets) and the printed layout of the books. Nothing below reproduces Cambridge text beyond a few words. Ours: `data/bank/speaking-p1.json` (75 topics), `speaking-p2-a/b.json` (120 cue cards, each with a linked Part 3 set), `speaking-p3.json` (80 standalone Part 3 topics).

## Measured Cambridge patterns

### Part 1
- 4 questions per topic (74 of 89 topics; the rest are frame or variant sets).
- About 9.7 words per question once the bracketed examiner tags are removed (mode 8 to 10 words).
- Roughly 70% of questions in 4-question topics carry an examiner tag "[Why?]" or "[Why/Why not?]"; it sits on preferences, likes and habits, not on factual wh- questions.
- Openers: Do 29%, What 24%, How 18%, then Have/Is/Are/Did/When/Which/Would. Frequent frames: "What kinds of ...", "How often ...", "Do you prefer ... or ...?".
- Tense mix inside a topic: present habit first, then preference, then past ("when you were a child") or future/hypothetical.
- Topics are everyday and concrete (weekends, food, clothes, neighbours, email, photographs, names). No questions on society, politics or "people in general".

### Part 2
- Title: "Describe a/an/the ... ." on one line and ends in a full stop in 94% of cards. Mostly concrete things (a hotel, a website, a book, a law) plus "Describe a time when ..." in only 14%.
- "You should say:" followed by exactly 3 bullets in 91% of cards, about 6 words each, built from what (99), how (30), where (28), who (23), when (17). Bullets are short wh-phrases; a bullet beginning "why" is a minority (20) and never "whether".
- Last line: "and explain ..." (why 60%, how 30%, whether/what 10%), always below the bullets.
- Printed instruction under the card: "You will have to talk about the topic for one to two minutes. You have one minute to think about what you are going to say. You can make some notes to help you if you wish."
- The books print no rounding-off questions; the examiner asks a short personal one after the talk.

### Part 3
- Two sub-topics per card (70 of 86 sets), each with a short noun-phrase heading ("Staying in hotels" / "Working in a hotel"), usually 3 questions each (128 groups of 3).
- Median 13 words per question (quartiles 11 to 16).
- Forms: "Do you think ...?" 18% (about 30% counting all "Do you ..."), "Why do (some) people ...?" 11%, "What are the advantages/things/kinds ...", "How important is it ...", "How has ... changed ...", "Do you think ... will ... in the future?" Rare "Some people say ... What do you think?".
- Register: general and social (jobs, education, technology, change over time) but mild; no "Should governments ...", no accusatory or policy framing.

## Our gaps before this audit

| Dimension | Cambridge | Ours before | Gap |
|---|---|---|---|
| P1 questions per topic | 4 | 70 topics with 4, 5 with 5 | 5 topics too long |
| P1 words per question | 9.7 | 7.4 | clipped, yes/no heavy |
| P1 "Why?" tags | 55 to 70% | 0.7% | missing entirely |
| P1 opener "How" | 18% | 6% | |
| P2 title full stop | 94% | 0% | |
| P2 bullets per card | 3 (91%) | 3 in 60 cards, 4 in 60 | all of file b off-pattern |
| P2 bullets starting why/whether | rare | 16 | overlapped the "explain" line |
| P2 "and explain" compounds | one clause | "why ... and whether ..." etc. in b | |
| P2 "Describe a time" share | 14% | 22% | skew in file b |
| P2 near-duplicate cards | none | 10 pairs/clusters (website, app, helped a stranger, proud of a relative, changed mind, wedding, lateness, rules, weather/wait, creative) | |
| P2 layout in UI | title, bullets, then "and explain" | "and explain" shown above the bullets; no timing instruction | web changed; mobile pending |
| P3 grouping | 2 headed sub-topics x 3 | one flat list of 5 or 6, no headings | structural |
| P3 words per question | 13 (median) | 9.5 | short, blunt |
| P3 register | mild | "Should governments", "Who should bear responsibility" in 12 sets+ | policy-heavy |
| P3 "Is it better ...", "Should ..." overuse | rare | 17 + 25 | |
| Exact Cambridge title | n/a | one card (festival) copied a title verbatim | fixed |

## What was changed

- Part 1: all 70 topic sets and the 5 frames now have exactly 4 questions, averaging 8.6 words; 46% carry a "Why?" or "Why/why not?" tail on preference/habit questions; openers are now Do 32%, What 15%, Did 14%, How 7%, Would 7%, Which/Have/Is the rest (still How-light against Cambridge 18%). The three intro frames (hometown, accommodation, work or study) and two branches keep their first lines.
- Part 2: every card has a title ending in a full stop, exactly 3 bullets (none beginning "why"/"whether"), one "and explain ..." clause and 1 or 2 short personal rounding-off questions. The 60 cards of file b were rebuilt from 3 or 4 bullets; 16 near-duplicate or off-pattern cards got new subjects under the same slug (table below).
- Part 3: every linked set (120) and every standalone set (80) is now two headed sub-topics of three questions each, average 11.6 words, with the forms and caps listed above (at most one "What kinds", one "How do", one "in recent years" per set, at least two "Do you think", no "responsibility" wording, no duplicate questions across the bank).
- Data shape: `p3Topics` (linked sets, in `speaking-p2-*.json`) and `subtopics` (standalone, in `speaking-p3.json`), a pair of headings stored in the Part 3 row's existing `bullets` column, so no migration or API change. `apps/server/src/seed.ts` upserts it (`bullets` was already in the conflict update).
- Examiner (`apps/server/src/ai/examiner.ts`): the Part 3 lead names the first heading ("Let's consider first of all ..."), and before question four it says "Now let's move on to consider ..." (both the Gemini and GPT-Live scripts). A trailing full stop on the Part 2 title is stripped wherever the examiner speaks the topic.
- Web (`SessionFlow.tsx`): the Part 3 screen shows the current sub-topic heading in place of the generic topic label.
- Web (`CueCard.tsx`): "You should say:" then the bullets, then the "and explain ..." line, then the Cambridge timing instruction.

## Needed on iOS and Android (not edited here)
- Cue card: move the explain line (server `body` minus the repeated title line) below the bullets, label the list "You should say:", and show the one-to-two-minutes instruction under the card.
- The card title now ends with a full stop; nothing else depends on it.
- Part 3 prompts carry `bullets` = two sub-topic headings. If a Part 3 list is shown, group the six questions as 3 + 3 under those headings.

## Guarantees
- Slugs unchanged (including `-p3` linked rows); rows upsert in place so attempt foreign keys stay valid.
- n-gram/overlap check against all Cambridge text: no near-copy of a whole question, title or explain line. Remaining matches are stock fragments ("who this person is", "where it is").

## Cards given a new subject (same slug, different card)
- p2b-useful-website: a film watched more than once; p2b-useful-app: a game you enjoy; p2b-helped-stranger: an old friend you lost touch with; p2b-someone-helped-you: a school sport; p2b-proud-of-relative: visiting relatives; p2b-changed-mind: feeling very tired; p2b-useful-invention: an event in your country's history; p2b-exercise-you-enjoy: being ill at home; p2b-missed-appointment: getting up very early; p2b-school-rule: a disliked school subject; p2b-traffic-jam: plans changed by weather; p2b-good-news: meeting someone again; p2b-creative-idea: a photograph you took; p2b-future-challenge: a sport you have never tried; p2a-wedding-venue: a hotel or guest house; p2a-role-model-young: a classmate or colleague.
- Reworded to avoid a verbatim or near-verbatim Cambridge line: p2b-local-festival (title was an exact Cambridge title), p2a-book-read, p2a-famous-business-person, and several "and explain ..." lines.

## Remaining differences (accepted)
- "Describe a time ..." is still 20% of cards (Cambridge 14%).
- Part 1 opener "How" is 7% (Cambridge 18%).
- Rounding-off questions (1 or 2 per card) are kept although the books do not print them; the examiner script uses the first.
- An automated second-model review (deepseek) timed out repeatedly, so the review was a manual read of all Part 1 sets and a sample of cards and Part 3 sets plus the scripted checks (overlap with Cambridge, form caps, duplicate questions and titles).
