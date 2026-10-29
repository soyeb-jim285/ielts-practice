# Plans and test limits

Everyone practises on the server's provider keys (OpenRouter for analysis and scoring, LiveKit + Soniox for the live examiner). What a person may do is set by their plan. There are no user API keys and no public "community balance" (both removed 2026-10-25). This file is the contract between the server and the web, iOS and Android clients. The OpenAPI document (`/openapi.json`, `apps/web/src/openapi.json`) has the schemas; this file has the rules, the flows and the copy.

## Rules

Plans (all windows are rolling: the last 24 h, 7 days or 30 days; a test frees up one window after it was reserved). Limits live in `PLANS` (`apps/server/src/quota.ts`) and `LR_PLANS` (`apps/server/src/routes/lr.ts`).

| Plan (`tier`) | Writing | Speaking practice (recorded) | Live examiner (LiveKit) | Listening / Reading (our own) |
| --- | --- | --- | --- | --- |
| Guest (`guest`, anonymous session) | 2 / 7 days | 5 / 30 days | 3 / 30 days | the guest 10 + 10 |
| Signed in, free (`community`) | 5 / 7 days | 10 / 30 days | 5 / 30 days | the guest set + 20 + 20 more |
| Subscriber (`subscriber`, `user_limits.subscribed_until` in the future) | Unlimited | Unlimited | 5 / 24 h and 40 / 30 days | All |
| Owner, or admin "No test limits" (`unlimited`) | Unlimited | Unlimited | Unlimited | All (+ Cambridge for the owner) |

- Payments: PayStation hosted checkout (`apps/server/src/routes/pay.ts`), prices in `packages/core/src/pricing.ts` (৳499 / 30 days, ৳1,199 / 90 days, one-time, no auto-renewal). A paid invoice is verified with PayStation's transaction-status API (never the return URL or IPN body) and extends `subscribed_until` once; renewals add to the time left. Return URL `/api/pay/return/:invoice`, IPN `/api/pay/ipn`, plus a 5-minute sweep of the last day's pending invoices. Needs `PAYSTATION_MERCHANT_ID`, `PAYSTATION_PASSWORD`, `PAYSTATION_URL` (sandbox by default); unset, checkout answers 503. The admin user page can still grant the plan by hand.
- Cambridge tests stay allow-list only (`CAMBRIDGE_ALLOWED_EMAILS`, admin grants) on every plan.
- Analysis always uses the default models.
- **One test** is one speaking session (one practice part, or a full test with all parts sharing one `sessionId`) or one writing submission (one task, or Task 1 + Task 2 sharing one `sessionId`). Clients MUST send the same `sessionId` on every attempt of a full test. A part is paid once per `sessionId`: sending a part again under another attempt (even after deleting the first) counts as a separate test, and retrying the same attempt is free. Concurrent submits are serialised.
- **Reserved at submit** (`POST /api/attempts/{id}/submit`, and `POST /api/live/finish`), checked earlier at start (`POST /api/attempts`, `POST /api/live/start`, and `GET /api/quota`). A speaking session is reserved when its first part is submitted.
- **Refunded automatically** when the analysis fails (status `failed`, including interrupted runs) or when no speech was heard (`analysis.noSpeech`). For a full test it is refunded only if no other part still counts. A user (for guests: an IP) gets at most 5 refunds per 24 h; past that the test stays spent, so failures and silent recordings cannot be an endless free retry loop. Re-submitting the same attempt (the retry button) reserves it again from the refund, so it is never charged twice; if the quota was used elsewhere in the meantime the retry gets 429 and the attempt (with its draft) stays.
- **Windows** are rolling (`window`: `day` = 24 h, `week` = 7 days, `month` = 30 days). With two windows (subscriber live) the one with less room is reported. `resetAt` is when the next test frees up (null when none is used): show it in local time ("in 5 h", "Monday 6:00").
- **Skills counted:** `writing`, `speaking` (recorded practice, `POST /api/attempts`) and `examiner` (a live session, reserved at `POST /api/live/livekit/start`; its parts join that one unit at finish).
- **Guest abuse guard:** each guest limit applies per anonymous user AND per client IP (`GUESTS_PER_IP` times the guest limit, default 3, per skill and window, across all anonymous users). Both must have room. The IP is the `CF-Connecting-IP` header (Cloudflare Tunnel; `X-Forwarded-For` is ignored when it is present), else the last `X-Forwarded-For` hop (the one our proxy wrote), else the socket address; values that are not an IP are ignored, IPv6 is counted per /64, and it is stored only as a salted HMAC. A guest who signs up keeps counting against the IP for that week.
- **Retention:** guest data (attempts, recordings) is deleted 30 days after the anonymous user was created. Say "Create an account to keep this result".
- **Server guards** (not per person): when the server's OpenRouter key has less than `COMMUNITY_MIN_BALANCE` USD left, limited tests are refused with `402 community_balance_exhausted`; past `COMMUNITY_MAX_PER_HOUR` reservations per rolling hour, with `503 community_busy`. `unlimited` users are not affected. Clients show neutral copy (see below) and never mention a balance. The admin Costs page shows the key's spend.

