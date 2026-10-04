#!/usr/bin/env bash
# Records real interaction clips: `adb shell screenrecord` in the background while taps/swipes/text are sent with adb input.
# Taps find their target by dumping the UI (uiautomator) and reading the bounds of a text / content-description, no hardcoded coordinates.
# Each clip runs twice: an unrecorded probe pass that dumps and taps, then the recorded pass, which replays the same taps at the coordinates
# the probe found. A dump takes 2-5 s (longer while something animates), so the recorded pass has no dead pauses; the probe also warms the app.
# Demo mode (see apps/android/.../core/Demo.kt) opens each screen on fixtures; `--ez tour true` adds the video-tour data (one student, Nusrat,
# band 6.0 to 7.0 over three weeks: apps/android/scripts/gen-tour-fixtures.mjs) and runs the demo audio clocks and synthetic microphone.
# Output: device-video/<NN-feature-theme>.mp4 (one feature per clip, portrait) plus dumps/ for debugging.
set -u
APK=apps/android/app/build/outputs/apk/debug/app-debug.apk
PKG=com.soyeb.ieltspractice
OUT=device-video
mkdir -p "$OUT/dumps"
adb install -r "$APK"
adb shell pm grant "$PKG" android.permission.RECORD_AUDIO || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
adb shell settings put global hide_error_dialogs 1
adb shell settings put secure anr_show_background 0 || true
for l in com.google.android.apps.nexuslauncher com.android.launcher3; do adb shell pm disable-user --user 0 "$l" > /dev/null 2>&1 || true; done
sleep 8 # SystemUI restarts when the launcher goes; set the demo status bar after that
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false > /dev/null
adb shell settings put secure show_ime_with_hard_keyboard 1 # soft keyboard on screen while typing
adb shell settings put system show_touches 1                # white touch dots in the recording
adb shell settings put global window_animation_scale 1; adb shell settings put global transition_animation_scale 1; adb shell settings put global animator_duration_scale 1
read -r W H < <(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | tr x ' ')
echo "display ${W}x${H}"
CX=$((W / 2))

