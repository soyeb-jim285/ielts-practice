#!/usr/bin/env bash
# Installs the debug APK on the running emulator and screenshots each demo screen (see apps/android/.../core/Demo.kt).
set -u
APK=apps/android/app/build/outputs/apk/debug/app-debug.apk
PKG=com.soyeb.ieltspractice
mkdir -p device-shots
adb install -r "$APK"
adb shell pm grant "$PKG" android.permission.RECORD_AUDIO || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
# Clean status bar: 9:41, full battery and signal.
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false > /dev/null

# screen[:tab]
SCREENS="login guest home speaking speaking-pending writing review settings bank history mistakes
  session-p1 session session-prep session-recording session-saving editor editor-t1 editor-full live
  result-speaking:Overview result-speaking:Transcript result-speaking:Fluency result-speaking:Language result-speaking:Improve
  result-writing:Overview result-writing:Essay result-writing:Structure result-writing:Language result-writing:Improve
  result-session result-analysing result-failed result-nospeech"

for mode in light dark; do
  if [ "$mode" = dark ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  for s in $SCREENS; do
    screen=${s%%:*}; tab=${s#*:}; [ "$tab" = "$s" ] && tab=""
    name="$mode-$screen${tab:+-$tab}"
    adb shell am force-stop "$PKG"
    adb shell am start -W -n "$PKG/.MainActivity" --ez demo true --es screen "$screen" ${tab:+--es tab "$tab"} --es theme "$mode" > /dev/null
    sleep 5
    adb exec-out screencap -p > "device-shots/$name.png" && echo "ok $name"
  done
done
