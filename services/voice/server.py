"""Server-side examiner pipeline (Pipecat) for the admin playground's "Pipecat" engine.

The browser connects over WebRTC (SmallWebRTC). Our API (apps/server, route /api/live/pipecat/offer) authenticates the user, builds the examiner's
system prompt and forwards the SDP offer here with a shared secret, so this service never sees a user cookie and is only reachable from the host.

Pipeline: mic → STT (Soniox or Scribe v2 Realtime, finalized when the turn ends) → user aggregator (Silero VAD + Smart Turn v3, both local) →
examiner gate (no replies in the prep minute or the long turn) → LLM on OpenRouter (streamed) → TTS over a WebSocket (Soniox or ElevenLabs) →
speaker. Cues from the page ("Begin the test.", part changes, nudges) arrive as RTVI client messages and run the LLM like the cascade's app turns.
Usage (STT seconds, LLM tokens, TTS characters) is priced here and sent to the page and, at the end, to our API's cost ledger.
"""

import asyncio
import hashlib
import random
import hmac
import os
import sys
import time
from typing import Any

import aioice.ice
import httpx
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from loguru import logger

from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    LLMContextFrame,
    MetricsFrame,
)
from pipecat.metrics.metrics import LLMUsageMetricsData, SmartTurnMetricsData, STTUsageMetricsData, TTSUsageMetricsData
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.openrouter.llm import OpenRouterLLMService
from pipecat.services.soniox.stt import SonioxSTTService
from pipecat.services.soniox.tts import SonioxTTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.turns.user_mute.base_user_mute_strategy import BaseUserMuteStrategy
from pipecat.turns.user_stop.turn_analyzer_user_turn_stop_strategy import TurnAnalyzerUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.workers.runner import WorkerRunner

logger.remove()  # DEBUG logs every prompt in full
logger.add(sys.stderr, level=os.environ.get("LOG_LEVEL", "INFO"))

# Shared with our API; by default both derive it from the OpenRouter key they already have, so a deploy needs no extra secret.
SECRET = os.environ.get("VOICE_SECRET") or hashlib.sha256(f"ielts-voice:{os.environ['OPENROUTER_API_KEY']}".encode()).hexdigest()
GEORGE = "JBFqnCBsd6RMkjVDRZzb"  # ElevenLabs "George", the cascade's British examiner voice
# USD list prices (2026-10-14): Soniox stt-rt-v5 $0.12/h, Soniox tts-rt-v2 $0.70/h of speech (~$0.014 per 1k characters). ElevenLabs over the
# house plan is paid in subscription credits, priced here at OpenRouter's rate for the same voices ($20 per M characters).
STT_USD_PER_S = {"soniox": 0.12 / 3600, "scribe": 0.39 / 3600}
TTS_USD_PER_CHAR = {"soniox": 0.014 / 1000, "elevenlabs": 20 / 1e6}


def pin_ice():
    """WebRTC media on the VPS: the cloud firewall drops inbound UDP except one opened range, so host candidates bind only there
    (VOICE_UDP_PORTS, e.g. 40000-40199) and only on the public addresses (VOICE_ICE_IPS), not on every docker bridge."""
    ips, ports = os.environ.get("VOICE_ICE_IPS"), os.environ.get("VOICE_UDP_PORTS")
    if ips:
        keep = set(ips.split(","))
        orig_hosts = aioice.ice.get_host_addresses
        aioice.ice.get_host_addresses = lambda use_ipv4, use_ipv6: [a for a in orig_hosts(use_ipv4, use_ipv6) if a in keep]
    if ports:
        lo, hi = (int(x) for x in ports.split("-"))
        orig_bind = asyncio.base_events.BaseEventLoop.create_datagram_endpoint

        async def bind(self, factory, local_addr=None, **kw):
            if local_addr and local_addr[1] == 0 and "get_component_candidates" in getattr(factory, "__qualname__", ""):
                for port in random.sample(range(lo, hi + 1), hi - lo + 1):
                    try:
                        return await orig_bind(self, factory, local_addr=(local_addr[0], port), **kw)
                    except OSError:
                        continue
                raise OSError(f"no free UDP port in {ports}")
            return await orig_bind(self, factory, local_addr=local_addr, **kw)

        asyncio.base_events.BaseEventLoop.create_datagram_endpoint = bind


pin_ice()
app = FastAPI()
# No STUN: on the VPS (host network) the host candidates already carry the public IP, and gathering against a STUN server held each offer ~5 s.
handler = SmallWebRTCRequestHandler()
_prices: dict[str, tuple[float, float]] = {}


async def llm_price(model: str) -> tuple[float, float]:
    """USD per prompt and completion token from OpenRouter's catalogue (cached)."""
    if not _prices:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                for m in (await c.get("https://openrouter.ai/api/v1/models")).json()["data"]:
                    p = m.get("pricing") or {}
                    _prices[m["id"]] = (float(p.get("prompt") or 0), float(p.get("completion") or 0))
        except Exception as e:  # pricing is an estimate; a failed lookup must not stop the session
            logger.warning(f"OpenRouter price lookup failed: {e}")
    return _prices.get(model, (0.0, 0.0))


