# Self-Hosted LiveKit Examiner

Python worker for a **self-hosted LiveKit SFU**, not a LiveKit Cloud agent or
Cloud inference pipeline. This directory is independently installable. The API
authenticates the user, creates a private room and dispatches `ielts-examiner`;
the browser publishes microphone audio and the control messages below.

## Verified SDK

- `livekit-agents==1.8.8`, `livekit==1.1.20` and provider plugins `1.8.8`.
- Resolved `livekit-local-inference==0.2.7`; the full transitive resolution is
  checked in as `uv.lock`. Python 3.13 is used by the image and local verification.
- Audio turn detection is **`inference.TurnDetector(version="v1-mini")`**.
  The explicit version matters: SDK development/hosted defaults can select cloud
  `v1`. The selected mini detector has no Cloud transport or credentials.
- `silero.VAD.load(min_silence_duration=cfg.vadSilence)` runs locally too.
  `turnDetection: "vad"` disables the audio EOT detector, not Silero.
- Mini weights are embedded in the native local-inference wheel; Silero's ONNX
  weights ship in its wheel. There is no separate mini model download API.
  The Dockerfile runs the SDK download-files utility for installed plugins and
  eagerly initializes the embedded local models during CI image construction.

Primary references inspected against the installed distribution:

- https://docs.livekit.io/agents/
- https://pypi.org/project/livekit-agents/1.8.8/
- `livekit/agents/inference/eot/detector.py` and `transports.py`
- `livekit/agents/voice/agent_activity.py`, `agent_session.py`, `turn.py`
- Each installed `livekit/plugins/{soniox,elevenlabs,cartesia,inworld,gradium,openai}`
  constructor and local-inference's `_native.pyi`.

## Run And Test

From this directory:

```sh
uv sync --frozen --python 3.13
uv run pytest -q
uv run --env-file .env python -m livekit.agents start worker.py --log-level INFO
```

Set environment variables using `.env.example`. Do not pass secrets as CLI
arguments or dispatch them to the browser. `OPENROUTER_API_KEY` is the only LLM
key; no OpenAI or Anthropic calls are made. ElevenLabs uses `ELEVENLABS_API_KEY`,
passed explicitly to the plugin rather than its differently named SDK default.
Only the keys for providers used in the base config or part overrides are needed.
When deployed through the repository's root Compose setup, its root `.env` is
the source for provider keys and alternate TTS pricing variables; a service-local
`.env` is only for standalone runs. Keep `LIVEKIT_AGENT_NAME` identical in the
API and worker environments (default `ielts-examiner`).

No paid inference calls are needed for installation, unit tests, plugin
construction, or local model verification. Runtime voice sessions do incur
direct-provider and OpenRouter charges. Obtain the owner's budget approval
before a paid smoke test; estimate STT, expected examiner output and LLM tokens
using their actual rate plans first.

Build the image **on GitHub CI**, with context `services/livekit`, then deploy it
to the worker host. Do not build on the development laptop. Run one warm worker
initially. The SDK health listener binds explicitly to `127.0.0.1:8081`, including
under host networking; it is not a public listener. Let the
container receive SIGTERM and allow at least 90 seconds for graceful shutdown
and retrying the final usage report. Do not set a short orchestrator kill timeout.

## Self-Hosted Network

The worker does not implement an SFU or TURN server. Deploy the official LiveKit
server separately using its production deployment guidance:
https://docs.livekit.io/home/self-hosting/deployment/

Recommended topology: public TLS reverse proxy for the application and SFU
signalling, LiveKit's embedded TURN with a valid public certificate for restricted
networks, Redis for multi-node routing if needed, and this worker on a private
network with outbound access. A single-node deployment does not need Redis.
Use the actual SFU's configured UDP media range (often 50000-60000), TCP fallback
(commonly 7881), HTTPS/WSS signalling, and TURN ports in the firewall. Do not
expose the SFU's internal signalling port or worker health endpoint publicly.
Use public advertised SFU IPs; container bridge addresses are not usable remote
ICE candidates. TLS termination for TURN is different from HTTP proxying.

Give the backend API dispatch/admin credentials. Browser tokens should grant
access to only their unique room, participant identity, microphone publishing,
audio subscription and data publishing. Never give browser tokens `roomAdmin`
or dispatch rights. Do not reuse rooms between users. The worker restricts audio
input and control to the dispatched identity; this does not replace SFU room
access control. The backend owns the examiner prompt and usage report destination.

Start with 2 dedicated x86-64 vCPUs and 2 GB RAM for one concurrent session, then
measure actual RSS/CPU under load. The SDK's documented mini preload adds roughly
244 MB RSS; Python, native inference, ONNX and the SFU add overhead. This is a
planning allowance, not a benchmark. Reserve separate resources for the SFU;
avoid CPU oversubscription and enable monitoring before increasing concurrency.
No GPU, Hugging Face token or LiveKit Cloud inference key is required.

## Trusted Dispatch Contract

