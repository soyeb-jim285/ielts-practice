# Self-Hosted LiveKit Examiner

LiveKit is an **admin-only, unrecorded playground engine**, separate from the scored live exam and the Pipecat worker. It does not enable recording, LiveKit Egress, or automatic scoring. Transcripts, timing and usage reports are operational data, not audio recordings; provider retention policies still apply. Do not describe it as zero-retention. Existing engines and Pipecat's UDP `40000-40199` remain unchanged.

## Recommended Topology

For the most reliable production setup, use a **dedicated Linux media VPS** near users and providers, with a public IPv4 address, valid certificates and TURN/TLS on TCP 443. Use LiveKit's official VM deployment generator for TLS and renewal (instructions below). Keep the app and database on the existing Dokploy host. This avoids sharing TCP 443 with Dokploy/Traefik and isolates real-time workloads. Start with at least 2 dedicated vCPUs / 4 GB RAM for a small pilot; measure concurrent-session capacity, rather than assuming that is a capacity guarantee.

The supplied `deploy/docker-compose.livekit.yml` is a cheaper **same-VPS baseline**: single-node LiveKit `v1.13.10`, host networking, public UDP media and ICE/TCP fallback, signaling through Cloudflare Tunnel, and a separate Python agent. It deliberately does **not** bind TCP 443 or provide TURN/TLS. It will not work on every corporate/mobile network. Do not call a successful WebSocket connection proof that audio works.

The stack is standalone and opt-in; `deploy/docker-compose.dokploy.yml` is not changed. Do not merge it blindly into that stack: relative build and env-file paths differ. All commands below run from the repository root, with Docker Compose v2 or newer on Linux.

## Credentials

Provision credentials in the root `.env` (or equivalent protected deployment environment). Keep `.env` ignored, `chmod 600 .env`, restrict Docker access, and never upload it as a CI artifact. Compose explicitly passes only worker credentials and pricing settings, not the app's database, authentication, storage or OpenAI keys.

| Variable | Consumer and purpose |
| --- | --- |
| `LIVEKIT_URL` | API and browser: public `wss://livekit.example.com`, not the worker's loopback address |
| `LIVEKIT_API_KEY` | API, LiveKit and worker; a new random identifier, e.g. `LK` followed by `openssl rand -hex 12` output |
| `LIVEKIT_API_SECRET` | Same three services; independently generate with `openssl rand -hex 32` |
| `LIVEKIT_AGENT_NAME` | API dispatch and worker registration must match; default `ielts-examiner` |
| `LIVEKIT_REPORT_SECRET` | API only; independent `openssl rand -hex 32`, at least 32 characters. Worker receives a signed per-room reporting token, not this secret |
| `LIVEKIT_TURN_DOMAIN` | Compose baseline: DNS-only hostname such as `turn.example.com` resolving to this media VPS |
| `SONIOX_API_KEY` | Worker: default Soniox streaming STT and TTS |
| `OPENROUTER_API_KEY` | Worker: text LLM; set a provider spend limit |
| `ELEVENLABS_API_KEY` | Optional alternative streaming STT and/or TTS |
| `CARTESIA_API_KEY`, `INWORLD_API_KEY`, `GRADIUM_API_KEY` | Optional alternative TTS providers |
| `ELEVENLABS_USD_PER_M_CHARS`, `CARTESIA_USD_PER_M_CHARS`, `INWORLD_USD_PER_M_CHARS`, `GRADIUM_USD_PER_M_CHARS` | Set the actual plan rate for each selected non-Soniox TTS provider; required for honest cost estimates |
| `LIVEKIT_WORKER_TAG` | Optional immutable GHCR commit-SHA image tag; use the matching app/worker revision |

Use hex/alphanumeric key and secret values: they are interpolated into YAML. Never use `devkey` / `secret`, `--dev`, placeholder credentials or browser-exposed `VITE_*` secrets. Only short-lived, room-scoped participant tokens belong in the browser. Do not put report secrets, provider credentials or examiner instructions in client-visible room metadata. Keep the report endpoint authenticated and reachable from the worker; its URL is supplied by the API, not manually chosen by the browser.

