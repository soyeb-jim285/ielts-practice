#!/usr/bin/env bash
# Records the iOS demo auto-tour (apps/ios/IELTS/Demo/DemoTour.swift) on a booted simulator, one clip per screen.
# Env: UDID, APP (path to IELTS.app), OUT (mp4 dir), RAW (mov dir), ONLY (optional, space-separated clip names), MODES (default "light dark").
# Each clip: install fresh, launch with -tour (it waits for the go signal), start recordVideo, send go once it records, record DUR seconds, convert.
set -u
BID=com.soyeb.ieltspractice
mkdir -p "$OUT" "$RAW"
# No "slide to type" first-run card over the keyboard, no predictive bar.
for k in DidShowContinuousPathIntroduction DidShowGestureKeyboardIntroduction KeyboardDidShowContinuousPathIntroduction; do
  xcrun simctl spawn "$UDID" defaults write com.apple.keyboard.preferences "$k" -bool true || true
done
for k in KeyboardPrediction KeyboardAutocorrection KeyboardContinuousPathEnabled; do
  xcrun simctl spawn "$UDID" defaults write com.apple.keyboard.preferences "$k" -bool false || true
done

clip() { # name screen tab tour dur: records the clip once per appearance in MODES, as <name>-light.mp4 and <name>-dark.mp4
  local name=$1 screen=$2 tab=$3 tour=$4 dur=$5 mode
  if [ -n "${ONLY:-}" ] && ! grep -qw -- "$name" <<<"$ONLY"; then return; fi
  for mode in ${MODES:-light dark}; do record "$name-$mode" "$screen" "$tab" "$tour" "$mode" "$dur"; done
}

record() { # name screen tab tour mode dur
  local name=$1 screen=$2 tab=$3 tour=$4 mode=$5 dur=$6
  echo "=== $name ($screen${tab:+ $tab}, tour $tour, ${dur}s)"
  xcrun simctl ui "$UDID" appearance "$mode"
  xcrun simctl terminate "$UDID" "$BID" 2>/dev/null || true
  xcrun simctl uninstall "$UDID" "$BID" 2>/dev/null || true
  xcrun simctl install "$UDID" "$APP"
  rm -f /tmp/ielts-tour-go
  xcrun simctl launch "$UDID" "$BID" -demo -screen "$screen" ${tab:+-tab "$tab"} -tour "$tour" > /dev/null
  sleep 4
  xcrun simctl io "$UDID" recordVideo --codec h264 --force "$RAW/$name.mov" > "$RAW/$name.log" 2>&1 &
  local rpid=$! i
  # recordVideo takes a few seconds to really start: send the go signal only once it says so, or the tour's first seconds are lost.
  for i in $(seq 1 60); do grep -q "Recording started" "$RAW/$name.log" 2>/dev/null && break; sleep 0.25; done
  sleep 1.5
  xcrun simctl spawn "$UDID" notifyutil -p com.soyeb.ielts.tourgo || echo "notifyutil failed"
  touch /tmp/ielts-tour-go
  sleep "$dur"
  kill -INT "$rpid" 2>/dev/null; wait "$rpid" 2>/dev/null
  rm -f /tmp/ielts-tour-go
  [ -s "$RAW/$name.mov" ] || { echo "no recording for $name"; cat "$RAW/$name.log"; return; }
  # simctl only writes a frame when the screen changes: keep 1 s before the go signal, hold the last frame, cut to dur + 1 s at a constant 30 fps.
  ffmpeg -y -loglevel error -ss 0.5 -i "$RAW/$name.mov" -vf "fps=30,tpad=stop_mode=clone:stop_duration=6,format=yuv420p" -t "$((dur + 1))" -c:v libx264 -crf 20 -preset medium -movflags +faststart -an "$OUT/$name.mp4"
  ffprobe -v error -show_entries stream=width,height,r_frame_rate,duration -of csv=p=0 "$OUT/$name.mp4"
  rm -f "$RAW/$name.mov"
}

# One feature per clip, each recorded light and dark. Tours live in apps/ios/IELTS/Demo/DemoTour.swift.
#    name                                   screen               tab         tour              dur
clip dashboard-band-trend                    home                 ""          dashboard         13
clip speaking-hub-question-source            speaking             ""          speaking-hub      11
clip speaking-part1-examiner-asks            session-p1           ""          speaking-part1    14
clip speaking-part2-cue-card-prep            session              ""          speaking-part2    14
clip speaking-result-bands                   result-speaking      ""          result-overview   13
clip speaking-transcript-playback            result-speaking      Transcript  transcript        13
clip speaking-fluency                        result-speaking      Fluency     fluency           12
clip speaking-language-band-higher           result-speaking      Language    language-improve  13
clip live-examiner                           live                 ""          live              14
clip writing-task1-chart                     editor-t1            ""          task1             14
clip writing-task2-typing                    editor               ""          task2             13
clip writing-result-bands                    result-writing       ""          writing-overview  12
clip writing-result-marked-errors            result-writing       Essay       essay             13
clip writing-result-band-higher-rewrite      result-writing       Improve     rewrite           13
clip listening-test-form-gaps                lr-listening         ""          lr-run            13
clip listening-result-explanations           lr-result-listening  ""          lr-answers        13
clip listening-result-timestamp-transcript   lr-result-listening  ""          lr-timestamp      12
clip listening-result-dictation              lr-result-listening  ""          lr-dictation      14
clip reading-test-tfng                       lr-reading           ""          reading-run       14
clip reading-result-answer-location          lr-result-answers    ""          reading-location  12
clip lr-single-part-continue-or-new          lr-hub-listening     ""          single-part       14
clip review-cards-hear-the-word              review               ""          review            13
clip history                                 history              ""          history           11
clip question-bank-source                    bank                 ""          bank              11
ls -la "$OUT"
