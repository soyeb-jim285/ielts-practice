# Listening audit: our generated tests against Cambridge IELTS (books 7-19)

House standard for every generated Listening test (`gen-l-NN`). Measured on 51 official tests (books 7-19, 204 parts, 1,600+ answers) plus 63 transcripts and the recordings of books 2-19. Cambridge material is private; this file records patterns and numbers only.

## 1. What a Cambridge Listening test is

| Part | Context | Voices | Question numbers |
|---|---|---|---|
| 1 | Everyday transactional conversation (booking, enquiry, registration, complaint) | 2 | 1-10 |
| 2 | Everyday monologue, social or practical (a guide, a talk to a club, a recorded announcement) | 1 | 11-20 |
| 3 | Academic discussion: 2-3 students, often with a tutor, about a project, assignment or feedback | 2-4 | 21-30 |
| 4 | Academic lecture, no interruptions | 1 | 31-40 |

Each recording is played once. Difficulty rises through the test. Answers come in the order of the questions, and the script gives a few seconds of "air" between answers.

### Length (measured)
- Script words per part, mean (max): P1 600 (865), P2 595 (925), P3 715 (975), P4 650 (865). Audio per part 380-490 s including the narrator and pauses.
- Our target scripts: P1 650-800, P2 750-850, P3 800-950, P4 700-800 words.

### Silences in the recordings (measured with silence detection)
- Start of part: narrator about 5-15 s, then 20 s to read the first set of questions (about 50 s in Part 4, ten questions).
- Break inside a part between the two question sets: 30-35 s.
- End of Parts 1-3: 30 s to check. Part 4 runs straight into the end of the test; we give one minute to check at the end.

## 2. Narrator lines (house wording)

- Test start (Part 1 only): "This is the IELTS Listening practice test. You will hear a number of different recordings and you will have to answer questions on what you hear. There will be time for you to read the instructions and questions, and you will have a chance to check your work. All the recordings will be played once only. The test is in four parts. Now turn to Part 1."
- Part start: "Part 1. You will hear a conversation between ... First you have some time to look at questions 1 to 5." then 20 s, then "Now listen carefully and answer questions 1 to 5."
- Part 1 example: the form carries an Example line already filled in; the narrator adds "The conversation begins with the example."
- Break: "Before you hear the rest of the conversation, you have some time to look at questions 6 to 10." (Part 2/4: "talk", "lecture") then 30 s, then "Now listen and answer questions 6 to 10."
- Part end: "That is the end of Part 1. You now have half a minute to check your answers." (30 s). Part 4: "That is the end of the test. You now have one minute to check your answers."
- Narrator voice: neutral broadcaster (Daniel). The speakers never address the narrator or mention the questions.

## 3. Question layout per part (measured)

Group sizes and common mixes:
- **P1** (10 questions): one group of 10 in 31 of 51 tests; otherwise 6+4 or 5+5 of the same note/table/form. Kinds: notes 36, table 18, form 12. One title and one layout across the whole 1-10, so the second half never repeats facts from the first half. Example line present in 14 of 51. Word limit "ONE WORD AND/OR A NUMBER" (40 of 65 groups), "ONE WORD ONLY" 14, "NO MORE THAN TWO/THREE WORDS (AND/OR A NUMBER)" 13.
- **P2**: mcq 4 + map 6 (4 tests), mcq 4 + matching 6, mcq 5 + map 5, mcq 6 + two Choose-TWO, matching 6 + two Choose-TWO, Choose-TWO + mcq 3 + matching 5. Maps carry 5-6 questions with 8-9 lettered locations.
- **P3**: two Choose-TWO + matching 6 (7 tests), mcq 5 + notes/sentences 5, mcq 5 + matching 5, mcq 4 + matching 6, mcq 6 + two Choose-TWO. The matching box has 6-8 options, always more options than questions, each used once.
- **P4**: one notes group of 10 in 41 of 51 tests ("ONE WORD ONLY" 43 groups, "NO MORE THAN TWO WORDS" 4), sometimes mcq 2-6 first.
- **MCQ**: 85 of 85 groups use three options (A-C); stems average 10 words, options about 5 words. Options paraphrase the speech, none can be word-matched.
- **Choose TWO**: five options A-E, two question numbers, both carry the same two letters.
- **Answers**: 1,068 of 1,153 gap answers are a single word (93%), 73 two words, 10 three words. Never a Latin name, never a long technical phrase.

### Instruction wording (use exactly)
- `Questions 1-10` uses an en dash: "Questions 1-10." (written "1–10" in data), then "Complete the notes below." / "Complete the table below." / "Complete the form below." and "Write ONE WORD AND/OR A NUMBER for each answer." (NOT "from the lecture", NOT "NO MORE THAN THREE WORDS" in Part 4).
- "Choose the correct letter, A, B or C."
- "Choose TWO letters, A-E." with the question stem on the next line ("Which TWO ... ?"); numbered "Questions 11 and 12."
- Matching to a box: "What ... ? Choose SIX answers from the box and write the correct letter, A-H, next to Questions 25-30."
- Map: "Label the map below. Write the correct letter, A-H, next to Questions 16-20." Plan: "Label the plan below."