## Listening & Reading access

Our own (generated) Listening and Reading tests open by plan (`LR_PLANS`): guests and visitors gen-l-01..10, gen-r-10..16, gen-rg-07..09; signed-in accounts also gen-l-11..30, gen-r-17..30, gen-rg-10..15 (reading picks pass `reading-agent-check.ts`); a replaced version (`-v2`) keeps its plan; subscribers every one. A test outside the caller's plan is not listed and answers 404 like a Cambridge one. Scoring is objective, so there is no AI cost and no quota or fair-use dialog. Cambridge tests (`lr_tests.restricted`, set by `scripts/lr-import.ts` for `source = cambridge`) are for `CAMBRIDGE_ALLOWED_EMAILS` with a verified email only. `GET /api/lr/tests` works without a session and lists only the tests the caller may open. Opening, starting, saving or submitting against a Cambridge test the caller may not open answers 404 (never 403, so its existence does not leak), including an old attempt after access is lost. Clients show Listening and Reading to everyone and never hint at hidden Cambridge content.

## API contract

All JSON, bearer or cookie auth as everywhere else. Errors with a `code` look like `{ "error": "<friendly sentence>", "code": "<code>", ... }`: map `code` to UX, show `error` only as a fallback.

### `GET /api/quota` (session optional)

Call it when a test is about to start (and to render the "N tests left" labels). Without a session it answers for a guest by IP.

```json
{
  "tier": "guest | community | subscriber | unlimited",
  "speaking": { "used": 0, "limit": 10, "remaining": 10, "resetAt": null, "window": "month", "blocked": null },
  "writing":  { "used": 5, "limit": 5, "remaining": 0, "resetAt": "2026-10-28T09:12:00.000Z", "window": "week", "blocked": "quota_exceeded" },
  "examiner": { "used": 1, "limit": 5, "remaining": 4, "resetAt": "2026-11-20T18:00:00.000Z", "window": "month", "blocked": null },
  "live": true
}
```

- `limit`, `remaining`, `resetAt`, `window` are `null` when unlimited.
- `blocked` is why a test of that skill cannot start now: `quota_exceeded`, `community_balance_exhausted` or `community_busy`; `null` means go.
- `live`: the LiveKit examiner is configured on this server.

### `GET /api/me` (session required; guests have one)

As before plus everything in `/api/quota` (same field names, same shapes), and `user.isAnonymous: boolean` (a guest). For a guest `user.email` is `""`; never show it.

### Guest sessions (Better Auth anonymous plugin)

`POST /api/auth/sign-in/anonymous` with body `{}` (and `Content-Type: application/json`). Creates a guest user and session. Call it on the first test start (when `/api/me` or `/api/quota` says the person has no session and they press Start), never on page view. Limited to 15 per IP burst, then 1 per 30 s (`429 too_many_requests`).