def check(secret: str | None):
    if not secret or not hmac.compare_digest(secret, SECRET):
        raise HTTPException(403)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/api/offer")
async def offer(request: SmallWebRTCRequest, background: BackgroundTasks, x_voice_secret: str | None = Header(None)):
    check(x_voice_secret)

    async def started(conn: SmallWebRTCConnection):
        background.add_task(run_bot, conn, request.request_data or {})

    return await handler.handle_web_request(request=request, webrtc_connection_callback=started)


@app.patch("/api/offer")
async def ice(request: SmallWebRTCPatchRequest, x_voice_secret: str | None = Header(None)):
    check(x_voice_secret)
    await handler.handle_patch_request(request)
    return {"status": "success"}


class Examiner:
    """What the page controls: whether the candidate is heard (the prep minute: no) and answered (the long turn: heard, no reply until the cue)."""

    def __init__(self):
        self.hearing = True
        self.replies = True
        self.bot_speaking = False
        self.reply_until = 0.0  # a reply was asked for: the candidate is muted until the examiner has said it (or this deadline passes)

    @property
    def muted(self):
        return self.bot_speaking or not self.hearing or time.monotonic() < self.reply_until


class ExaminerMute(BaseUserMuteStrategy):
    """Mutes the candidate from the moment a reply is asked for until the examiner has finished it (it can't be interrupted, as in the cascade;
    a cough while the LLM runs would otherwise cancel the line, and a phone speaker's echo stays out) and while the page says the examiner must
    not hear (preparation)."""

    def __init__(self, ex: Examiner):
        super().__init__()
        self.ex = ex

    async def process_frame(self, frame: Frame) -> bool:
        await super().process_frame(frame)
        if isinstance(frame, BotStartedSpeakingFrame):
            self.ex.bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self.ex.bot_speaking = False
            self.ex.reply_until = 0.0
        return self.ex.muted


class ExaminerGate(FrameProcessor):
    """Between the user aggregator and the LLM: a finished answer runs the LLM only while replies are on; cues always do."""

    def __init__(self, ex: Examiner):
        super().__init__()
        self.ex = ex

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMContextFrame) and direction == FrameDirection.DOWNSTREAM:
            if not self.ex.replies:
                return  # the answer stays in the context; the next cue's reply sees it
            self.ex.reply_until = time.monotonic() + 12  # an empty reply never speaks: the deadline unmutes
        await self.push_frame(frame, direction)


class Meter(FrameProcessor):
    """Adds up usage from the services' metrics and prices it."""

    def __init__(self, cfg: dict, on_cost, on_turn):
        super().__init__()
        self.cfg, self.on_cost, self.on_turn = cfg, on_cost, on_turn
        self.stt_s = self.tts_chars = self.llm_in = self.llm_out = 0
        self.usd = 0.0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, MetricsFrame):
            changed = False
            for d in frame.data:
                if isinstance(d, LLMUsageMetricsData):
                    self.llm_in += d.value.prompt_tokens or 0
                    self.llm_out += d.value.completion_tokens or 0
                    changed = True
                elif isinstance(d, TTSUsageMetricsData):
                    self.tts_chars += d.value
                    changed = True
                elif isinstance(d, STTUsageMetricsData):
                    self.stt_s += d.value.audio_seconds
                    changed = True
                elif isinstance(d, SmartTurnMetricsData):
                    logger.info(f"smart turn p={d.probability:.2f} complete={d.is_complete} {d.inference_time_ms:.0f} ms")
                    await self.on_turn(d)
            if changed:
                pin, pout = await llm_price(self.cfg["llm"])
                self.usd = self.llm_in * pin + self.llm_out * pout + self.tts_chars * TTS_USD_PER_CHAR[self.cfg["tts"]]
                await self.on_cost()
        await self.push_frame(frame, direction)


def build_services(cfg: dict, prompt: str):
    if cfg["stt"] == "scribe":
        stt = ElevenLabsRealtimeSTTService(api_key=os.environ["ELEVENLABS_API_KEY"], model="scribe_v2_realtime")
    else:
        stt = SonioxSTTService(api_key=os.environ["SONIOX_API_KEY"], settings=SonioxSTTService.Settings(language_hints=[Language.EN]))
    llm = OpenRouterLLMService(
        api_key=os.environ["OPENROUTER_API_KEY"],
        settings=OpenRouterLLMService.Settings(
            model=cfg["llm"],
            system_instruction=prompt,
            max_tokens=200,
            temperature=0.7,
            # a one-line examiner turn needs no thinking; usage feeds the cost meter
            extra={"extra_body": {"reasoning": {"enabled": False}, "usage": {"include": True}}},
        ),
    )
    if cfg["tts"] == "elevenlabs":
        tts = ElevenLabsTTSService(
            api_key=os.environ["ELEVENLABS_API_KEY"],
            settings=ElevenLabsTTSService.Settings(model=cfg.get("ttsModel") or "eleven_flash_v2_5", voice=cfg.get("voice") or GEORGE),
        )
    else:
        tts = SonioxTTSService(api_key=os.environ["SONIOX_API_KEY"], settings=SonioxTTSService.Settings(voice=cfg.get("voice") or "Adrian"))
    return stt, llm, tts