Compose expands required `${VAR:?message}` values into the server's `LIVEKIT_CONFIG` environment variable. The pinned server reads this environment variable directly. A separate YAML file containing `${LIVEKIT_API_SECRET}` would **not** substitute it. `docker compose config`, Docker inspection and process environments contain secrets: use `config --quiet` for validation, never paste rendered configuration into logs/issues.

The app still needs its existing authentication, database and encryption environment. Apply the LiveKit API variables to the app's existing protected environment and restart it; the separate stack does not configure/redeploy the app for you. No Redis is needed for this single-node setup. Do not publish database, Redis, worker health, metrics, profiling or admin listeners to the Internet.

## Same-VPS Baseline

1. Create `livekit.example.com` as a Cloudflare Tunnel public hostname with HTTP/WebSocket origin `http://127.0.0.1:7880` **if cloudflared runs on the host network**. Existing app hostname routing stays unchanged. The certificate on the public hostname must be valid; enable WebSockets and bypass caching. Do not add an interactive Cloudflare Access challenge to this endpoint: native SDK/server clients cannot satisfy it.
2. If the existing `cloudflared` container is on `dokploy-network`, its `127.0.0.1` is not the host. Run a separate host-network cloudflared connector for this hostname, or explicitly bind signaling to the Docker host-gateway address as well as loopback and route the connector to that address. Restrict host-gateway access to trusted containers with the host firewall. Do not bind `7880` publicly merely to make the tunnel work.
3. Create DNS-only A record `turn.example.com` pointing directly at the VPS public IPv4. Never enable Cloudflare orange-cloud proxy on media/TURN DNS. Do not publish AAAA until IPv6 media routing and firewall have been tested. The tunnel carries signaling, **not** UDP media, ICE/TCP, or TURN.
4. Allow inbound UDP `7882` (SFU mux), TCP `7881` (direct ICE/TCP), and UDP `3478` (embedded TURN) in both the provider firewall and host firewall. Allow outbound DNS, HTTPS/WSS to providers and STUN/public-IP discovery. Keep TCP `7880` loopback-only. Keep Pipecat UDP `40000-40199` separate. TURN uses local relay ports `30000-39999`, deliberately stopping before Pipecat; allow local TURN-to-SFU traffic, not a blanket public opening of that relay range for this embedded same-host topology.
5. Check the advertised public IP in startup logs and the selected ICE candidate in browser WebRTC diagnostics. On hosts where STUN discovers the wrong address, set `rtc.use_external_ip: false` and `rtc.node_ip` to the correct static public IP in the Compose configuration. Do not advertise a Docker bridge/private address to remote browsers.
6. Wait for CI to publish the worker image. Authenticate to GHCR if private, then validate and start without building locally:

```bash
docker compose --env-file .env -f deploy/docker-compose.livekit.yml config --quiet
docker compose --env-file .env -f deploy/docker-compose.livekit.yml pull
docker compose --env-file .env -f deploy/docker-compose.livekit.yml up -d --no-build
docker compose --env-file .env -f deploy/docker-compose.livekit.yml ps
docker compose --env-file .env -f deploy/docker-compose.livekit.yml logs --tail 100 livekit livekit-worker
```

The worker image supplies its own startup command; do not replace it with an assumed module name. Its `LIVEKIT_URL` is overridden to `ws://127.0.0.1:7880`, independent of the API/browser's public URL. `depends_on` gives startup order, not readiness: verify worker registration before issuing a session. Host networking requires Linux; Docker Desktop is not the production target.

## TURN/TLS Upgrade

