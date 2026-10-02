# Community mode

The app is a community project: everyone can practise for free from one shared OpenRouter balance (the owner's key, with a spend limit). Heavy users and the live examiner run on their own API keys. This file is the contract between the server and the web, iOS and Android clients. The OpenAPI document (`/openapi.json`, `apps/web/src/openapi.json`) has the schemas; this file has the rules, the flows and the copy.

## Rules

| Who | Speaking tests | Writing tests | Live examiner | Paid from |
| --- | --- | --- | --- | --- |
| Guest (anonymous session, no account) | 1 per week | 1 per week | No | Community balance |
| Signed in, no own keys | 1 per day | 1 per day | No | Community balance |
| Signed in + own OpenRouter key | Unlimited | Unlimited | Turn-based live only | Their key |
| Signed in + own OpenAI and/or Gemini key | Per their OpenRouter status (above) | Same | GPT-Live with the OpenAI key, Gemini Live with the Gemini key | Their key |
| Owner (`CAMBRIDGE_ALLOWED_EMAILS`, verified email) | Unlimited | Unlimited | All three (server keys) | Server keys |

- **Tier** (`tier` in `/api/me` and `/api/quota`): `guest`, `community` (signed in, no OpenRouter key) or `own-key` (has a working OpenRouter key, or is the owner). Having only an OpenAI or Gemini key keeps you on `community` for the 1-per-day tests, but unlocks that live provider. A user with an OpenAI key and no OpenRouter key can run a live session; its analysis is paid from the community balance, so it uses their daily speaking test and is checked at start.
- **Live examiner is never paid from the community balance.** Turn-based live (STT, LLM and TTS through OpenRouter) needs the user's own OpenRouter key. GPT-Live needs an OpenAI key, Gemini Live a Gemini key.
- **One test** is one speaking session (one practice part, or a full test with all parts sharing one `sessionId`) or one writing submission (one task, or Task 1 + Task 2 sharing one `sessionId`). Clients MUST send the same `sessionId` on every attempt of a full test. A part is paid once per `sessionId`: sending a part again under another attempt (even after deleting the first) counts as a separate test, and retrying the same attempt is free. Concurrent submits are serialised.
- **Reserved at submit** (`POST /api/attempts/{id}/submit`, and `POST /api/live/finish`), checked earlier at start (`POST /api/attempts`, `POST /api/live/start`, and `GET /api/quota`). A speaking session is reserved when its first part is submitted.
- **Refunded automatically** when the analysis fails (status `failed`, including interrupted runs) or when no speech was heard (`analysis.noSpeech`). For a full test it is refunded only if no other part still counts. A user (for guests: an IP) gets at most 5 refunds per 24 h; past that the test stays spent, so failures and silent recordings cannot be an endless free retry loop. Re-submitting the same attempt (the retry button) reserves it again from the refund, so it is never charged twice; if the quota was used elsewhere in the meantime the retry gets 429 and the attempt (with its draft) stays.
- **Windows:** daily resets at 00:00 UTC; weekly resets Monday 00:00 UTC. `resetAt` is an ISO instant: show it in local time ("Resets in 5 h", "Resets Monday 6:00").
- **Guest abuse guard:** the weekly limit applies per anonymous user (1) AND per client IP (`GUEST_IP_WEEKLY_CAP`, default 3, per skill, across all anonymous users). Both must have room. The IP is the `CF-Connecting-IP` header (Cloudflare Tunnel; `X-Forwarded-For` is ignored when it is present), else the last `X-Forwarded-For` hop (the one our proxy wrote), else the socket address; values that are not an IP are ignored, IPv6 is counted per /64, and it is stored only as a salted HMAC. A guest who signs up keeps counting against the IP for that week.
- **Community-paid analysis always uses the default models.** A custom analysis/examiner/STT/TTS model in Settings applies only with the user's own OpenRouter key (so nobody burns the shared balance on a pricey model). Say so next to the model pickers for community users.
- **With an own OpenRouter key every OpenRouter call uses that key** (analysis, scoring, STT, TTS, audio pronunciation), and ElevenLabs Scribe is skipped (Whisper on their key instead; Scribe stays on the server key for community users).
- **Retention:** guest data (attempts, recordings) is deleted 30 days after the anonymous user was created. Say "Create an account to keep this result".

## Community balance

`GET /api/community/balance` (public, no auth, cached 60 s on the server, last known value if OpenRouter is unreachable):

```json
{ "limit": 20, "used": 7.6, "remaining": 12.4, "updatedAt": "2026-10-03T10:15:00.000Z" }
```

USD. `limit`/`remaining` are `null` when the key has no spend limit or the value is unknown (then nothing is blocked). Below `COMMUNITY_MIN_BALANCE` (default 0.25) community tests are blocked (402). The same object is `communityBalance` in `/api/me` and `/api/quota`.

## API contract

All JSON, bearer or cookie auth as everywhere else. Errors with a `code` look like `{ "error": "<friendly sentence>", "code": "<code>", ... }`: map `code` to UX, show `error` only as a fallback.

### `GET /api/quota` (session optional)

Call it when a test is about to start (and to render the "N tests left" labels). Without a session it answers for a guest by IP.

```json
{
  "tier": "guest | community | own-key",
  "speaking": { "used": 0, "limit": 1, "remaining": 1, "resetAt": "2026-10-05T00:00:00.000Z", "window": "week", "blocked": null },
  "writing":  { "used": 1, "limit": 1, "remaining": 0, "resetAt": "2026-10-04T00:00:00.000Z", "window": "day", "blocked": "quota_exceeded" },
  "liveProviders": ["turn", "gpt-live", "gemini-live"],
  "communityBalance": { "limit": 20, "used": 7.6, "remaining": 12.4, "updatedAt": "..." }
}
```

- `limit`, `remaining`, `resetAt`, `window` are `null` for `own-key` (unlimited). `window` is `"day"` or `"week"`.
- `blocked` is why a test of that skill cannot start now: `quota_exceeded`, `community_balance_exhausted` or `community_busy`; `null` means go.
- `liveProviders` lists the live examiners this user may use: `turn` (own OpenRouter key), `gpt-live` (OpenAI key), `gemini-live` (Gemini key). The owner gets all three.

### `GET /api/me` (session required; guests have one)

As before plus everything in `/api/quota` (same field names, same shapes), and:

- `user.isAnonymous: boolean` (a guest). For a guest `user.email` is `""`; never show it.
- `gptLiveAvailable` / `geminiLiveAvailable`: this user has an OpenAI / Gemini key (or is the owner). `realtimeAvailable` is the deprecated alias of `gptLiveAvailable`. Turn-based availability is `liveProviders.includes("turn")`.

### Keys (account required)

`GET /api/keys` → `{ "keys": [{ "provider": "openrouter", "last4": "ab12", "addedAt": "ISO", "valid": true }] }` (providers `openrouter`, `openai`, `gemini`; only those that are set). The key itself is never returned.

`PUT /api/keys/{provider}` with `{ "key": "sk-..." }` (8-512 characters, no spaces). The server checks the key with a free call (OpenRouter `GET /api/v1/key`, OpenAI `GET /v1/models`, Gemini `GET /v1beta/models`) before saving; it is stored AES-256-GCM encrypted. Returns the same object as one entry of `GET /api/keys`. Errors: `400 invalid_key` (provider rejected it), `502 key_check_failed` (provider unreachable, try again), `503 keys_unavailable` (server has no `KEY_ENCRYPTION_SECRET`), `403 account_required` (guest), `429` too many tries (5 checks per client address, then 1 per 30 s, so the server is no key-testing oracle). A replaced key overwrites the old one.

`DELETE /api/keys/{provider}` → `{ "ok": true }` (also when none was set).

`valid: false` means the provider rejected the saved key during use (401/403). That key is ignored (the user is back on the community tier for that provider) until they enter a new one: show "This key stopped working. Enter a new one." with the entry field.

### Guest sessions (Better Auth anonymous plugin)

`POST /api/auth/sign-in/anonymous` with body `{}` (and `Content-Type: application/json`). Creates a guest user and session. Call it on the first test start (when `/api/me` or `/api/quota` says the person has no session and they press Start), never on page view. Limited to 15 per IP burst, then 1 per 30 s (`429 too_many_requests`).

- **Web (cookie):** `fetch('/api/auth/sign-in/anonymous', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })`. The session cookie is set; nothing to store. (Better Auth's client: `authClient.signIn.anonymous()`.)
- **iOS / Android (bearer):** same request without cookies. Read the token from the **`set-auth-token` response header** and store it like a normal sign-in token (Keychain / encrypted storage); send `Authorization: Bearer <token>` afterwards. (The `token` field in the JSON body is the raw session token, not the signed bearer value; use the header.) Also keep a flag that this token is a guest (`/api/me` → `user.isAnonymous`).
- A guest token works on: `/api/me`, `/api/quota`, prompts, `/api/speaking/test`, creating/submitting attempts, `GET /api/attempts/{id}` (their own result page), `GET /api/attempts/{id}/status`, `DELETE /api/attempts/{id}`.
- A guest token gets `403 { code: "account_required" }` on history (`GET /api/attempts`), mistakes, cards, progress, `PUT /api/settings` and `/api/keys`. Show "Create an account" gates there, not an error. It must NOT be treated as an expired session.
- Live endpoints answer `403 live_requires_own_key` with `tier: "guest"`.

#### Linking a guest to an account

When a guest signs up or signs in, their attempts, recordings, live sessions, mistakes and used quota move to the real account, and the guest user is deleted. The server does it when the sign-up/sign-in/verification request arrives **with the guest's credentials**, so:

- **Web:** nothing to do; the guest cookie is sent automatically on `POST /api/auth/sign-up/email`, `/sign-in/email` and `/email-otp/verify-email` (use `credentials: 'include'`).
- **iOS / Android:** send `Authorization: Bearer <guest token>` on `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email` and `POST /api/auth/email-otp/verify-email`. **Keep the guest token until the new account's token has been received**, then replace it with the new `set-auth-token`.
- In production sign-up needs email verification: `sign-up/email` then returns no session and no `set-auth-token`. The link happens on the `email-otp/verify-email` call (that call returns the new session and `set-auth-token`). So the guest token must still be attached to the verify call. Until then the guest session keeps working.
- After linking, the old guest token is invalid (401). Switch to the new token before the next request.
- An analysis that is already running when the guest signs up finishes on the new account: results, mistakes and any refund follow the attempt's current owner. A live finish that is sent twice never reserves twice (the second answers 409).
- The guest's used test counts in the new account's window (a guest who tested today is a community user with today's test used) and, for the guest week, in the IP cap.

### Errors

| Status | `code` | When | Body fields |
| --- | --- | --- | --- |
| 429 | `quota_exceeded` | No test left in the window (at `POST /api/attempts`, at submit, at `/api/live/start`, at `/api/live/finish`) | `skill`, `resetAt` (ISO), `tier` |
| 402 | `community_balance_exhausted` | The shared balance is below the floor (community and guest tests only) | |
| 503 | `community_busy` | More than `COMMUNITY_MAX_PER_HOUR` community tests started this hour across all users | |
| 429 | `too_many_requests` | Per-IP burst limit (20 attempt creates/submits, then 1 per 3 s) or anonymous sign-in limit | |
| 403 | `live_requires_own_key` | A live endpoint without the matching own key (turn: OpenRouter; GPT-Live: OpenAI; Gemini Live: Gemini). Guests too | `tier` |
| 403 | `account_required` | A guest on a sign-in-only endpoint | |
| 400 | `invalid_key` | PUT key rejected by the provider; also when GPT-Live/Gemini rejected a saved key at session start (that key is flagged `valid: false`) | |
| 502 | `key_check_failed` | Provider could not be reached to check the key | |
| 503 | `keys_unavailable` | Server has no `KEY_ENCRYPTION_SECRET` | |

`POST /api/attempts` and `POST /api/live/start` run the same quota/balance/busy checks as submit without reserving anything, so people hear "no tests left" before they write the essay. When a writing submit is refused, a `text`/`plan` sent in the request body is still saved on the attempt (status stays `recording`), so nothing typed is lost.

Analysis failures with the user's own key say so on the attempt (`error`, `retryable: false`): "Your OpenRouter key is out of credit..." or "...was rejected".

### Live gating

`/api/live/start` (`skipTts: false` = turn-based needs an own OpenRouter key; `skipTts: true` = GPT-Live/Gemini Live needs an OpenAI or Gemini key), `/api/live/turn` (OpenRouter key), `/api/live/gpt-live/session` and `/api/live/gpt-live/ws` (OpenAI key; the relay opens the upstream connection with the user's key), `/api/live/gemini-token` (Gemini key). The server never uses its own `OPENAI_API_KEY`/`GEMINI_API_KEY` for non-owner users. Clients hide or disable live providers that are not in `liveProviders` and point to Settings → "Your API keys".

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `KEY_ENCRYPTION_SECRET` | none | Encrypts saved user keys (AES-256-GCM, HKDF-derived key, per-row random IV; the user id and provider are authenticated data). **Set it in production** (`openssl rand -hex 32`, at least 32 characters; a shorter one is ignored), separate from `BETTER_AUTH_SECRET`. Without it production refuses to save keys (`503 keys_unavailable`); dev and tests fall back to a key derived from `BETTER_AUTH_SECRET`. Changing it makes saved keys unreadable (users re-enter them). |
| `COMMUNITY_MIN_BALANCE` | `0.25` | USD. Community tests are blocked below this remaining balance. |
| `COMMUNITY_MAX_PER_HOUR` | `60` | Community-paid test reservations per rolling hour across all users; above it `community_busy`. Refunded tests do not count. |
| `GUEST_IP_WEEKLY_CAP` | `3` | Guest tests per skill per IP per week across anonymous users. |
| `IP_HASH_SALT` | derived from `BETTER_AUTH_SECRET` | Salt for the IP hash. Raw IPs are never stored. |
| `OPENROUTER_API_KEY` | | The shared community key. Give it a spend limit in OpenRouter (about $20): its `limit` and `usage` are the public balance. |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` | | Server keys. OpenAI/Gemini are used only for the owner's live sessions; ElevenLabs only for users without their own OpenRouter key. |
| `CAMBRIDGE_ALLOWED_EMAILS` | `soyebjim@gmail.com` | The owner: exempt from quotas, may use the server's live keys. Needs a verified email. |

## Database

Migration `0004_community`: `user.is_anonymous`, `user_api_keys` (encrypted keys), `quota_usage` (one row per paid test: user, skill, unit key, tier, IP hash, created, refunded). The server sweeps guests older than 30 days every 6 hours.

## Client UX requirements

Common to web, iOS and Android; copy is sentence case and the same everywhere.

1. **Browse freely.** Guests can open every prompt and the test screens. No session is created until Start.
2. **Start button with remaining quota.** Fetch `GET /api/quota` when the test screen opens (and again at Start). Under or inside the Start button: "1 test left today" / "1 test left this week" / "No tests left. Resets Monday 6:00" / "Unlimited with your key". Use `window` and `resetAt` (local time). Reset phrase, identical on every platform: up to a minute away "in a moment"; under an hour "in N min" (minutes rounded up); under a day "in N h" (hours rounded to the nearest, at least 1); otherwise the local weekday and 24-hour time ("Monday 6:00"). Speaking and writing are separate counters. Refresh the numbers after a submit and after an analysis ends (a refund changes them).
3. **Blocked before they start** (`blocked` not null, or 429/402/503 on `POST /api/attempts` / live start): never begin recording or typing. Show one panel with the reason and the way out. Titles and bodies are the same on every platform ({when} is the reset phrase from 2):

   | Code | Title | Body | Primary | Secondary |
   | --- | --- | --- | --- | --- |
   | `quota_exceeded`, guest | You've used this week's free test | It resets {when}. | **Create an account for 1 test a day** | not now |
   | `quota_exceeded`, community | You've used today's free test | It resets {when}. | **Add your own key** (→ Settings → Your API keys) | wait |
   | `community_balance_exhausted` | The community balance is used up for now | Free tests are paid from one shared balance, and it has run out. Add your own OpenRouter key to keep practising, or try again later. (Guests: "Create an account, then add your own OpenRouter key to keep practising, or try again later.") | **Add your own OpenRouter key**; guests **Create an account** (they cannot hold keys) | not now |
   | `community_busy` | A lot of people are practising right now | Try again in a few minutes. | none | close |
   | `live_requires_own_key` | The live examiner runs on your own key | Guests: "Create an account, then add your own OpenAI or Gemini key in Settings." Signed in: "Add your own key in Settings: OpenRouter for the turn-based examiner, OpenAI for GPT-Live, Gemini for Gemini Live." (or "Add your own {provider} key in Settings." when the provider is known) | **Create an account** / **Add your own key** | not now |
   | `too_many_requests` | You're going a bit fast | Try again in a moment. | none | close |

   Where there is only room for a sentence (a refused upload), use "{title}. {body} {what was kept}".

4. **Fair-use dialog** before a test that will use the community balance (tier `guest` or `community`, `blocked` null), shown once per user per day (remember the acknowledgement locally per user id, or per device for guests, per UTC day). Web: shadcn Dialog/AlertDialog; iOS: a sheet; Android: ModalBottomSheet or AlertDialog.
   - Title: **You're using the community balance**
   - Body: "This test is paid from a shared balance that everyone uses. Please don't abuse it: no spamming tests and no automated use. You have {N} {speaking|writing} test{s} left {today|this week}. The community balance has ${remaining} left. Want unlimited tests and the live examiner? Add your own API key in Settings." (Guests: replace the last sentence with "Create an account for 1 test a day.")
   - Buttons: **Start test** (primary), **Use my own key** (secondary, → Settings; for guests **Create an account**).
5. **Balance meter.** A compact "Community balance $12.40 of $20" with a thin bar (`remaining` of `limit`; hide the number if `remaining` is null) in the web sidebar/header, the mobile home and Settings, and inside the fair-use dialog and blocked panels. Teal is for "act here", so draw the meter in a neutral/muted tone, switching to the warning tone under 10 %. Always give it a text alternative; it refreshes at most once a minute.
6. **Quota ran out mid-test** (a second tab, the window rolled, the balance ran out): the submit returns 429/402/503. Keep the draft on screen (the server also keeps writing text), say what happened and when it resets, and offer the same way out as in 3. Do not discard anything.
7. **After submit failures that were refunded** (analysis failed, no speech): say "This one didn't count against your tests." The retry button re-submits the same attempt.
8. **Guest result.** The result page of a guest's own test works. Show "Create an account to keep this result" (results are kept 30 days). History, Mistakes and Review show a friendly gate ("Create an account to see your history") instead of calling their endpoints, and map `403 account_required` to the same gate if a call happens anyway. Settings for guests: no keys section.
9. **Settings → Your API keys** (signed in only): three rows (OpenRouter, OpenAI, Gemini), each: provider, what it unlocks ("Unlimited tests" for OpenRouter; "GPT-Live examiner" for OpenAI; "Gemini Live examiner" for Gemini), a masked field, **Save** (calls `PUT`, shows "Checking your key..."), after saving "•••• ab12, added Oct 3" with **Replace** and **Remove**. Show `invalid_key` as "OpenAI didn't accept that key. Check that you copied all of it." and `key_check_failed` as "Couldn't reach OpenAI to check the key. Try again." `valid: false` rows show "This key stopped working." Say plainly: "Your key is stored encrypted on our server and only used for your tests. Remove it any time."
10. **Live provider pickers** show only what `liveProviders` allows; the rest are disabled with "Needs your own {provider} key" and a link to Settings. A saved `liveProvider` that is no longer allowed falls back to turn-based if allowed, else shows the blocked panel.
11. **After sign-in or sign-up**, refetch `/api/me` and `/api/quota`; the guest's test now counts as the account's (a guest who tested today has no test left today).

## Operations

- Guest limits and the IP caps rely on the real client address. Keep the app reachable only through the Cloudflare Tunnel, which sets `CF-Connecting-IP`; if it were reachable directly, that header could be forged.
- The in-process limits (per-IP burst, per-user AI bucket) are per server process, like the existing rate limits. The quota ledger, the per-IP weekly caps and the hourly guard live in Postgres and hold across instances.
- If the owner's own OpenRouter usage should not count against the public meter, use a separate key for the owner (the meter reads the shared key's usage).