async def run_bot(conn: SmallWebRTCConnection, data: dict[str, Any]):
    cfg = {"stt": "soniox", "llm": "deepseek/deepseek-v4.1-flash", "tts": "soniox", "vadStopSecs": 0.2, "smartStopSecs": 1.5, **(data.get("cfg") or {})}
    prompt, cue_prefix = data["prompt"], data.get("cuePrefix", "")
    ex = Examiner()
    started = time.monotonic()
    transport = SmallWebRTCTransport(webrtc_connection=conn, params=TransportParams(audio_in_enabled=True, audio_out_enabled=True))
    stt, llm, tts = build_services(cfg, prompt)
    context = LLMContext()
    user_agg, assistant_agg = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=float(cfg["vadStopSecs"]))),
            user_turn_strategies=UserTurnStrategies(
                stop=[TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3(params=SmartTurnParams(stop_secs=float(cfg["smartStopSecs"]))))]
            ),
            user_mute_strategies=[ExaminerMute(ex)],
        ),
    )
    worker: PipelineWorker | None = None

    async def send_cost():
        if worker and worker.rtvi:
            await worker.rtvi.send_server_message({"type": "cost", "usd": meter.usd + stt_usd()})

    def stt_usd():
        # Soniox and Scribe bill the audio streamed to them; the transport streams the whole call
        return (time.monotonic() - started) * STT_USD_PER_S[cfg["stt"]]

    async def send_turn(d: SmartTurnMetricsData):
        if worker and worker.rtvi:
            await worker.rtvi.send_server_message({"type": "turn", "p": d.probability, "complete": d.is_complete, "ms": d.inference_time_ms})

    meter = Meter(cfg, send_cost, send_turn)
    gate = ExaminerGate(ex)
    pipeline = Pipeline([transport.input(), stt, user_agg, gate, llm, tts, transport.output(), assistant_agg, meter])
    # a service that can't work (bad key, rejected model) ends the session, so the page shows it instead of waiting for a voice that never comes
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=600,
        processor_unusable_policy=ProcessorUnusablePolicy.END,
    )
    runner = WorkerRunner(handle_sigint=False)

    async def cue(text: str):
        logger.info(f"cue: {text[:60]}")
        await gate.broadcast_interruption()  # a cue cuts the examiner off, like the cascade's
        context.add_message({"role": "user", "content": cue_prefix + text})
        ex.reply_until = time.monotonic() + 12
        await gate.push_frame(LLMContextFrame(context=context))

    @worker.rtvi.event_handler("on_client_message")
    async def on_client_message(rtvi, msg):
        d = msg.data or {}
        if msg.type == "cue":
            await cue(d.get("text", ""))
        elif msg.type == "listen":
            ex.replies = bool(d.get("on"))
            ex.hearing = ex.replies or bool(d.get("fresh"))

    connected = asyncio.Event()

    @transport.event_handler("on_client_connected")
    async def on_connected(transport, client):
        connected.set()
        await cue("Begin the test.")

    async def give_up():
        # media that never connects (firewall, NAT) must not leave the pipeline and its provider sockets running
        try:
            await asyncio.wait_for(connected.wait(), 30)
        except TimeoutError:
            logger.warning("WebRTC did not connect within 30 s; ending the session")
            await runner.cancel()

    asyncio.create_task(give_up())

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(transport, client):
        await runner.cancel()

    await runner.add_workers(worker)
    try:
        await runner.run()
    finally:
        await report(data, cfg, meter, stt_usd(), time.monotonic() - started)


async def report(data: dict, cfg: dict, meter: Meter, stt_usd: float, secs: float):
    """The session's usage to our API's cost ledger."""
    url = data.get("reportUrl")
    if not url:
        return
    body = {
        "sessionId": data.get("sessionId"),
        "userId": data.get("userId"),
        "cfg": cfg,
        "seconds": round(secs, 1),
        "sttUsd": stt_usd,
        "llmTokensIn": meter.llm_in,
        "llmTokensOut": meter.llm_out,
        "ttsChars": meter.tts_chars,
        "usd": meter.usd + stt_usd,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            await c.post(url, json=body, headers={"x-voice-secret": SECRET})
    except Exception as e:
        logger.warning(f"usage report failed: {e}")


@app.middleware("http")
async def no_cache(request: Request, call_next):
    response = await call_next(request)
    response.headers["cache-control"] = "no-store"
    return response


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("VOICE_HOST", "127.0.0.1"), port=int(os.environ.get("VOICE_PORT", "7860")))
