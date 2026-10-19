"""Self-hosted LiveKit examiner. All inference uses local models or direct keys."""

import asyncio
import json
import logging
import math
import os
import time
import uuid

import httpx
from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli, inference, metrics
from livekit.agents.voice import room_io
from livekit.plugins import cartesia, elevenlabs, gradium, inworld, openai, silero, soniox

from contract import Config, Dispatch, Floor, control, send_report


log = logging.getLogger("ielts.livekit")
server = AgentServer(host="127.0.0.1", port=8081, num_idle_processes=1,
                     initialize_process_timeout=60, shutdown_process_timeout=90)


class PrivacyFilter(logging.Filter):
    def filter(self, record):
        # SDK exceptions can contain URLs, provider payloads, or transcript text.
        if record.name.startswith(("livekit", "openai", "httpx", "httpcore")):
            record.msg = "SDK diagnostic suppressed (%s)"
            record.args = (record.levelname,)
            record.exc_info = None
            record.exc_text = None
            for key in list(record.__dict__):
                if key.startswith("lk.pii"):
                    del record.__dict__[key]
        return True


def privacy():
    for handler in logging.getLogger().handlers:
        handler.addFilter(PrivacyFilter())
    # Never export prompts/transcripts through OpenTelemetry.
    os.environ["OTEL_SDK_DISABLED"] = "true"


REPORT_BATCH = 500  # the server takes at most 1000 entries per report
REPORT_EVERY_S = 60


class Meter:
    def __init__(self):
        self.entries = []
        self.total = 0.0
        self.seen = set()

    def record(self, m, cfg, prices):
        key = (m.type, m.request_id, m.timestamp)
        if key in self.seen:
            return None
        self.seen.add(key)
        if isinstance(m, metrics.STTMetrics):
            provider, model, stage = cfg.stt, cfg.sttModel, "live_stt"
            quantity = dict(audioSeconds=m.audio_duration)
            cost = m.audio_duration * prices["stt"]
        elif isinstance(m, metrics.TTSMetrics):
            provider, model, stage = cfg.tts, cfg.ttsModel, "examiner_tts"
            quantity = dict(audioSeconds=m.audio_duration, characters=m.characters_count)
            cost = (m.audio_duration if cfg.tts == "soniox" else m.characters_count) * prices["tts"]
        elif isinstance(m, metrics.LLMMetrics):
            provider, model, stage = "openrouter", cfg.llm, "examiner_llm"
            quantity = dict(inputTokens=m.prompt_tokens, outputTokens=m.completion_tokens)
            # OpenRouter bills cached prompt tokens at the cheaper cache-read rate (DeepSeek: ~1/4 of input).
            cached = min(m.prompt_cached_tokens or 0, m.prompt_tokens)
            cost = ((m.prompt_tokens - cached) * prices["input"] + cached * prices.get("cached", prices["input"])
                    + m.completion_tokens * prices["output"])
        else:
            return None
        entry = dict(stage=stage, provider=provider, model=model, costUsd=cost, **quantity,
                     meta=dict(estimated=True, pricingSource=prices["source"], requestId=m.request_id,
                               excludes="transport, hosting, taxes, discounts, unreported provider usage"))
        self.entries.append(entry)
        self.total += cost
        return entry


async def pricing(client, c):
    """Fail before opening provider sockets if usage cannot be honestly estimated."""
    catalog = await client.get("https://openrouter.ai/api/v1/models")
    catalog.raise_for_status()
    model = next((m for m in catalog.json()["data"] if m["id"] == c.llm), None)
    if model is None:
        raise ValueError("configured LLM absent from OpenRouter catalogue")
    p = model["pricing"]
    result = {"input": float(p["prompt"]), "output": float(p["completion"]),
              "cached": float(p.get("input_cache_read") or p["prompt"]),
              "stt": {"soniox": 0.12 / 3600, "elevenlabs": 0.39 / 3600}[c.stt],
              "source": "OpenRouter live catalogue; provider published estimate or operator rate"}
    if c.tts == "soniox":
        result["tts"] = 0.70 / 3600
    else:
        # Operator must supply the actual plan's USD/M characters, not an invented free rate.
        result["tts"] = float(os.environ[f"{c.tts.upper()}_USD_PER_M_CHARS"]) / 1e6
    if any(not math.isfinite(result[k]) or result[k] < 0 for k in ("input", "output", "cached", "stt", "tts")):
        raise ValueError("invalid pricing")
    return result


def _sentence_end(text):
    """Index just past the first sentence end ('.', '?' or '!' followed by a space), or None."""
    for i, ch in enumerate(text[:-1]):
        if ch in ".?!" and text[i + 1] == " ":
            return i + 1
    return None