**Recommended actionable path:** use a separate media VPS where TCP 443 is free, and follow the [official VM deployment guide](https://docs.livekit.io/home/self-hosting/vm/). Run the official generator on an operator workstation:

```bash
docker run --rm -it -v "$PWD:/output" livekit/generate
```

Choose your signaling and TURN domains, install the generated deployment on the dedicated VPS per the generated instructions, and configure DNS directly to that VPS. Review generated files before use: replace any floating server tag with `livekit/livekit-server:v1.13.10`, keep Redis private if the generated stack uses it, protect generated secrets, and confirm the generated TLS proxy renews certificates. The official generator is a deployment tool, not the worker image build. Do not run the baseline LiveKit server alongside the generated server on the same ports.

Allow TCP 443 for signaling and TURN/TLS according to the generated L4 proxy layout, plus its documented UDP/ICE ports (which may use a port range rather than this baseline's mux). Copy the generated LiveKit API key/secret into the app and worker environments. Set the public `LIVEKIT_URL` to the generated `wss://` endpoint. Run only the worker using the remote-URL override, not the baseline server:

```bash
docker compose --env-file .env -f deploy/docker-compose.livekit.yml -f deploy/livekit/docker-compose.remote.yml pull livekit-worker
docker compose --env-file .env -f deploy/docker-compose.livekit.yml -f deploy/livekit/docker-compose.remote.yml up -d --no-deps --no-build livekit-worker
```

These commands can run on the app VPS or a separate worker host with a protected root `.env`. The override uses public WSS instead of loopback. Verify the callback URL issued by the app is reachable from the worker host. Keep the worker and server credentials identical. The unused baseline server still requires `LIVEKIT_TURN_DOMAIN` for Compose validation; set it to the generated TURN domain.

For operators who maintain their own TLS infrastructure, the server supports `turn.tls_port: 443`, `turn.domain`, `turn.cert_file` and `turn.key_file` (read-only PEM mounts, matching hostname, automated renewal and restart). That direct listener is safe **only on a dedicated host/IP where TCP 443 is not already occupied**. Merely adding this block on the existing Dokploy host will collide with Traefik. A second public IP requires explicit listener binding on both services; a TCP/SNI-aware L4 proxy requires deliberate TLS passthrough/termination and correct TURN advertisement. An HTTP reverse proxy or Cloudflare Tunnel is not a TURN/TLS proxy. Do not set `external_tls: true` without a real L4 TLS terminator, and do not claim restrictive-network coverage from UDP TURN alone. Prefer the generated dedicated-VPS layout rather than improvising those shared-port routes.

Test with UDP blocked and verify an actual selected **TURN/TLS TCP 443 relay** candidate and bidirectional audio, not simply TCP connectivity. Some enterprise proxies still block TURN even on 443; there is no universal connectivity guarantee.

## Examiner Configuration

Soniox streaming STT and TTS are the defaults; the text LLM uses a cheap OpenRouter allowlist (`deepseek/deepseek-v4.1-flash` or `openai/gpt-6-luna`). No Anthropic, Qwen, or direct OpenAI LLM calls. The OpenAI key is not needed for this cascade. Model/version defaults are defined in `packages/core/src/livekit.ts`; keep app and worker revisions together rather than copying stale model IDs from a runbook.

The admin playground configures STT provider/model, LLM model, TTS provider/model/voice, turn detector, endpoint delays, VAD silence, interruptions, preemptive generation, temperature and output token limit. A shared base can be overridden independently for Parts 1, 2 and 3. Soniox needs `SONIOX_API_KEY`; switching either STT or TTS to ElevenLabs needs its key; each other TTS provider needs its corresponding key. Validate the full merged configuration and all selected provider credentials before dispatch, including future part overrides. Provider/model/voice compatibility and account access must be checked, not inferred from a valid string or the presence of a key.

Settings are edited before starting a session. Stored overrides switch at explicit part transitions, **not halfway through a turn**. Audio turn detection uses local `inference.TurnDetector(version="v1-mini")` with Silero VAD, pinned to Agents `1.8.8` and local inference `0.2.7`. The installed mini detector has no Cloud transport; construction and native inference on synthetic silence were verified without provider calls. VAD-only remains a diagnostic comparison. Part 2 preparation must be silent, and the candidate's long turn must not trigger examiner replies/backchannels; live audio must still verify both.

Provider TTS implementations differ in languages, voice IDs, streaming behavior and cancellation; not every voice works with every model. A model appearing in the picker is not evidence of measured quality, availability or latency. Missing credentials, invalid combinations and provider outages should fail visibly rather than silently billing another provider.

## Verification And Cost

Implementation checks (2026-10-15): core 179 tests, web 310 tests, full server 408 passed / 1 skipped, final LiveKit-route regression 19 tests, and worker 42 tests passed. TypeScript, production build and baseline Compose validation passed. Vite warns about the dynamically loaded LiveKit SDK chunk (~560 KB before gzip); it is not included in the initial app bundle. None of these checks establishes real provider entitlement, browser microphone behavior, public ICE connectivity or measured end-to-end latency.

No deployment or paid provider session is implied by these files. CI uses the locked Python environment, offline/fake-provider tests and Docker build; it must not receive production provider keys. Build the worker image in GitHub CI only, not on the laptop/VPS. Local unit tests, without paid calls:

```bash
cd services/livekit
uv sync --frozen --python 3.13
uv run --frozen pytest
```

Before **any paid smoke run**, state the estimated total cost using current selected STT audio minutes + TTS units + LLM tokens, including preemptive/cancelled generation and retries. Specify duration, voices/models, provider unit rates, spend cap and VPS/egress separately. Do not present an unverified universal cents-per-session figure. Obtain approval where required; content is agent-authored, not generated through paid provider calls.

After that cost gate, use one short admin session on desktop and mobile and check:

- Non-admins cannot obtain a room token or worker dispatch; report authentication rejects bad/expired/replayed credentials as applicable.
- Worker registers under the exact configured agent name; browser joins only its assigned room and audio flows both ways over remote networks.
- Soniox baseline, then each credentialed alternative, validates before joining. Missing keys and provider errors are visible and do not secretly switch providers.
- Natural pauses, incomplete sentences, completed answers, interruption/cancellation, next-part settings, prep silence and the two-minute long-turn floor behave as intended.
- Ending or disconnecting stops provider sessions and removes the room/worker resources; no recording object or scored attempt is created by this playground engine.
- Usage reports reach the API once logically, retry without duplicate billing entries, and distinguish known usage from estimates/unknowns. Deliberate provider outages/disconnects remain visible in the session ledger, including failed/cancelled calls where known; absence of a usage event is not zero spend.
- Baseline UDP, direct ICE/TCP, and the optional TURN/TLS relay path are each verified with actual audio. Test denied microphone permission, mobile backgrounding, reconnect and app/worker restarts.

Measure end-of-user-speech to first audible examiner audio, plus STT finalization, LLM first token, TTS first audio, interruption-stop latency and failures. Record sample count, network, provider/model/voice and warm/cold conditions. Initial goals might be p50 under 1 second and p95 under 2 seconds for short ordinary turns on a nearby healthy deployment; these are **targets, not measured results or SLAs**. Thinking pauses, deliberate endpoint delay, geography, cold starts, TCP relay and provider load can exceed them. Compare p50/p95 and false interruptions together; lowering endpoint delay alone is not a quality improvement.

## Operations

Pin the worker image to a tested commit SHA, keep its matching app revision, and save the previous nonsecret deployment version. The existing Dokploy webhook only redeploys its existing stack; it does not automatically update this separate stack. Pull/restart it explicitly after CI succeeds, preferably with no active sessions. Monitor CPU, memory, packet loss, connection failures, callback failures and provider spend. Worker diagnostic/health ports must be loopback-bound or firewalled with host networking.

On an incident, stop new dispatches, inspect sanitized logs, and roll back both worker/app configuration to the last tested revision. Keep provider errors and unknown/in-flight usage in the ledger; do not erase failed sessions to make metrics look better. Rotate a leaked LiveKit key/secret in server/API/worker together, rotate report secrets independently, and expire existing rooms/tokens as necessary. Keep transcript-bearing logs access-controlled with a retention limit.

To stop only the optional stack without touching the app or Pipecat:

```bash
docker compose --env-file .env -f deploy/docker-compose.livekit.yml down
```

Sources: [LiveKit v1.13.10](https://github.com/livekit/livekit/releases/tag/v1.13.10), [pinned server configuration](https://github.com/livekit/livekit/blob/v1.13.10/config-sample.yaml), [ports/firewall](https://docs.livekit.io/home/self-hosting/ports-firewall/), [VM deployment](https://docs.livekit.io/home/self-hosting/vm/), [deployment generator](https://github.com/livekit/livekit-deploy).
