#!/usr/bin/env bash
# Records real interaction clips: `adb shell screenrecord` in the background while taps/swipes/text are sent with adb input.
# Taps find their target by dumping the UI (uiautomator) and reading the bounds of a text / content-description, no hardcoded coordinates.
# Demo mode (see apps/android/.../core/Demo.kt) opens each screen on fixtures. Output: device-video/*.mp4 plus dumps/ for debugging.
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
# find_xy.py <label> [n] [box]: prints "x y" (or, with a third arg, "x1 y1 x2 y2") of the n-th (0-based) node whose text or content-desc matches (exact, then prefix, then contains). Reads the uiautomator XML on stdin.
import sys, re, xml.etree.ElementTree as ET
label, n = sys.argv[1].lower(), int(sys.argv[2])
s = sys.stdin.read()
s = s[: s.rfind("</hierarchy>") + 12]
try: root = ET.fromstring(s)
except Exception: sys.exit(1)
hits = []
for e in root.iter("node"):
    t, d = (e.get("text") or "").lower(), (e.get("content-desc") or "").lower()
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", e.get("bounds") or "")
    if not m: continue
    x1, y1, x2, y2 = map(int, m.groups())
    if x2 <= x1 or y2 <= y1: continue
    sc = 0 if label in (t, d) else 1 if t.startswith(label) or d.startswith(label) else 2 if label in t or label in d else None
    if sc is not None: hits.append((sc, len(hits), (x1 + x2) // 2, (y1 + y2) // 2, x1, y1, x2, y2))
if not hits: sys.exit(1)
best = min(h[0] for h in hits)
pick = [h for h in hits if h[0] == best]
h = pick[min(n, len(pick) - 1)]
print(*(h[4:] if len(sys.argv) > 3 else h[2:4]))
PY
DUMPN=0
dump() { # UI hierarchy to $OUT/dumps (kept as an artifact) and /tmp/ui.xml
  local i
  for i in 1 2 3; do
    adb exec-out uiautomator dump /dev/tty 2>/dev/null > /tmp/ui.xml
    grep -q "</hierarchy>" /tmp/ui.xml && break
    sleep 1
  done
  DUMPN=$((DUMPN + 1)); cp /tmp/ui.xml "$OUT/dumps/$CLIP-$DUMPN-${1:-dump}.xml"
}
xy_of() { dump "${1// /_}"; python3 /tmp/find_xy.py "$1" "${2:-0}" < /tmp/ui.xml; }
tap_text() { # tap_text "Transcript" [n]
  local xy; xy=$(xy_of "$1" "${2:-0}")
  if [ -z "$xy" ]; then echo "MISS tap_text '$1'"; return 1; fi
  echo "tap '$1' at $xy"; adb shell input tap $xy; sleep "${3:-1.2}"
}
has_text() { dump "has_${1// /_}"; python3 /tmp/find_xy.py "$1" 0 < /tmp/ui.xml > /dev/null; }
swipe_up()   { adb shell input swipe $CX $((H * 72 / 100)) $CX $((H * 30 / 100)) "${1:-650}"; sleep "${2:-1}"; }  # scrolls the content down
swipe_down() { adb shell input swipe $CX $((H * 30 / 100)) $CX $((H * 72 / 100)) "${1:-650}"; sleep "${2:-1}"; }
launch() { # launch <screen> <theme> [tab]
  if [ "$2" = dark ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  adb shell am force-stop "$PKG"
  adb shell am start -W -n "$PKG/.MainActivity" --ez demo true --es screen "$1" --es theme "$2" ${3:+--es tab "$3"} > /dev/null
  sleep 4.5
  dump launch
  if grep -q "isn't responding" /tmp/ui.xml; then adb shell input keyevent KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN KEYCODE_ENTER; sleep 3; fi
}
rec_start() { # rec_start <clip-name>: screenrecord runs in the background (time-limit is only a safety net)
  CLIP=$1; DUMPN=0
  adb shell rm -f "/sdcard/$CLIP.mp4"
  adb shell screenrecord --bit-rate 8000000 --time-limit 40 "/sdcard/$CLIP.mp4" &
  REC=$!
  sleep 1.5
}
rec_stop() {
  sleep 1
  adb shell pkill -INT screenrecord || true   # SIGINT finalizes the mp4
  wait "$REC" 2>/dev/null
  sleep 1
  adb pull "/sdcard/$CLIP.mp4" "$OUT/$CLIP.mp4" > /dev/null && echo "clip $CLIP $(du -k "$OUT/$CLIP.mp4" | cut -f1) KB"
}
typewords() { local w; for w in "$@"; do adb shell input text "$w%s"; sleep 0.15; done; }

# ---- clips ---------------------------------------------------------------------------------------------------------
clip_home() { # $1 theme
  launch home "$1"; rec_start "01-home-scroll-$1"
  sleep 1.5; swipe_up 900 1.2; swipe_up 900 1.5; swipe_up 900 1.2; swipe_down 700 0.6; swipe_down 700 0.6; swipe_down 700 1
  rec_stop
}
clip_speaking_hub() {
  launch speaking light; rec_start "02-speaking-hub-light"
  sleep 1.5; swipe_up 800 1.2; swipe_down 800 1
  tap_text "Part 2" 0 3
  rec_stop
}
clip_session_recording() {
  launch session-recording light; rec_start "03-session-recording-light"
  sleep 4; swipe_up 700 1.5; swipe_down 700 3
  rec_stop
}
clip_session_live_record() { # a real recording on the emulator mic: Part 1, press the record button, the timer and level run
  launch session-p1 light; rec_start "03b-session-p1-record-light"
  sleep 2; tap_text "Start recording" 0 6
  rec_stop
}
clip_result_tabs() { # $1 theme
  launch result-speaking "$1" Overview; rec_start "04-result-tabs-$1"
  sleep 1.2; swipe_up 800 1.2; swipe_up 800 1.2; swipe_down 700 0.5; swipe_down 700 0.5
  tap_text "Transcript" 0 1.5; swipe_up 800 1.2; swipe_up 800 1.2; swipe_down 700 0.5; swipe_down 700 0.5
  tap_text "Fluency" 0 1.5; swipe_up 800 1.5; swipe_up 800 1.5
  rec_stop
}
clip_fluency_dot() { # $1 theme: scroll to the pace chart, tap mistake dots until one opens its detail card
  launch result-speaking "$1" Fluency; rec_start "05-fluency-dot-$1"
  sleep 1.2; swipe_up 700 1.2
  local box x0 y0 x1 y1 w h n=0 fx fy i
  for i in 1 2 3 4; do dump chart; box=$(python3 /tmp/find_xy.py "Words per minute over time" 0 box < /tmp/ui.xml) && break; swipe_up 700 1; done
  if [ -n "${box:-}" ]; then
    read -r x0 y0 x1 y1 <<< "$box"
    adb shell input swipe $CX $((y0 + 150)) $CX $((H * 25 / 100)) 700; sleep 1 # chart to the top, the detail card lands under it
    dump chart2; box=$(python3 /tmp/find_xy.py "Words per minute over time" 0 box < /tmp/ui.xml); read -r x0 y0 x1 y1 <<< "$box"
    w=$((x1 - x0)); h=$((y1 - y0))
    for fy in 38 48 30 58; do for fx in 14 24 34 44 54 64 74 84 93; do
      adb shell input tap $((x0 + w * fx / 100)) $((y0 + h * fy / 100)); sleep 0.5
      if has_text "Close"; then n=$((n + 1)); echo "dot hit at $fx,$fy"; sleep 2.5; tap_text "Close" 0 1; [ $n -ge 2 ] && break 2; fi
    done; done
  else echo "MISS chart"; fi
  rec_stop
}
clip_writing_type() { # $1 theme
  launch editor "$1"; rec_start "06-writing-editor-type-$1"
  sleep 1.5; tap_text "Your answer" 0 1.2
  typewords "Some" "people" "believe" "that" "children" "should" "start" "school" "later" "in" "life." "However," "I" "think" "an" "early" "start" "gives" "them" "a" "real" "advantage" "in" "learning" "to" "read" "and" "write."
  sleep 2
  rec_stop
}
clip_review() {
  launch review light Question; rec_start "07-review-reveal-light"
  sleep 2; tap_text "Show answer" 0 3; tap_text "Good" 0 2.5
  rec_stop
}
clip_settings_keys() {
  launch settings-keys light Empty; rec_start "08-settings-keys-light"
  sleep 1.5; swipe_up 700 1; tap_text "API key" 0 1.5
  typewords "sk-or-v1-demo-key-0123456789"
  sleep 1.5; swipe_down 700 1
  rec_stop
}
clip_guest_home() {
  launch guest-home light; rec_start "09-guest-home-light"
  sleep 1.5; swipe_up 900 1.3; swipe_up 900 1.5; swipe_down 800 0.8; swipe_down 800 1
  rec_stop
}

ONLY=${ONLY:-}  # e.g. ONLY="clip_review clip_home" for a quick re-run
if [ -n "$ONLY" ]; then for c in $ONLY; do ${c%%:*} ${c#*:}; done; exit 0; fi
clip_home light
clip_speaking_hub
clip_session_recording
clip_session_live_record
clip_result_tabs light
clip_fluency_dot light
clip_writing_type light
clip_review
clip_settings_keys
clip_guest_home
clip_home dark
clip_result_tabs dark
clip_writing_type dark
clip_fluency_dot dark
ls -l "$OUT"