class Examiner(Agent):
    def __init__(self, d, c, floor, meter, prices, emit, chat_ctx=None):
        stt = (soniox.STT(api_key=os.environ["SONIOX_API_KEY"], params=soniox.STTOptions(model=c.sttModel, language_hints=["en"]))
               if c.stt == "soniox" else elevenlabs.STT(api_key=os.environ["ELEVENLABS_API_KEY"], model=c.sttModel,
                                                       use_realtime=True, language_code="en", enable_logging=False))
        voice = c.voice
        model = c.ttsModel
        if c.tts == "soniox":
            tts = soniox.TTS(api_key=os.environ["SONIOX_API_KEY"], model=model, voice=voice)
        elif c.tts == "elevenlabs":
            tts = elevenlabs.TTS(api_key=os.environ["ELEVENLABS_API_KEY"], model=model,
                                voice_id="JBFqnCBsd6RMkjVDRZzb" if voice == "default" else voice, enable_logging=False)
        elif c.tts == "cartesia":
            tts = cartesia.TTS(api_key=os.environ["CARTESIA_API_KEY"], model=model,
                               **({} if voice == "default" else {"voice": voice}))
        elif c.tts == "inworld":
            tts = inworld.TTS(api_key=os.environ["INWORLD_API_KEY"], model=model,
                              **({} if voice == "default" else {"voice": voice}))
        else:
            tts = gradium.TTS(api_key=os.environ["GRADIUM_API_KEY"], model_name=model,
                              **({} if voice == "default" else {"voice_id": voice}))
        llm = openai.LLM(api_key=os.environ["OPENROUTER_API_KEY"], base_url="https://openrouter.ai/api/v1",
                         model=c.llm, temperature=c.temperature, max_completion_tokens=c.maxTokens)
        super().__init__(instructions=d.prompt, chat_ctx=chat_ctx, stt=stt, tts=tts, llm=llm,
                         vad=silero.VAD.load(min_silence_duration=c.vadSilence),
                         turn_handling={
                             "turn_detection": (inference.TurnDetector(version="v1-mini") if c.turnDetection == "audio" else "vad")
                             if floor.replies and floor.started else "manual",
                             "endpointing": {"min_delay": c.minEndpointDelay, "max_delay": c.maxEndpointDelay},
                             "interruption": {"enabled": c.interruptions, "mode": "vad"},
                             "preemptive_generation": {"enabled": c.preemptiveGeneration and floor.replies and floor.started},
                         })
        self.entered = asyncio.Event()
        self._emit = emit
        self.resources = [stt, tts, llm]
        for resource in self.resources:
            @resource.on("metrics_collected")
            def collected(m, cfg=c, rates=prices):
                entry = meter.record(m, cfg, rates)
                if entry:
                    emit({"type": "cost", "usd": meter.total})

    async def on_enter(self):
        self.entered.set()

    async def transcription_node(self, text, model_settings):
        """Caption each sentence as the LLM writes it (the chat item only arrives after the line was spoken)."""
        buf, first = "", True
        async for delta in Agent.default.transcription_node(self, text, model_settings):
            buf += str(delta)
            while (cut := _sentence_end(buf)) is not None:
                self._emit({"type": "caption", "text": buf[:cut].strip(), "append": not first})
                buf, first = buf[cut:], False
            yield delta
        if buf.strip():
            self._emit({"type": "caption", "text": buf.strip(), "append": not first})


