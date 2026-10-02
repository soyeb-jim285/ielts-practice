#!/usr/bin/env bash
# Records the iOS demo auto-tour (apps/ios/IELTS/Demo/DemoTour.swift) on a booted simulator, one clip per screen.
# Env: UDID, APP (path to IELTS.app), OUT (mp4 dir), RAW (mov dir), ONLY (optional, space-separated clip names).
# Each clip: install fresh, launch with -tour (it waits for the go signal), start recordVideo, send go, record DUR seconds, convert.
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

clip() { # name screen tab tour mode dur
  local name=$1 screen=$2 tab=$3 tour=$4 mode=$5 dur=$6
  if [ -n "${ONLY:-}" ] && ! grep -qw -- "$name" <<<"$ONLY"; then return; fi
  echo "=== $name ($screen${tab:+ $tab}, tour $tour, $mode, ${dur}s)"
  xcrun simctl ui "$UDID" appearance "$mode"
  xcrun simctl terminate "$UDID" "$BID" 2>/dev/null || true
  xcrun simctl uninstall "$UDID" "$BID" 2>/dev/null || true
  xcrun simctl install "$UDID" "$APP"
  rm -f /tmp/ielts-tour-go
  xcrun simctl launch "$UDID" "$BID" -demo -screen "$screen" ${tab:+-tab "$tab"} -tour "$tour" > /dev/null
  sleep 4
  xcrun simctl io "$UDID" recordVideo --codec h264 --force "$RAW/$name.mov" > "$RAW/$name.log" 2>&1 &
  local rpid=$!
  sleep 3
  xcrun simctl spawn "$UDID" notifyutil -p com.soyeb.ielts.tourgo || echo "notifyutil failed"
  touch /tmp/ielts-tour-go
  sleep "$dur"
  kill -INT "$rpid" 2>/dev/null; wait "$rpid" 2>/dev/null
  rm -f /tmp/ielts-tour-go
  [ -s "$RAW/$name.mov" ] || { echo "no recording for $name"; cat "$RAW/$name.log"; return; }
  # simctl only writes a frame when the screen changes: drop the first second (recorder warm-up), hold the last frame, cut to dur, constant 30 fps.
  ffmpeg -y -loglevel error -ss 1.0 -i "$RAW/$name.mov" -vf "fps=30,tpad=stop_mode=clone:stop_duration=4,format=yuv420p" -t "$((dur + 1))" -c:v libx264 -crf 20 -preset medium -movflags +faststart -an "$OUT/$name.mp4"
  ffprobe -v error -show_entries stream=width,height,r_frame_rate,duration -of csv=p=0 "$OUT/$name.mp4"
}

#    name                    screen            tab           tour     mode   dur
clip home-light              home              ""            scroll   light  12
clip speaking-hub-light      speaking          ""            scroll   light  12
clip session-p2-light        session           ""            session  light  19
clip session-p1-dark         session-p1        ""            session1 dark   13
clip result-tabs-light       result-speaking   ""            tabs     light  14
clip transcript-light        result-speaking   Transcript    karaoke  light  12
clip fluency-dark            result-speaking   Fluency       fluency  dark   12
clip writing-typing-light    editor            ""            typing   light  13
clip fair-use-light          fair-use          ""            fairuse  light  8
clip keys-settings-light     keys-settings     ""            gentle   light  10
clip keys-settings-dark      keys-settings     ""            gentle   dark   10
clip live-prescreen-light    live              ""            gentle   light  9
clip result-writing-tabs-light result-writing  ""            tabs     light  14
clip essay-lean-dark         result-writing    Essay+Lean    gentle   dark   10
clip home-dark               home              ""            scroll   dark   12
clip guest-home-light        guest-home        ""            scroll   light  12
clip mistakes-light          mistakes          ""            gentle   light  10
clip balance-light           balance           ""            gentle   light  9
ls -la "$OUT"