Use `AgentDispatchService` / the server SDK to dispatch agent name
`LIVEKIT_AGENT_NAME` (default `ielts-examiner`) with **job metadata**, not mutable
room metadata:

```json
{
  "sessionId": "server-session-id",
  "userId": "authenticated-user-id",
  "participantIdentity": "server-issued-candidate-identity",
  "prompt": "Server-built examiner system prompt",
  "cuePrefix": "[APP CUE] ",
  "reportUrl": "https://api.example.com/internal/livekit/usage",
  "reportToken": "single-session-secret",
  "cfg": {
    "stt": "soniox",
    "sttModel": "stt-rt-v5",
    "llm": "deepseek/deepseek-v4.1-flash",
    "tts": "soniox",
    "ttsModel": "tts-rt-v2",
    "voice": "Adrian",
    "turnDetection": "audio",
    "minEndpointDelay": 0.5,
    "maxEndpointDelay": 4.0,
    "vadSilence": 0.3,
    "interruptions": true,
    "preemptiveGeneration": false,
    "temperature": 0.5,
    "maxTokens": 200,
    "parts": {
      "2": {"turnDetection": "vad"},
       "3": {"llm": "openai/gpt-6-luna"}
    }
  }
}
```

Unknown fields and invalid combinations fail closed. Each part is independently
merged onto the **base**, not onto the previous part. Switching STT requires
overriding both `stt` and `sttModel`; ElevenLabs uses `scribe_v2_realtime` with
`use_realtime=True`. Delays and silence are **seconds**, not milliseconds.
Endpoint delay minimum must not exceed maximum. NaN/infinite prices and settings
are rejected. No metadata/configuration values are echoed in error messages.

The defaults and allowed models match `packages/core/src/livekit.ts`. The base
TTS is explicitly Soniox `tts-rt-v2`, voice `Adrian`. Changing TTS provider
requires a matching `ttsModel`; models are never silently remapped:

- Soniox: `tts-rt-v2`.
- Cartesia: `sonic-3.6`, `sonic-3.5`.
- ElevenLabs: `eleven_flash_v2_5`, `eleven_turbo_v2_5`.
- Inworld: `inworld-tts-2-flash`, `inworld-tts-2`.
- Gradium: `gradium-tts-beta`, `default`.

Set a voice supported by the selected provider. For non-Soniox providers,
`voice: "default"` uses the plugin default (ElevenLabs George
`JBFqnCBsd6RMkjVDRZzb`). Soniox always receives the explicit selected voice.
Endpoint maximum is 0.1-10 seconds, VAD silence 0.1-2 seconds, temperature 0-2,
and max tokens 16-2048. Voice IDs are trimmed and limited to 128 characters.
Voice availability and billing depend on the provider account;
constructor tests cannot verify account entitlement or provider-side model IDs.

`reportUrl` is privileged dispatch input, **never browser input**. HTTPS is
recommended; HTTP is allowed for a trusted private API network. Redirects are
disabled so the reporting token cannot be forwarded to another destination.
Constrain worker egress and backend dispatch permissions: this worker assumes
the authenticated dispatch service is trusted to choose its report destination.

## Browser Protocol

Send reliable JSON room data on `ielts.control`. Only messages whose actual
LiveKit sender identity equals `participantIdentity` are accepted. Server-origin
packets with no participant are not treated as candidate controls. Payloads over
8192 bytes, invalid JSON, invalid types and unknown commands are ignored.

```json
{"type":"start"}
{"type":"cue","text":"Move to Part 2 now.","key":"part2"}
{"type":"listen","on":false,"fresh":false}
{"type":"listen","on":false,"fresh":true}
{"type":"listen","on":true,"fresh":false}
{"type":"configure","part":3}
```

Subscribe to events before joining, wait for `ready`, then publish `start`.
The worker waits up to 30 seconds for the dispatched candidate before sending
`ready`, so readiness cannot be lost before that candidate joins. It validates
pricing first but does not construct providers or start the audio session until
`start`. Attach/subscribe to the worker audio track when published after start.
The worker never says "Begin the test" on participant connection.
Repeated starts are ignored. Pre-start commands do not start paid replies.

Controls are processed serially. Explicit cue speech finishes before the next
control can replace its agent. Answer completion follows committed candidate
turns, not every VAD pause; app cues and manual transcript flushes do not advance
the exam. A part handoff resumes an owed reply from retained conversation history.

Preparation is `on:false,fresh:false`: microphone input is disabled. The long
turn is `on:false,fresh:true`: STT stays enabled, reply generation and preemptive
generation are disabled through manual turn handling. Its transcript is flushed
with `commit_user_turn(skip_reply=True)` before an explicit cue or agent handoff.
`fresh` clears only the pending input buffer after committing it, **not** the
conversation. A cue always requests an explicit reply even on the manual floor.
`on:true` restores ordinary conversations. Configure by part separately when
crossing boundaries; it changes providers, VAD, turn handling, generation and
voice using `session.update_agent`, copying the committed conversation first.
The pinned SDK resolves agent-level endpointing, interruptions and preemptive
generation over session defaults; regression tests exercise its actual
`AgentActivity` resolver rather than only constructor arguments. Preemptive
generation is explicitly false on a manual floor, even if configured true.
After the new agent enters (the SDK has drained and closed the old activity),
old STT/TTS/LLM providers are explicitly closed and released. Failed closes are
retained only for shutdown retry, not silently discarded.

