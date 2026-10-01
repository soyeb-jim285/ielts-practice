# IELTS Practice for Android

Native Kotlin + Jetpack Compose app with feature, flow and styling parity with the web app (`apps/web`, the reference for features,
flow and copy) and the iOS app (`apps/ios`). Package `com.soyeb.ieltspractice`, minSdk 26, target/compile SDK 36.

> **Android is built only on GitHub Actions.** Never run `./gradlew`, an emulator or `adb` on a dev laptop. See [CI](#ci-and-how-to-verify).

## Stack

Kotlin 2.2, Compose BOM 2025.12 (Material 3 with a custom theme, no dynamic colour), Navigation Compose (type-safe routes),
OkHttp + kotlinx.serialization, DataStore + Android Keystore for the bearer token, MediaRecorder (AAC `.m4a`) for recording,
Media3 ExoPlayer for playback. Tests: JUnit, Robolectric, Roborazzi. Versions live in `gradle/libs.versions.toml`.

## Architecture

```
app/src/main/kotlin/com/soyeb/ieltspractice/
  MainActivity.kt, IeltsApplication.kt   entry points (edge-to-edge, demo launch extras)
  AppContainer.kt                         ApiClient + PendingStore (+ demo wiring); `LocalApp`, `LocalDemo`
  core/                                   no UI
    Models.kt                             @Serializable port of iOS Core/Models.swift
    Json.kt                               AppJson (lenient) + decodeList ({items|cards|models|data} or bare list)
    ApiClient.kt                          OkHttp client, bearer token, auth flows, shared flows (settings, submitSpeaking, addCard)
    TokenStore.kt                         Keystore-encrypted token in DataStore (MemoryTokenStore for demo/tests)
    PendingUploads.kt                     PendingStore: finished recordings survive failures and relaunches
    Demo.kt                               DemoConfig (launch extras), DemoFixtures, DemoInterceptor
    Band.kt, Format.kt                    port of packages/core band.ts, iOS Band/Theme helpers (Crit, clock, fmt, categoryLabel)
  audio/Recorder.kt, Player.kt            MediaRecorder m4a, Media3 ExoPlayer wrappers
  ui/
    IeltsApp.kt                           theme + NavHost + bottom bar (5 tabs)
    ScreenScaffold.kt                     the frame every screen uses (top app bar, gutters, scrolling)
    Load.kt                               rememberLoad / LoadContent: fetch with loading, error and retry
    nav/Routes.kt                         type-safe routes, one per iOS `Route` case
    nav/AppNav.kt                         Tab enum + AppNav (go, back, openTab, requireSignIn)
    nav/ScreenCatalog.kt                  every screen by demo name: drives demo launch AND screenshot tests
    theme/                                Color, Type, Shape, Theme, Components
    screens/                              one file per screen (placeholders today)
app/src/test/                             CoreTest, ContrastTest, ScreenshotTest
```

Auth model: guests browse; signing in is needed only to take a test or for personal data. `ApiClient.token`/`me` are
`StateFlow`s. A screen that needs an account wraps its action: `nav.requireSignIn { nav.go(SpeakingSession("full")) }`, which opens
`Login` for guests. A 401 on any non-auth call signs the user out locally. The server URL is fixed (`ApiClient.SERVER`, `https://ielts.soyebjim.me`); there is no setting.

## Theme (Ocean Teal)

`ui/theme/` is the single source for look and feel. Tokens match `DESIGN.md` / `docs/design-system.md`, the web `styles.css` and iOS `Theme.swift`.

- Colour: `MaterialTheme.colorScheme` (primary = brand teal, container = brand-soft, outline = AA control edge) plus
  `MaterialTheme.ext` for the rest: `bg surface surface2 ink muted line brand brandSoft onBrand good goodText warn warnText bad badText sky`.
  Teal only means "act here / you are here". Green/amber/rose are band thresholds and real errors. `sky` is for charts only.
- Type: Newsreader (serif) for display, headline and `titleLarge` (page and section titles) and `AppText.reading` for essays/transcripts;
  Hanken Grotesk for everything else. Both are bundled variable fonts (SIL OFL 1.1, licences in `assets/licenses/`). Numbers: `AppText.band(size)`, `AppText.num`.
- Shape: cards 16dp with a 1dp `line` border (`AppCard`), controls 8dp (`ControlShape`).
- Components: `AppCard`, `SectionTitle`, `BandPill`, `Chip`, `ChipRow` (FlowRow), `ErrorLine`, `PrimaryButton`, `SecondaryButton`,
  `bandColor` / `bandTextColor`. Use these instead of raw Material components.
- Android conventions kept: edge-to-edge, large collapsing top app bar on tab roots and small bar + back arrow on pushed screens,
  Material navigation bar (selected tab = brand-soft pill), predictive back (`enableOnBackInvokedCallback`), adaptive + monochrome icon.
  No decorative animation (screen changes are 120ms fades); keep it that way and respect reduced motion.
- `ContrastTest` fails the build if a token pair drops below WCAG AA.

## Adding or building a screen

Every screen already exists as a placeholder, so you almost always **replace the body** of an existing file.

1. Open `ui/screens/<Name>Screen.kt` (the header comment names the iOS view and web route to mirror; table below).
2. Delete the `PlaceholderScreen(...)` call and write the screen with `ScreenScaffold(title, large = <tab root>, onBack = nav::back) { ... }`.
   Keep the composable's name and parameters: `AppNavHost` calls them.
3. Load data with `rememberLoad` and the client from `LocalApp.current.api`:
   ```kotlin
   val api = LocalApp.current.api
   val attempt = rememberLoad(id) { api.get<Attempt>("/api/attempts/$id") }
   LoadContent(attempt) { a -> AppCard { SectionTitle(a.prompt.title); BandPill(a.analysis?.overall ?: 0.0) } }
   ```
   Lists: `api.getList<ReviewCard>("/api/cards/due")`. Writes: `api.send<Created>("POST", "/api/attempts", buildJsonObject { put("promptId", id) })`.
   Models missing from `Models.kt` (iOS keeps a few view-local ones: `BankPage`, `BankMeta`, `DueResponse`, `TtsModel`) go next to the screen as `@Serializable`.
4. Navigate with `AppNav` only: `nav.go(AttemptResult.of(id))`, `nav.back()`, `nav.openTab(Tab.Review)`, `nav.requireSignIn { ... }`.
5. **A new route** (rare): add a `@Serializable` class to `ui/nav/Routes.kt`, a `composable<...>` line in `ui/IeltsApp.kt`, a row in `ScreenCatalog.kt`.
6. **Screenshot it**: add or edit a row in `ui/nav/ScreenCatalog.kt`. `variants = listOf("Overview", "Transcript")` adds one shot per
   sub-tab (the iOS `-tab` argument); read it in the screen with `LocalDemo.current?.tab`. If the screen needs data the fixtures lack,
   extend `apps/ios/scripts/gen-demo-fixtures.mjs` (shared with iOS) and regenerate `apps/ios/IELTS/Demo/fixtures.json`.
7. Push, watch CI, look at the PNGs (below). Keep copy identical to web/iOS.

| Android screen file | Route | iOS view | Web route |
| --- | --- | --- | --- |
| `LoginScreen` | `Login` | `Views/LoginView.swift` | `login.tsx`, `signup.tsx`, `forgot-password.tsx` |
| `DashboardScreen` | `HomeTab` | `Views/DashboardView.swift` | `_app/index.tsx` |
| `SpeakingHomeScreen` | `SpeakingTab` | `Views/SpeakingHomeView.swift` | `_app/speaking/index.tsx` |
| `WritingHomeScreen` | `WritingTab` | `Views/WritingHomeView.swift` | `_app/writing/index.tsx` |
| `ReviewScreen` | `ReviewTab` | `Views/ReviewView.swift` | `_app/review.tsx` |
| `SettingsScreen` | `SettingsTab` | `Views/SettingsView.swift` | `_app/settings.tsx` |
| `SpeakingSessionScreen` | `SpeakingSession` | `Views/SpeakingSessionView.swift` | `_app/speaking/session.tsx` |
| `LiveExamScreen` | `LiveExam` | `Views/LiveExamView.swift` | `_app/speaking/live.tsx`, `live/` |
| `WritingEditorScreen` | `WritingEditor` | `Views/WritingEditorView.swift` | `_app/writing/task.$promptId.tsx`, `full.tsx` |
| `ResultScreen` | `AttemptResult` | `Views/ResultView.swift` (+ Fluency, Transcript, Chart views) | `_app/{speaking,writing}/result.$attemptId.tsx` |
| `BankScreen` | `Bank` | `Views/BankView.swift` | `_app/bank.tsx` |
| `HistoryScreen` | `History` | `Views/HistoryView.swift` | `_app/history.tsx` |
| `MistakesScreen` | `Mistakes` | `Views/MistakesView.swift` | `_app/mistakes.tsx` |

## Recording, playback and uploads

`audio/Recorder` writes `.m4a` (AAC, mono) into `PendingStore.audioFile(id)`; ask for RECORD_AUDIO first. When recording stops,
`pending.add(PendingRecording(...))` then `pending.start(rec, api)`: the store creates the attempt, PUTs the audio and submits,
saving progress after each step so a retry resumes. Watch `pending.states` (`Uploading | Failed | Done`). `audio/AudioPlayer` wraps ExoPlayer
(release it when the screen leaves). The live examiner (GPT-Live through our WebSocket relay, Gemini Live, or turn-based) lives in `live/`; the AI itself always goes through the server.

## Demo mode and screenshots

Demo mode answers every request from `apps/ios/IELTS/Demo/fixtures.json` (synthetic data, shared with iOS; a Gradle task copies it into the
app assets at build time). `DemoInterceptor` uses the same lookup as iOS: exact `path?sorted-query`, then the bare path; writes return `{}`.
Launch extras (the iOS `-demo -screen -tab` equivalents):

```
adb shell am start -n com.soyeb.ieltspractice/.MainActivity --ez demo true --es screen result-speaking --es tab Overview --es theme dark
```

`ScreenshotTest` renders every row of `screenCatalog` in light and dark at 412x915dp with Roborazzi on Robolectric (JVM, no emulator) into
`apps/android/screenshots/<theme>-<screen>[-<tab>].png` (gitignored; CI uploads them).

## CI and how to verify

Only `.github/workflows/android.yml` builds Android (ubuntu-latest). It runs on pushes touching `apps/android/**` (or the shared fixtures)
and on manual dispatch, doing one Gradle run: `assembleDebug assembleRelease recordRoborazziDebug` (debug and release APKs, all unit tests,
screenshots). Artifacts: `IELTS-android-debug-apk`, `android-screens`, and `android-test-reports` on failure.

```bash
git add apps/android && git commit -m "..." && git pull --rebase --autostash && git push
gh run list --workflow android.yml -L 1
gh run watch <id> --exit-status
gh run view <id> --log-failed                       # on failure
gh run download <id> -n android-screens -D /tmp/android-screens   # then look at the PNGs
gh run download <id> -n IELTS-android-debug-apk -D /tmp/apk
```

Batch changes so each CI round counts. Bump versions together in `gradle/libs.versions.toml` and let CI prove the set.