## 4. Tone and texture of the recordings
- Natural spoken British English: contractions everywhere, short turns (1-3 sentences), backchannels ("Right", "OK", "I see", "Mmm", "Sure", "Yes, that's right"), false starts, "actually", "sorry".
- Part 1: the agent asks, the customer answers; the target fact is said once, in the flow, never announced. No "I'll put that on the form". Facts are confirmed or corrected ("Julie Anne Garcia? ... That's correct"; "I've got 1991 ... oh, it's 1992").
- Part 2: friendly, practical; the speaker moves through the plan in order and says "OK so that's ..." between sections.
- Part 3: students interrupt each other, change their minds, quote the tutor, refer to feedback. The tutor suggests, rarely instructs.
- Part 4: signposted lecture ("There are three main factors ..."), no questions from the audience, concrete nouns the listener can write down.

## 5. Distractor techniques (every part uses at least three)
1. Correction: a first value is replaced ("Tuesday ... no, sorry, Wednesday").
2. Rejected option: a student proposes X, the other objects, they settle on Y.
3. Paraphrase: MCQ options and matching statements are restatements, never copies of the speech.
4. Near-miss figures: two times, prices or numbers appear and only one answers the question.
5. Order: answers appear in question order; for matching, order follows the talk.
6. Map: places are described by position relative to printed landmarks (entrance, lake, car park), never by letter.
Spelling: Part 1 often has one spelled name (letters read one by one) and one number group (phone, postcode).

## 6. Map and plan specification (our standard)
Cambridge maps are realistic site plans or floor plans: a labelled entrance or "You are here", roads and paths, a few named landmarks printed on the plan, and 8-9 lettered (A-I) unnamed locations; five or six are asked. Ours must:
- be drawn as SVG then PNG: paths/roads, buildings or rooms with the printed names of landmarks, water or green areas, entrance marker, compass-free (the speaker says "left", "right", "opposite", "next to", "at the end of the path");
- carry lettered locations A-H or A-I with letters visibly placed on each location;
- be described only through unambiguous relative positions in the script, and every pair of distractor locations is plausible but unmentioned.

## 7. Voice direction for ElevenLabs v4 Turbo
- Premade British voices for the roles (George, Alice, Lily, plus library Hugh, Katie, Ollie, Charlotte; Charlie for an Australian speaker); narrator Daniel.
- Performance tags sparingly: at most one per turn, 4-8 per part, only at the start of a turn: `[hesitates]`, `[thoughtfully]`, `[laughs]`, `[sighs]`, `[excited]`. Never inside or touching an answer word; the transcript shown to the learner has the tags stripped.
- Spelled names: write "H-A-R-G-R-E-A-V-E-S"; v4 Turbo reads them letter by letter (verified with speech-to-text).
- Phone numbers and postcodes: digits grouped as spoken ("07700 900 316", "YO62 5HQ").

## 8. Findings on our first generation (gen-l-01..03) and the fix

| Area | Cambridge | Ours before | Fix |
|---|---|---|---|
| P1 structure | one form/notes/table of 10, no repeated facts | two 5-question forms; the second half repeated the first half's answers (name, phone, date, price) in all three tests | single group of 10, ten different facts, Example line |
| P1 script | 600-800 words, quick turns | 767-1161 words, long wordy turns, answers announced ("I'll enter it on the form"), spelled name repeated twice | rewritten in a natural register, 650-800 words |
| P2 MCQ | A-C, paraphrased reasons | A-D, fact look-ups ("What time does the library close?") with times listed straight back | three options, reasons/preferences with a rejected option |
| Maps | realistic plan, 8-9 lettered places | plain 3x3 grid of boxes | hand-drawn site plans with roads, paths, entrance, named landmarks |
| P3 | Choose-TWO x2 or mcq 4-5 + matching 6 or notes 5 | mcq 3 (A-D), Choose-TWO, matching 5 against 6 options | Cambridge mixes, matching from a box of 7-8 |
| P4 | ONE WORD ONLY, ten single words | "NO MORE THAN THREE WORDS" and answers such as "Sterna paradisaea", "first century BC", "rural reference station" | ONE WORD ONLY (one test with two-word limit and mcq first), single common nouns |
| Instruction text | en dashes, "A-C" | hyphen in Questions 1-5, "A, B, C or D", "from the lecture" | exact Cambridge wording |
| Audio | 20 s / 30 s / 30 s silences, loudness even | Kokoro 82M local voices, 2-5 minute parts, no direction | ElevenLabs Eleven v4 Turbo multi-speaker dialogue, real silences, -16 LUFS |

Per-test notes (before): gen-l-01 P1 1161 words and "Hargreaves" spelled twice; gen-l-02 P1 repeats name/phone/date/fee; gen-l-03 P1 repeats phone, date, street, fee and P4 uses a Latin name; all three P4 use 2-3 word limits with multiword technical answers; all P2 maps are 3x3 grids.
