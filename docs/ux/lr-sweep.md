# Listening and Reading UI sweep (web)

## Problems found
- Results page showed everything at once: band, two accuracy lists, pacing, TFNG tables, a 40-row answers table, vocabulary, player, transcript and question list in one long scroll (about 5400 px on desktop).
- Picking a question scrolled you away from the table to a detail card far below; the card opened with six stacked blocks under tiny uppercase labels.
- Jargon: "Pacing", "Heard at", "Same idea, different words", "Dictation" with no explanation. Hub said "Retake or review" but could not review.
- Dashboard trend gave a number with no sense of progress; Mistakes spelling was a flat 26-row list.

## Changes
- Results: band, score, target gap, 2-3 plain takeaways and one action ("See your N mistakes"). Tabs: Summary, Answers, Transcript/Passage.
- Summary: one "Where you lost marks" list (worst first, toggle Question type / Part). Time use and True/False/Not Given are collapsed with a one-line hint.
- Answers: defaults to wrong only; the explanation opens inline under the row. Result is an icon plus the number (not colour alone); listen-from chip per row.
- Question detail: verdict first (You wrote X, the answer is Y), then why; reworded phrases collapsed; plain-language labels.
- Transcript/Passage tab: helper line, sticky player, vocabulary collapsed.
- Hub: Show All / To do / Done filter and "x of n done". History: score beside band. Mistakes: summary line, kind filter, two columns, first 8 then Show all. Dashboard: change since first attempt, link to results.

## Mobile port notes (iOS / Android)
- Mirror the results hierarchy: hero (band, raw, target gap, 2-3 takeaways, one primary button) then a 3-segment control Summary / Answers / Transcript (or Passage).
- Summary: single accuracy list sorted worst first with a Question type / Part toggle; Time and TFNG as collapsed rows.
- Answers: default filter Wrong only; tap a row expands the explanation inline (verdict, why, evidence; reworded phrases collapsed; actions: Show in transcript, Play from, Dictation).
- Use the same copy: "Where you lost marks", "How you used your time", "Listen from", "How the question is reworded", "What the speaker says / passage says".
- Hub: Show filter All / To do / Done. Mistakes spelling: filter, 8 rows then Show all.