- **Web (cookie):** `fetch('/api/auth/sign-in/anonymous', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })`. The session cookie is set; nothing to store. (Better Auth's client: `authClient.signIn.anonymous()`.)
- **iOS / Android (bearer):** same request without cookies. Read the token from the **`set-auth-token` response header** and store it like a normal sign-in token (Keychain / encrypted storage); send `Authorization: Bearer <token>` afterwards. (The `token` field in the JSON body is the raw session token, not the signed bearer value; use the header.) Also keep a flag that this token is a guest (`/api/me` → `user.isAnonymous`).
- A guest token works on: `/api/me`, `/api/quota`, prompts, `/api/speaking/test`, creating/submitting attempts, `GET /api/attempts/{id}` (their own result page), `GET /api/attempts/{id}/status`, `DELETE /api/attempts/{id}`.
- A guest token gets `403 { code: "account_required" }` on history (`GET /api/attempts`), mistakes, cards, progress and `PUT /api/settings`. Show "Create an account" gates there, not an error. It must NOT be treated as an expired session.

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
| 429 | `quota_exceeded` | No test left in the window (at `POST /api/attempts`, at submit, at live start and finish) | `skill`, `resetAt` (ISO), `window`, `tier` |
| 402 | `community_balance_exhausted` | Server guard: the server key is nearly out of credit (limited plans only) | |
| 503 | `community_busy` | Server guard: too many tests started this hour | |
| 429 | `too_many_requests` | Per-IP burst limit (20 attempt creates/submits, then 1 per 3 s) or anonymous sign-in limit | |
| 403 | `account_required` | A guest on a sign-in-only endpoint | |

`POST /api/attempts` and live start run the same checks as submit without reserving anything, so people hear "no tests left" before they write the essay. When a writing submit is refused, a `text`/`plan` sent in the request body is still saved on the attempt (status stays `recording`), so nothing typed is lost.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMMUNITY_MIN_BALANCE` | `0.25` | USD. Limited tests pause below this much left on the server OpenRouter key. |
| `COMMUNITY_MAX_PER_HOUR` | `60` | Limited test reservations per rolling hour across all users; above it `community_busy`. Refunded tests do not count. |
| `GUESTS_PER_IP` | `3` | Guests' worth of tests per IP (times the guest limit, per skill and window) across anonymous users. |
| `IP_HASH_SALT` | derived from `BETTER_AUTH_SECRET` | Salt for the IP hash. Raw IPs are never stored. |
| `OPENROUTER_API_KEY` | | The server key for all analysis. Give it a spend limit in OpenRouter. |
| `CAMBRIDGE_ALLOWED_EMAILS` | `soyebjim@gmail.com` | The owner: exempt from limits. Needs a verified email. |

## Database

`quota_usage`: one row per counted test (user, skill, unit key, tier at the time, IP hash, created, refunded). Rows before 2026-10-25 may carry tier `own-key`. `user_limits`: the admin's `unlimited` switch and `subscribed_until` (its speaking/writing count columns are no longer read). The old `user_api_keys` table is no longer read or written. The server sweeps guests older than 30 days every 6 hours.

## Client UX requirements

Common to web, iOS and Android; copy is sentence case and the same everywhere.

1. **Browse freely.** Guests can open every prompt and the test screens. No session is created until Start.
2. **Start button with remaining quota.** Fetch `GET /api/quota` when the test screen opens (and again at Start). Under or inside the Start button: "3 tests left this week" / "No tests left. Resets Monday 6:00". Unlimited plans show nothing. Use `window` and `resetAt` (local time). Reset phrase, identical on every platform: up to a minute away "in a moment"; under an hour "in N min" (minutes rounded up); under a day "in N h" (hours rounded to the nearest, at least 1); otherwise the local weekday and 24-hour time ("Monday 6:00"). Refresh the numbers after a submit and after an analysis ends (a refund changes them).
3. **Blocked before they start** (`blocked` not null, or 429/402/503 on `POST /api/attempts` / live start): never begin recording or typing. Show one panel with the reason and the way out ({when} is the reset phrase from 2):

   | Code | Title | Body | Primary |
   | --- | --- | --- | --- |
   | `quota_exceeded`, guest | You've used your free tests | They reset {when}. A free account gets more. | **Create an account** |
   | `quota_exceeded`, signed in | You've used your tests for now | They reset {when}. | none |
   | `community_balance_exhausted` | Scoring is paused for a short while | Please try again later. | none |
   | `community_busy` | A lot of people are practising right now | Try again in a few minutes. | none |
   | `too_many_requests` | You're going a bit fast | Try again in a moment. | none |

   Where there is only room for a sentence (a refused upload), use "{title}. {body} {what was kept}".

4. **Quota ran out mid-test** (a second tab, the window rolled): the submit returns 429/402/503. Keep the draft on screen (the server also keeps writing text), say what happened and when it resets. Do not discard anything.
5. **After submit failures that were refunded** (analysis failed, no speech): say "This one didn't count against your tests." The retry button re-submits the same attempt.
6. **Guest result.** The result page of a guest's own test works. Show "Create an account to keep this result" (results are kept 30 days). History, Mistakes and Review show a friendly gate ("Create an account to see your history") instead of calling their endpoints, and map `403 account_required` to the same gate if a call happens anyway.
7. **After sign-in or sign-up**, refetch `/api/me` and `/api/quota`; the guest's used tests now count on the account.

## Operations

- Guest limits and the IP caps rely on the real client address. Keep the app reachable only through the Cloudflare Tunnel, which sets `CF-Connecting-IP`; if it were reachable directly, that header could be forged.
- The in-process limits (per-IP burst, per-user AI bucket) are per server process, like the existing rate limits. The quota ledger, the per-IP caps and the hourly guard live in Postgres and hold across instances.
