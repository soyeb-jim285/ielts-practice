# Android parity with web and iOS

Status: done / partial / missing. Verified by unit tests (models against the shared fixtures, logic, wire formats) and CI screenshots in light and dark. Anything that needs a real microphone, a live server or a device is **not exercised by CI** (noted).

| Feature | Android | Notes |
| --- | --- | --- |
| Sign in, sign up, email verification code, forgot and reset password | done | `LoginScreen`; guests can browse, sign-in is required for tests and personal data |
| Bearer token storage | done | Keystore-encrypted DataStore; 401 on a non-auth call signs out |
| Guest home | done | |
| Home dashboard (next up, predicted bands, band trend, streak, criteria) | done | |
| Speaking hub (full test, live examiner, parts, pending uploads) | done | pending uploads survive failures and relaunch |
| Speaking session (mic check, Part 1/3 questions, Part 2 prep + long turn, auto stop 2:00, 15 min cap) | done | needs a device to verify recording; states are screenshotted via demo mode |
| Background upload, retry, resume across steps | done | `PendingStore` |
| Live examiner, turn-based | done | server drives phases via /api/live/turn; VAD ends turns |
| Live examiner, GPT-Live | done | our WebSocket relay `/api/live/gpt-live/ws`, bearer header, pcm16 24 kHz both ways, server-owned cues; wire format unit-tested; not run against a live server in CI |
| Live examiner, Gemini Live | done | token from /api/live/gemini-token, direct socket, session resumption |
| Fallback to turn-based when a duplex provider cannot connect | done | |
| Live settings value migration `openai-realtime` to `gpt-live`, `gptLiveAvailable` (with `realtimeAvailable` alias) | done | |
| Writing hub (full test, Task 1 academic/general, Task 2) | done | |
| Writing editor (timer from wall clock, 5/1 min warnings, word bar, plan, paste block, auto submit, drafts) | done | |
| Task 1 charts (line, bar, pie, table, process, map) | done | drawn natively |
| Result: speaking Overview, Transcript, Fluency (pace chart, markers, pauses), Language, Improve | done | audio player with seek and speed |
| Result: writing Overview, Essay, Structure, Language, Improve | done | |
| Result states: analysing, failed (retry), no speech, session (multi-part) | done | |
| Spaced-repetition review (due cards, grading) | done | |
| Mistakes log, add to deck | done | |
| History (bucketed by date, filters) | done | |
| Prompt bank (search, part, topic filters) | done | |
| Community mode: guest sessions (bearer, started at the first test), 1 test per week as a guest and per day signed in, tests left under Start, Home and Settings summary | done | `core/Community.kt`, `ui/community/`; copy from docs/community.md; unit-tested (`CommunityTest`) |
| Fair-use dialog (once per user per UTC day), limit panels (quota, balance, busy, too fast, live needs a key), draft kept when a submit is refused | done | bottom sheet (`GateHost`) |
| Community balance meter (Home, Settings, panels) | done | neutral bar, amber under 10 % |
| Settings, Your API keys (OpenRouter, OpenAI, Gemini; masked, validated by the server, replace, remove) and live provider gating | done | the key is never stored on the device |
| Guest result page ("Create an account to keep this result"), history/mistakes/review gates | done | |
| Settings (target band, models and pickers, voice, live provider, writing options, sign out, delete account) | done | |
| Theme Ocean Teal, Newsreader + Hanken Grotesk, light and dark | done | AA contrast enforced by `ContrastTest` |
| Accessibility (content descriptions, 48dp targets, reduced motion) | partial | no TalkBack pass on a device |
| Offline use | partial | pending recordings queue; screens need the network |
| Push notifications / reminders | missing | not in web or iOS either |
| Tablet / landscape layouts | partial | phone layouts scale; no two-pane |