class Runtime:
    def __init__(self, ctx, dispatch):
        self.ctx, self.d = ctx, dispatch
        self.floor, self.meter = Floor(), Meter()
        self.session = AgentSession()
        self.agent = None
        self.agents = []
        self.part = 1
        self.queue = asyncio.Queue(maxsize=64)
        self.outbox = asyncio.Queue(maxsize=512)
        self.done = asyncio.Event()
        self.last_activity = self.born = time.monotonic()
        self.reported = False
        self.report_id = str(uuid.uuid4())
        self.sent = 0  # usage entries the server has taken
        self.batch = None  # (start, end) of the batch in flight: resent as is until taken
        self.report_lock = asyncio.Lock()
        self.client = httpx.AsyncClient(timeout=15, follow_redirects=False)
        self.rates = {}
        self.committing_audio = False
        self.answer_pending = False

    def emit(self, event):
        try:
            self.outbox.put_nowait(event)
        except asyncio.QueueFull:
            self.done.set()

    async def publish(self):
        while True:
            event = await self.outbox.get()
            try:
                await self.ctx.room.local_participant.publish_data(json.dumps(event).encode(), reliable=True,
                                                                 topic="ielts.events",
                                                                 destination_identities=[self.d.participantIdentity])
            except Exception:
                self.done.set()
            finally:
                self.outbox.task_done()

    async def replace(self):
        c = self.d.config(self.part)
        previous = self.agent
        if previous:
            await self.session.interrupt(force=True)
            # Flush manual audio BEFORE copying history or handing off the agent.
            await self.commit_audio()
        self.agent = Examiner(self.d, c, self.floor, self.meter, self.rates[self.part], self.emit,
                              previous.chat_ctx.copy() if previous else None)
        self.agents.append(self.agent)
        if previous:
            self.session.update_agent(self.agent)
            await asyncio.wait_for(self.agent.entered.wait(), 15)
            # SDK drains/closes the old activity before on_enter, but not its providers.
            await self.close_resources(previous)
        else:
            await self.session.start(self.agent, room=self.ctx.room, record=False, room_options=room_io.RoomOptions(
                participant_identity=self.d.participantIdentity, text_input=False, text_output=False,
                video_input=False, close_on_disconnect=False))

    async def close_resources(self, agent):
        for resource in list(agent.resources):
            try:
                await asyncio.wait_for(resource.aclose(), 2)
                agent.resources.remove(resource)
            except Exception:
                log.warning("Provider cleanup failed")
        if not agent.resources:
            self.agents.remove(agent)

    async def commit_audio(self):
        # A control-driven transcript flush is not a new answer to the current exam question.
        self.committing_audio = True
        try:
            await self.session.commit_user_turn(skip_reply=True, transcript_timeout=3)
        finally:
            self.committing_audio = False

    async def command(self, d):
        if self.done.is_set():
            return
        self.last_activity = time.monotonic()
        if d["type"] == "start":
            if self.floor.started:
                return
            self.floor.started = True
            await self.replace()
            self.session.input.set_audio_enabled(True)
            await self.session.generate_reply(user_input=self.d.cuePrefix + "Begin the test.")
        elif not self.floor.started:
            return
        elif d["type"] == "listen":
            # Disable input immediately during prep; STT never receives prep audio.
            self.session.input.set_audio_enabled(False)
            self.floor.listen(d["on"], d["fresh"])
            await self.replace()
            self.session.clear_user_turn()
            self.session.input.set_audio_enabled(self.floor.hearing)
        elif d["type"] == "configure":
            pending = self.answer_pending
            self.part = d["part"]
            await self.replace()
            # Handoff cancels the old activity's generation, not the candidate's owed reply. Not into Part 2: Part 1 is over, and the
            # Part 2 cue follows at once (an owed reply there was the next Part 1 question, spoken before the Part 2 instructions).
            if pending and self.floor.replies and self.part != 2:
                await self.session.generate_reply()
        elif d["type"] == "cue":
            if self.d.cues is not None and d["text"] not in self.d.cues:
                return
            await self.session.interrupt(force=True)
            await self.commit_audio()
            await self.session.generate_reply(user_input=self.d.cuePrefix + d["text"])

    async def commands(self):
        while True:
            d = await self.queue.get()
            try:
                await asyncio.wait_for(self.command(d), 30)
            except Exception:
                self.emit({"type": "error", "message": "Examiner control failed; please reconnect."})
                self.done.set()

    async def announce(self):
        # The browser drops events from a participant it has not seen join yet. When it joins before the examiner (a
        # local install) it can miss the first "ready", so repeat it until "start" arrives.
        while not self.floor.started and not self.done.is_set():
            await asyncio.sleep(1)
            if not self.floor.started:
                self.emit({"type": "ready"})

    async def watchdog(self):
        while not self.done.is_set():
            await asyncio.sleep(1)
            now = time.monotonic()
            present = self.d.participantIdentity in self.ctx.room.remote_participants
            if (not present and now - self.born > 30) or now - self.last_activity > 300 or now - self.born > 1800:
                self.done.set()
            if not self.floor.started and now - self.born > 60:
                self.done.set()

    async def flush(self) -> bool:
        """Sends the usage recorded so far, in batches the server accepts (<= REPORT_BATCH entries). A batch keeps its id and
        entries until the server takes it, so a retry after a lost response is never counted twice."""
        async with self.report_lock:
            while True:
                if self.batch is None:
                    end = min(len(self.meter.entries), self.sent + REPORT_BATCH)
                    if end == self.sent:
                        return True
                    self.batch = (self.sent, end)
                start, end = self.batch
                if not await send_report(self.client, self.d, f"{self.report_id}:{start}", self.meter.entries[start:end]):
                    return False
                self.sent, self.batch = end, None

    async def reporter(self):
        # A crash or a failed final report loses at most the last minute of usage, not the whole session.
        while True:
            await asyncio.sleep(REPORT_EVERY_S)
            await self.flush()

    async def shutdown(self):
        if self.reported:
            return
        self.reported = True
        self.done.set()
        try:
            await asyncio.wait_for(self.session.aclose(), 8)
        except Exception:
            log.warning("Session cleanup failed; preserving usage report")
        for agent in list(self.agents):
            await self.close_resources(agent)
        try:
            for attempt in range(4):
                if await self.flush():
                    break
                await asyncio.sleep(5 * (attempt + 1))
            else:
                # Costs only (no transcript or user content): enough to replay into the ledger by hand.
                log.error("Usage report delivery exhausted; reportId=%s unsent=%s", self.report_id, json.dumps(self.meter.entries[self.sent:]))
        finally:
            await self.client.aclose()

    async def run(self):
        @self.ctx.room.on("data_received")
        def received(packet: rtc.DataPacket):
            if packet.topic != "ielts.control":
                return
            message = control(self.d.participantIdentity, packet.participant.identity if packet.participant else None, packet.data)
            if message:
                try:
                    self.queue.put_nowait(message)
                except asyncio.QueueFull:
                    self.done.set()

        @self.ctx.room.on("participant_disconnected")
        def disconnected(participant):
            if participant.identity == self.d.participantIdentity:
                self.done.set()

        @self.session.on("user_input_transcribed")
        def transcript(event):
            self.last_activity = time.monotonic()
            # Interim transcripts repeat the growing sentence; the client appends each line, so send finals only.
            if event.is_final and self.floor.hearing and self.floor.started:
                self.emit({"type": "heard", "text": event.transcript})

        @self.session.on("user_state_changed")
        def user_state(event):
            self.last_activity = time.monotonic()
            self.emit({"type": "pending", "on": event.new_state == "speaking"})

        @self.session.on("agent_state_changed")
        def agent_state(event):
            if event.new_state == "speaking":
                self.answer_pending = False
            self.emit({"type": "speaking", "on": event.new_state == "speaking"})

        @self.session.on("conversation_item_added")
        def item(event):
            if (event.item.role == "user" and event.item.text_content
                    and not event.item.text_content.startswith(self.d.cuePrefix)
                    and self.floor.started and self.floor.replies and not self.committing_audio):
                self.answer_pending = True
                m = getattr(event.item, "metrics", None) or {}
                # Per-turn timing for the playground timeline (seconds from the end of the candidate's speech).
                self.emit({"type": "answered", "eot": m.get("end_of_turn_delay"), "stt": m.get("transcription_delay")})
            if event.item.role == "assistant":
                m = getattr(event.item, "metrics", None) or {}
                # Captions are streamed by transcription_node; this only reports the reply's stage timings.
                self.emit({"type": "turn", "llm": m.get("llm_node_ttft"), "tts": m.get("tts_node_ttfb")})

        @self.session.on("error")
        def error(event):
            if not event.error.recoverable:
                self.emit({"type": "error", "message": "Voice provider failed; please reconnect."})
                self.done.set()

        tasks = [asyncio.create_task(self.publish()), asyncio.create_task(self.watchdog()), asyncio.create_task(self.reporter())]
        try:
            for part in (1, 2, 3):
                self.rates[part] = await pricing(self.client, self.d.config(part))
            await asyncio.wait_for(self.ctx.wait_for_participant(identity=self.d.participantIdentity), 30)
            self.emit({"type": "ready"})
            tasks.append(asyncio.create_task(self.commands()))
            tasks.append(asyncio.create_task(self.announce()))
            await self.done.wait()
        except Exception:
            self.emit({"type": "error", "message": "Examiner initialization failed; check server configuration."})
        finally:
            try:
                # Stop new control/provider work before draining usage. Keep the
                # publisher alive until the final cost/error events are sent.
                for task in tasks[1:]:
                    task.cancel()
                await asyncio.gather(*tasks[1:], return_exceptions=True)
                await self.shutdown()
                await asyncio.wait_for(self.outbox.join(), 2)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)


@server.rtc_session(agent_name=os.environ.get("LIVEKIT_AGENT_NAME", "ielts-examiner"))
async def entrypoint(ctx: JobContext):
    privacy()
    try:
        d = Dispatch.model_validate_json(ctx.job.metadata)
    except ValueError:
        ctx.shutdown(reason="invalid trusted dispatch metadata")
        return
    runtime = Runtime(ctx, d)
    ctx.add_shutdown_callback(runtime.shutdown)
    await ctx.connect()
    await runtime.run()
    ctx.shutdown(reason="examiner complete")


if __name__ == "__main__":
    os.environ["OTEL_SDK_DISABLED"] = "true"
    cli.run_app(server)