`key` is optional correlation data; the worker uses `text`, not a key-to-script
mapping. The backend prompt must constrain cues to examiner behavior. Do not
give this agent tools or credentials usable by generated text.

Reliable `ielts.events` data is sent only to the candidate:

- `ready`: initialized and waiting for `start`.
- `speaking {on}`: SDK examiner speaking state.
- `caption {text}`: **complete** assistant reply text; browser must replace its
  caption, never append. Emitted on committed conversation messages, not tokens.
- `heard {text}`: latest candidate STT update; can be interim or final.
- `pending {on}`: candidate speaking activity.
- `answered`: candidate speaking state ended in an automatic-reply floor.
- `error {message}`: sanitized fatal initialization/control/provider error.
- `metrics {stage,provider,model,estimated}` and `cost {usd}`: estimated usage
  subtotal from provider SDK metrics, not a promise about the final invoice.

No participant after 30 seconds, no `start` after 60 seconds, five minutes idle,
candidate disconnection, or 30 minutes total ends the job. Ordered bounded
queues serialize controls and events. Fatal provider errors terminate rather
than keeping the browser waiting forever. Room deletion is the backend's job.

## Usage Accounting

Provider-specific metric callbacks retain their config so late metrics from the
old agent cannot be attributed to the next part's provider. SDK request metrics
are deduplicated. Rates are estimates, explicitly marked `meta.estimated:true`:

- Soniox STT: $0.12/audio hour; ElevenLabs STT: $0.39/audio hour.
- Soniox TTS: $0.70/generated audio hour, measured from SDK generated duration,
  not a guessed character-to-audio conversion.
- Other TTS: required operator rate `{PROVIDER}_USD_PER_M_CHARS` for the actual
  plan/model. For ElevenLabs the variable is `ELEVENLABS_USD_PER_M_CHARS`.
- LLM input/output token rates: unauthenticated OpenRouter model catalogue,
  fetched before any provider audio connections. Only the two approved model
  IDs are accepted. Missing model/pricing or missing required TTS rates prevents
  startup; unknown usage is not silently priced as free.

Review Soniox/ElevenLabs rates before deployment, and update when plans change.
Hosting, LiveKit network costs, taxes, provider minimums, cached-token discounts
and provider usage not emitted by the SDK are not included. Reported subtotal
is not an invoice reconciliation. A session killed before a metric arrives can
undercount; do not interpret absent metrics as zero-priced inference.

On shutdown the worker closes the session/providers. With no usage entries it
does not POST an empty report (the API requires at least one entry). Otherwise it POSTs exactly once
logically, retrying the same immutable body and UUID `reportId` up to three
times (1s, 2s backoff):

```json
{
  "sessionId": "s",
  "userId": "u",
  "reportId": "uuid",
  "entries": [{
    "stage": "live_stt",
    "provider": "soniox",
    "model": "stt-rt-v5",
    "costUsd": 0.001,
    "audioSeconds": 30,
    "meta": {"estimated": true}
  }]
}
```

Header: `x-livekit-report-token: <reportToken>`. Other stages are
`examiner_llm` (`inputTokens`, `outputTokens`) and `examiner_tts`
(`audioSeconds`, `characters`). The API must bind the token to session/user,
validate every stage/provider/model/finite nonnegative cost, and transactionally
deduplicate `reportId`. **Do not consume/invalidate the token after the first
request**: a successful response can be lost, requiring a safe retry. One token
authorizes this one shutdown report, including all parts, not arbitrary writes.

Reports are in-memory until shutdown; a process crash/SIGKILL or exhausted
delivery retries is not durably recoverable. The worker logs only a failed
report's ID and entry count, not tokens, prompts or transcripts. If accounting
must survive host loss, add a protected durable outbox before production use.
Prompts/transcripts are sent to selected providers as required for inference,
but are not written by this worker. SDK diagnostics are redacted and OpenTelemetry
is disabled; do not enable debug/payload logging at the proxy or provider layer.

## Verification Limits

Tests run against installed pinned SDK/plugin constructors, mocked runtime
handoffs/lifecycle, strict config/control parsing, floor behavior, meter math,
idempotent start and report retries. Native mini EOT inference on synthetic
silence and Silero loading have also been executed locally with no paid calls.
No Docker build, live room, browser end-to-end audio, paid STT/TTS/LLM request,
network impairment test or production concurrency benchmark was run. Run a
budgeted end-to-end session in staging before enabling this engine for users.