# ---- helpers -------------------------------------------------------------------------------------------------------
cat > /tmp/find_xy.py <<'PY'
# find_xy.py <label> [n] [dy]: prints "x y" of the n-th (0-based) node whose text or content-desc matches (exact, then prefix, then contains),
# y moved by dy px. Reads the uiautomator XML on stdin.
import sys, re, xml.etree.ElementTree as ET
label, n, dy = sys.argv[1].lower(), int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 0
s = sys.stdin.read()
s = s[: s.rfind("</hierarchy>") + 12]
try: root = ET.fromstring(s)
except Exception: sys.exit(1)
hits, screen = [], 0
for e in root.iter("node"):
    t, d = (e.get("text") or "").lower(), (e.get("content-desc") or "").lower()
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", e.get("bounds") or "")
    if not m: continue
    x1, y1, x2, y2 = map(int, m.groups())
    screen = max(screen, y2)
    if x2 <= x1 or y2 <= y1: continue
    sc = 0 if label in (t, d) else 1 if t.startswith(label) or d.startswith(label) else 2 if label in t or label in d else None
    if sc is not None: hits.append((sc, len(hits), (x1 + x2) // 2, (y1 + y2) // 2))
if not hits: sys.exit(1)
best = min(h[0] for h in hits)
pick = [h for h in hits if h[0] == best]
upper = [h for h in pick if h[3] < screen * 0.88] # the same label in the content and in the bottom navigation bar ("Writing"): the content one
if upper: pick = upper
h = pick[min(n, len(pick) - 1)]
print(h[2], h[3] + dy)
PY
DUMPN=0; CLIP=init; MODE=probe; XY=(); XI=0
dump() { # UI hierarchy to $OUT/dumps (kept as an artifact) and /tmp/ui.xml
  local i
  for i in 1 2 3; do
    adb exec-out uiautomator dump /dev/tty 2>/dev/null > /tmp/ui.xml
    grep -q "</hierarchy>" /tmp/ui.xml && break
    sleep 1
  done
  DUMPN=$((DUMPN + 1)); cp /tmp/ui.xml "$OUT/dumps/$CLIP-$DUMPN-$(printf %s "${1:-dump}" | tr -c 'A-Za-z0-9_-' _).xml" # artifact names allow no quotes or colons
}
tap_text() { # tap_text <label> [n] [sleep after] [dy]: probe pass finds it in a dump and remembers where; the recorded pass taps there
  local xy
  if [ "$MODE" = replay ]; then xy=${XY[$XI]:-}; XI=$((XI + 1))
  else dump "$1"; xy=$(python3 /tmp/find_xy.py "$1" "${2:-0}" "${4:-0}" < /tmp/ui.xml); XY+=("${xy:--}"); fi
  if [ -z "$xy" ] || [ "$xy" = - ]; then echo "MISS tap_text '$1' ($MODE)"; return 1; fi
  [ "$MODE" = probe ] && echo "tap '$1' at $xy"
  adb shell input tap $xy; sleep "${3:-1.2}"
}
swipe_up()   { adb shell input swipe $CX $((H * 72 / 100)) $CX $((H * 30 / 100)) "${1:-650}"; sleep "${2:-1}"; }  # scrolls the content down
swipe_down() { adb shell input swipe $CX $((H * 30 / 100)) $CX $((H * 72 / 100)) "${1:-650}"; sleep "${2:-1}"; }
launch() { # launch <screen> <theme> [tab]
  if [ "$2" = dark ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  adb shell am force-stop "$PKG"
  adb shell am start -W -n "$PKG/.MainActivity" --ez demo true --ez tour true --es screen "$1" --es theme "$2" ${3:+--es tab "$3"} > /dev/null
  sleep 4.5
  if [ "$MODE" = probe ]; then
    dump launch
    if grep -q "isn't responding" /tmp/ui.xml; then adb shell input keyevent KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN KEYCODE_ENTER; sleep 3; fi
  fi
}
rec_start() { # rec_start <clip-name>: screenrecord runs in the background (time-limit is only a safety net); nothing in the probe pass
  CLIP=$1; DUMPN=0
  [ "$MODE" = probe ] && return
  adb shell rm -f "/sdcard/$CLIP.mp4"
  adb shell screenrecord --bit-rate 8000000 --time-limit 40 "/sdcard/$CLIP.mp4" &
  REC=$!
  sleep 0.8
}
rec_stop() {
  [ "$MODE" = probe ] && return
  sleep 1
  adb shell pkill -INT screenrecord || true   # SIGINT finalizes the mp4
  wait "$REC" 2>/dev/null
  sleep 1
  adb pull "/sdcard/$CLIP.mp4" "$OUT/$CLIP.mp4" > /dev/null && echo "clip $CLIP $(du -k "$OUT/$CLIP.mp4" | cut -f1) KB"
}
typewords() { local w; for w in "$@"; do adb shell input text "$w"; sleep 0.1; done; } # each arg is one input call, use %s for spaces
take() { # take <clip function> [theme]: probe pass, then the recorded replay
  MODE=probe; XY=(); "$@"
  MODE=replay; XI=0; "$@"
}

# ---- clips ---------------------------------------------------------------------------------------------------------
# One feature each, 6-15 s, light and (where it matters) dark.

clip_examiner() { # $1 theme. Part 1: tap the mic; the examiner reads the topic line and the question aloud (the question is heard, not shown); "Speak now"; the answer records.
  launch session-p1 "$1"; rec_start "01-speaking-examiner-part1-$1"
  sleep 1.2; tap_text "Start recording" 0 10.5
  rec_stop
}
clip_speaking_bands() { # $1 theme. Speaking result: band 7.0 against the target, then each criterion with its band, range and summary.
  launch result-speaking "$1" Overview; rec_start "02-speaking-result-bands-$1"
  sleep 2.2; swipe_up 1100 1.8; swipe_up 1100 1.8; swipe_up 1100 1.8
  rec_stop
}
clip_transcript() { # $1 theme. Transcript: fillers, repeat / restart tags and long pauses in place; tap a word to play from there (the word lights up as it plays); tap an underlined mistake.
  launch result-speaking "$1" Transcript; rec_start "03-speaking-transcript-highlights-$1"
  sleep 1.5; swipe_up 1100 1.6
  tap_text "Growing" 0 3.6 32 # +32: in this list the reported bounds sit about 12dp above the drawn words
  tap_text "had, Grammar" 0 3.2 32
  rec_stop
}
clip_writing_errors() { # $1 theme. Writing result, Essay: every mistake underlined in the text (red major, amber minor); open one for the correction.
  launch result-writing "$1" Essay; rec_start "04-writing-result-marked-errors-$1"
  sleep 1.8; swipe_up 1100 1.6; swipe_up 1100 1.6; swipe_up 1100 1.4
  tap_text '"Which" refers' 0 3.2
  rec_stop
}
clip_writing_bands() { # Writing result, Overview: 7.0, each criterion up on the last try, and the last try 6.0 -> 7.0 strip.
  launch result-writing light Overview; rec_start "05-writing-result-progress-light"
  sleep 2.2; swipe_up 1100 1.8; swipe_up 1100 1.8; swipe_up 1100 2.0
  rec_stop
}
clip_writing_rewrite() { # Writing result, Improve: the same essay one band higher, every change marked against yours.
  launch result-writing light Improve; rec_start "06-writing-result-rewrite-light"
  sleep 1.8; swipe_up 1100 1.6; swipe_up 1100 1.6; swipe_up 1100 1.6; swipe_up 1100 1.8
  rec_stop
}
clip_listening_start() { # Listening hub: an unfinished test offers Continue or Start new; Start new, Practice, Part 1 only, Start: the runner opens on that part.
  launch lr-hub-listening light; rec_start "07-listening-continue-or-new-single-part-light"
  sleep 1.2; tap_text "Original practice · Listening 1" 0 1.8
  tap_text "Start new" 0 1.2; tap_text "Practice" 0 0.9; tap_text "1" 0 1.0
  tap_text "Start practice part 1" 0 2.6
  rec_stop
}
clip_listening_run() { # Practice listening: play the recording (the clock runs), answer the form while it plays.
  launch lr-listening light; rec_start "08-listening-practice-run-light"
  sleep 1.2; tap_text "Play Part 1" 0 1.0
  swipe_up 900 1.0 # the form up, so the next rows stay above the keyboard
  tap_text "Question 4," 0 0.6; adb shell input text "85"; sleep 0.8
  tap_text "Question 5," 0 0.6 || adb shell input keyevent 66 # Enter = Next field
  adb shell input text "apron"; sleep 2.2
  rec_stop
}
clip_listening_result() { # $1 theme. Listening result: band and takeaways; See your mistakes; open one (the spelling slip, where it was said); its time chip: transcript marked, audio cued.
  launch lr-result-listening "$1"; rec_start "09-listening-result-explain-replay-$1"
  sleep 1.8; tap_text "See your" 0 1.6
  tap_text "Question 5," 0 2.6
  tap_text "Question 5: listen" 0 4.2
  rec_stop
}
clip_reading_location() { # Reading result: a True/False/Not Given mistake explained, then Show in passage: the answer's sentence marked in the text.
  launch lr-result light; rec_start "10-reading-result-answer-location-light"
  sleep 1.5; tap_text "See your" 0 1.4
  tap_text "Question 4," 0 1.6; swipe_up 900 1.6 # the explanation opens below the row
  tap_text "Show in passage" 0 3.6
  rec_stop
}
clip_reading_tfng() { # Reading result, Summary: where marks were lost by question type, then the True/False/Not Given pattern.
  launch lr-result light; rec_start "11-reading-result-tfng-pattern-light"
  sleep 1.5; swipe_up 1100 1.6; swipe_up 1100 1.4
  tap_text "Which statements you mix up" 0 1.6; swipe_up 1100 1.8; swipe_up 1100 2.0
  rec_stop
}
clip_review() { # $1 theme. Review deck: a Listening spelling card (Hear the word, then the spelling), graded Good; the next card comes up.
  launch review "$1" Question; rec_start "12-review-spelling-card-$1"
  sleep 1.8; tap_text "Hear the word" 0 1.8; tap_text "Show answer" 0 2.4; tap_text "Good" 0 2.4
  rec_stop
}
clip_dashboard() { # $1 theme. Home: streak, Next up, predicted bands, then the band-by-criterion trend (speaking, then writing) over three weeks.
  launch home "$1"; rec_start "13-dashboard-trend-$1"
  sleep 1.5; swipe_up 1100 1.5; swipe_up 1100 2.2
  tap_text "Writing" 0 2.4; swipe_up 1100 1.6
  rec_stop
}
clip_bank() { # Prompt bank: every question to practise; Speaking only, then search "food".
  launch bank-all light; rec_start "14-question-bank-search-light"
  sleep 1.5; swipe_up 1100 1.4; swipe_down 1100 1.0
  tap_text "Speaking" 0 1.2; tap_text "Search titles and questions" 0 0.6
  typewords "food"; sleep 2.6
  rec_stop
}
clip_part2_prep() { # Part 2: the cue card, start the minute of preparation (the ring counts down) and make notes.
  launch session light; rec_start "15-speaking-part2-prep-notes-light"
  sleep 1.2; tap_text "Start 1-minute preparation" 0 1.0
  tap_text "Notes" 1 0.6 # 0 is the label, 1 the field
  typewords "swimming%sat%s19" "%s-%scoach,%s" "small%ssteps" "%s-%sfitness%s+%s" "patience"
  sleep 1.8
  rec_stop
}
clip_writing_type() { # Writing Task 2 editor: the prompt, the timer and word count while typing.
  launch editor light; rec_start "16-writing-editor-typing-light"
  sleep 1; tap_text "Your answer" 0 0.8
  typewords "These%sdays,%s" "a%sgrowing%snumber%s" "of%syoung%speople%s" "take%sa%syear%sout%s" "before%suniversity."
  sleep 1.5
  rec_stop
}

ONLY=${ONLY:-}  # e.g. ONLY="clip_review:dark clip_bank" for a quick re-run
if [ -n "$ONLY" ]; then for c in $ONLY; do take ${c%%:*} ${c#*:}; done
else
  for t in light dark; do
    take clip_examiner $t
    take clip_speaking_bands $t
    take clip_transcript $t
    take clip_writing_errors $t
    take clip_listening_result $t
    take clip_review $t
    take clip_dashboard $t
  done
  take clip_writing_bands
  take clip_writing_rewrite
  take clip_listening_start
  take clip_listening_run
  take clip_reading_location
  take clip_reading_tfng
  take clip_bank
  take clip_part2_prep
  take clip_writing_type
fi
adb logcat -d -b crash > "$OUT/dumps/crash.txt" 2>&1 || true
ls -l "$OUT"
