#!/usr/bin/env bash
# Installs the debug APK on the running emulator and screenshots each demo screen (see apps/android/.../core/Demo.kt).
set -u
APK=apps/android/app/build/outputs/apk/debug/app-debug.apk
PKG=com.soyeb.ieltspractice
mkdir -p device-shots
adb install -r "$APK"
adb shell pm grant "$PKG" android.permission.RECORD_AUDIO || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
# A slow CI emulator can make Pixel Launcher miss its ANR deadline; the "isn't responding" dialog would cover every shot.
adb shell settings put global hide_error_dialogs 1
adb shell settings put secure anr_show_background 0 || true
# hide_error_dialogs did not stop it on API 35 (every shot of one run had the dialog): take the launcher out of the picture, the app is started directly.
for l in com.google.android.apps.nexuslauncher com.android.launcher3; do adb shell pm disable-user --user 0 "$l" > /dev/null 2>&1 || true; done
sleep 8 # SystemUI restarts when the launcher goes; set the demo status bar after that
# Clean status bar: 9:41, full battery and signal.
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 > /dev/null
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false > /dev/null

# screen[:tab]
SCREENS="login guest-home guest-speaking guest-writing guest-review guest-settings guest-signin-sheet guest-result guest-history guest-recent-home guest-recent-writing guest-recent-speaking guest-recent-lr
  gate-fairuse gate-fairuse-guest gate-quota-guest gate-quota-community gate-balance gate-busy gate-live-guest gate-live-community quota-speaking-spent editor-blocked:Typing
  settings-keys:Empty settings-keys:Saved settings-keys:Stopped settings-keys:Error settings-own-key
  home speaking speaking-pending writing review settings bank history mistakes
  session-p1 session session-prep session-recording session-saving editor editor-t1 editor-full live
  result-speaking:Overview result-speaking:Transcript result-speaking:Fluency result-speaking:Language result-speaking:Improve
  result-writing:Overview result-writing:Essay result-writing:Structure result-writing:Language result-writing:Improve
  result-session result-analysing result-failed result-nospeech
  lr-hub lr-hub-listening lr-mode lr-reading lr-reading-questions lr-reading-p2 lr-navigator lr-submit lr-leave
  lr-listening lr-listening-exam lr-listening-gate lr-listening-review lr-result lr-result-p2 lr-result-listening lr-history lr-home
  lr-result-detail lr-result-detail-listening lr-result-timestamps lr-dictation lr-result-pacing mistakes-spelling dashboard-lr:LR"

for mode in light dark; do
  if [ "$mode" = dark ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  for s in $SCREENS; do
    screen=${s%%:*}; tab=${s#*:}; [ "$tab" = "$s" ] && tab=""
    name="$mode-$screen${tab:+-$tab}"
    adb shell am force-stop "$PKG"
    adb shell am start -W -n "$PKG/.MainActivity" --ez demo true --es screen "$screen" ${tab:+--es tab "$tab"} --es theme "$mode" > /dev/null
    sleep 5
    # Last resort: a system "isn't responding" dialog is dismissed with Wait, and the shot is retaken after a pause.
    if adb exec-out uiautomator dump /dev/tty 2>/dev/null | grep -q "isn't responding"; then adb shell input keyevent KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN KEYCODE_ENTER; sleep 3; fi
    adb exec-out screencap -p > "device-shots/$name.png" && echo "ok $name"
  done
done
