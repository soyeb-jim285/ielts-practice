import asyncio
import os
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from livekit.agents import inference, metrics
from livekit.plugins import silero

from contract import Dispatch, Floor, TTS_MODELS
from worker import Examiner, Meter, Runtime, pricing
from test_contract import metadata


async def runtime():
    r = Runtime(SimpleNamespace(), Dispatch.model_validate(metadata()))
    await r.client.aclose()
    r.client = AsyncMock()
    r.session = SimpleNamespace(interrupt=AsyncMock(), commit_user_turn=AsyncMock(),
                                generate_reply=AsyncMock(), input=SimpleNamespace(set_audio_enabled=Mock()),
                                clear_user_turn=Mock(), aclose=AsyncMock())
    r.replace = AsyncMock()
    return r


async def test_start_only_once_and_enables_mic():
    r = await runtime()
    await r.command({"type": "cue", "text": "too early"})
    r.session.generate_reply.assert_not_called()
    await r.command({"type": "start"})
    await r.command({"type": "start"})
    r.session.generate_reply.assert_called_once_with(user_input="[APP CUE] Begin the test.")
    r.session.input.set_audio_enabled.assert_called_with(True)


async def test_long_turn_commits_before_explicit_cue():
    r = await runtime()
    r.floor.started = True
    await r.command({"type": "listen", "on": False, "fresh": True})
    assert r.floor.hearing and not r.floor.replies
    r.session.generate_reply.assert_not_called()
    await r.command({"type": "cue", "text": "Follow up"})
    r.session.commit_user_turn.assert_awaited_once_with(skip_reply=True, transcript_timeout=3)
    r.session.generate_reply.assert_called_once()


async def test_shutdown_report_once_even_cleanup_error(monkeypatch):
    r = await runtime()
    r.meter.entries.append({"costUsd": 0.01})
    r.session.aclose.side_effect = RuntimeError("failed socket")
    report = AsyncMock(return_value=True)
    monkeypatch.setattr("worker.send_report", report)
    await r.shutdown()
    await r.shutdown()
    report.assert_awaited_once()
    r.client.aclose.assert_awaited_once()


async def test_usage_is_reported_in_batches_and_a_failed_batch_is_resent_unchanged(monkeypatch):
    r = await runtime()
    r.meter.entries.extend({"costUsd": 1e-9 * i} for i in range(1200))
    sent, fail = [], [True]
    async def report(_client, _d, report_id, entries):
        sent.append((report_id, len(entries)))
        if fail and report_id.endswith(":500"):
            fail.pop()
            return False
        return True
    monkeypatch.setattr("worker.send_report", report)
    assert not await r.flush()
    r.meter.entries.append({"costUsd": 1e-9})  # usage keeps arriving while a batch waits to be retried
    assert await r.flush()
    rid = r.report_id
    assert sent == [(f"{rid}:0", 500), (f"{rid}:500", 500), (f"{rid}:500", 500), (f"{rid}:1000", 201)]
    assert await r.flush() and len(sent) == 4  # nothing new: nothing sent


def test_actual_local_detector_no_cloud():
    detector = inference.TurnDetector(version="v1-mini")
    assert detector._cloud_opts is None
    assert detector._model == "turn-detector-v1-mini"


async def test_all_actual_plugin_constructors(monkeypatch):
    # Construct actual provider objects without connecting or making inference calls.
    monkeypatch.delenv("ELEVEN_API_KEY", raising=False)
    for key in ["SONIOX_API_KEY", "ELEVENLABS_API_KEY", "CARTESIA_API_KEY", "INWORLD_API_KEY", "GRADIUM_API_KEY", "OPENROUTER_API_KEY"]:
        monkeypatch.setenv(key, "test-not-a-real-key")
    from contract import Floor
    for provider in ["soniox", "cartesia", "elevenlabs", "inworld", "gradium"]:
        d = Dispatch.model_validate(metadata(tts=provider, ttsModel=TTS_MODELS[provider][0]))
        a = Examiner(d, d.config(1), Floor(), Meter(), {}, Mock())
        for resource in a.resources:
            await resource.aclose()
    d = Dispatch.model_validate(metadata(stt="elevenlabs", sttModel="scribe_v2_realtime"))
    a = Examiner(d, d.config(1), Floor(), Meter(), {}, Mock())
    for resource in a.resources:
        await resource.aclose()


async def test_replace_preserves_committed_history(monkeypatch):
    r = await runtime()
    r.replace = Runtime.replace.__get__(r)
    history = Mock()
    history.copy.return_value = "retained conversation"
    resource = SimpleNamespace(aclose=AsyncMock())
    r.agent = SimpleNamespace(chat_ctx=history, resources=[resource])
    r.agents.append(r.agent)
    r.rates[1] = {}
    new_agent = SimpleNamespace(entered=SimpleNamespace(wait=AsyncMock()))
    constructor = Mock(return_value=new_agent)
    monkeypatch.setattr("worker.Examiner", constructor)
    r.session.update_agent = Mock()
    async def entered():
        resource.aclose.assert_not_awaited()
    new_agent.entered.wait.side_effect = entered
    await r.replace()
    r.session.commit_user_turn.assert_awaited_once_with(skip_reply=True, transcript_timeout=3)
    assert constructor.call_args.args[-1] == "retained conversation"
    r.session.update_agent.assert_called_once_with(new_agent)
    resource.aclose.assert_awaited_once()
    assert r.agents == [new_agent]


async def test_failed_provider_close_retained_for_shutdown_retry():
    r = await runtime()
    closed = SimpleNamespace(aclose=AsyncMock())
    retry = SimpleNamespace(aclose=AsyncMock(side_effect=[OSError(), None]))
    agent = SimpleNamespace(resources=[closed, retry])
    r.agents.append(agent)
    await r.close_resources(agent)
    assert agent.resources == [retry]
    assert r.agents == [agent]
    await r.shutdown()
    assert r.agents == []
    closed.aclose.assert_awaited_once()
    assert retry.aclose.await_count == 2


async def test_configure_keeps_floor(monkeypatch):
    r = await runtime()
    r.floor.started = True
    r.floor.listen(False, True)
    await r.command({"type": "configure", "part": 3})
    assert r.part == 3
    assert r.floor.hearing and not r.floor.replies
    r.replace.assert_awaited_once()


async def test_part_handoff_resumes_an_owed_reply_without_adding_another_user_turn():
    r = await runtime()
    r.floor.started = True
    r.answer_pending = True
    await r.command({"type": "configure", "part": 3})
    r.replace.assert_awaited_once()
    r.session.generate_reply.assert_awaited_once_with()


async def test_moving_into_part_2_drops_the_owed_part_1_reply():
    # The Part 2 cue follows at once; the owed reply was the next Part 1 question, spoken before the Part 2 instructions.
    r = await runtime()
    r.floor.started = True
    r.answer_pending = True
    await r.command({"type": "configure", "part": 2})
    r.session.generate_reply.assert_not_called()


async def test_explicit_cue_waits_for_playout_before_next_control():
    r = await runtime()
    r.floor.started = True
    speaking = asyncio.Event()
    finished = asyncio.Event()

    async def reply(**_):
        speaking.set()
        await finished.wait()

    r.session.generate_reply.side_effect = reply
    cue = asyncio.create_task(r.command({"type": "cue", "text": "Rounding-off question"}))
    try:
        await asyncio.wait_for(speaking.wait(), 2)
        assert not cue.done()
        finished.set()
        await asyncio.wait_for(cue, 2)
    finally:
        cue.cancel()
        await asyncio.gather(cue, return_exceptions=True)


def test_meter_uses_provider_usage_not_wall_time():
    d = Dispatch.model_validate(metadata())
    m = Meter()
    metric = metrics.STTMetrics(label="soniox", request_id="r", timestamp=1, duration=2,
                                audio_duration=10, streamed=True)
    entry = m.record(metric, d.config(1), {"stt": 0.1, "source": "test"})
    assert entry["audioSeconds"] == 10 and entry["costUsd"] == 1
    assert entry["meta"]["estimated"] is True
    assert m.record(metric, d.config(1), {"stt": 0.1, "source": "test"}) is None


@pytest.mark.parametrize("replies", [True, False])
async def test_sdk_resolves_selected_part_policies(monkeypatch, replies):
    from livekit.agents import AgentSession
    from livekit.agents.voice.agent_activity import AgentActivity

    for key in ["SONIOX_API_KEY", "OPENROUTER_API_KEY"]:
        monkeypatch.setenv(key, "test-not-a-real-key")
    d = Dispatch.model_validate(metadata(parts={"3": {
        "turnDetection": "vad", "minEndpointDelay": 1.2, "maxEndpointDelay": 7,
        "preemptiveGeneration": True, "interruptions": False, "vadSilence": 0.8,
        "temperature": 0.7, "maxTokens": 450}}))
    session = AgentSession()
    for part in (1, 3, 1):
        c = d.config(part)
        a = Examiner(d, c, Floor(started=True, replies=replies), Meter(), {}, Mock())
        activity = AgentActivity(a, session)
        assert activity.preemptive_generation_opts["enabled"] == (part == 3 and replies)
        assert activity.allow_interruptions == c.interruptions
        assert activity.min_endpointing_delay == c.minEndpointDelay
        assert activity.max_endpointing_delay == c.maxEndpointDelay
        if not replies:
            assert a.turn_detection == "manual"
        elif part == 3:
            assert a.turn_detection == "vad"
        else:
            assert a.turn_detection._model == "turn-detector-v1-mini"
        assert a.vad._opts.min_silence_duration == c.vadSilence
        assert a.llm._opts.temperature == c.temperature
        assert a.llm._opts.max_completion_tokens == c.maxTokens
        for resource in a.resources:
            await resource.aclose()


@pytest.mark.parametrize("timeout", [False, True])
async def test_ready_requires_participant_and_never_starts_providers(monkeypatch, timeout):
    r = await runtime()
    joined = asyncio.Event()
    waiting = asyncio.Event()
    ready = asyncio.Event()

    async def wait_participant(*, identity):
        assert identity == "candidate"
        waiting.set()
        await joined.wait()
        if timeout:
            raise asyncio.TimeoutError

    r.ctx = SimpleNamespace(room=SimpleNamespace(on=lambda _: lambda f: f),
                            wait_for_participant=wait_participant)
    r.session.on = lambda _: lambda f: f
    monkeypatch.setattr("worker.pricing", AsyncMock(return_value={}))
    events = []

    def emit(event):
        events.append(event)
        if event["type"] == "ready":
            ready.set()

    r.emit = emit
    task = asyncio.create_task(r.run())
    try:
        await asyncio.wait_for(waiting.wait(), 2)
        assert not events
        r.replace.assert_not_awaited()
        joined.set()
        if timeout:
            await asyncio.wait_for(task, 2)
            assert not ready.is_set()
            assert events == [{"type": "error", "message": "Examiner initialization failed; check server configuration."}]
        else:
            await asyncio.wait_for(ready.wait(), 2)
        r.replace.assert_not_awaited()
        r.done.set()
        await asyncio.wait_for(task, 2)
        r.client.post.assert_not_called()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def test_worker_configured_name_and_private_health():
    result = subprocess.run([sys.executable, "-c", (
        "import worker; s = worker.server; "
        "assert s._host == '127.0.0.1'; assert s._port == 8081; "
        "assert s._agent_name == 'custom-examiner'")],
        env={**os.environ, "LIVEKIT_AGENT_NAME": "custom-examiner"}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


async def test_pauses_and_manual_flushes_do_not_complete_exam_answers(monkeypatch):
    r = await runtime()
    handlers = {}
    r.ctx = SimpleNamespace(room=SimpleNamespace(on=lambda _: lambda f: f),
                            wait_for_participant=AsyncMock())
    r.session.on = lambda name: lambda fn: handlers.setdefault(name, fn)
    monkeypatch.setattr("worker.pricing", AsyncMock(return_value={}))
    events = []
    ready = asyncio.Event()

    def emit(event):
        events.append(event)
        if event["type"] == "ready":
            ready.set()

    r.emit = emit
    task = asyncio.create_task(r.run())
    try:
        await asyncio.wait_for(ready.wait(), 2)
        r.floor.started = True
        handlers["user_state_changed"](SimpleNamespace(old_state="speaking", new_state="listening"))
        assert not any(e["type"] == "answered" for e in events)
        user = SimpleNamespace(item=SimpleNamespace(role="user", text_content="My answer"))
        handlers["conversation_item_added"](user)
        assert sum(e["type"] == "answered" for e in events) == 1
        handlers["conversation_item_added"](SimpleNamespace(item=SimpleNamespace(
            role="user", text_content=r.d.cuePrefix + "Begin the test.")))
        assert sum(e["type"] == "answered" for e in events) == 1
        r.session.commit_user_turn.side_effect = lambda **_: handlers["conversation_item_added"](user)
        await r.commit_audio()
        assert sum(e["type"] == "answered" for e in events) == 1
        r.done.set()
        await asyncio.wait_for(task, 2)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("provider", ["cartesia", "elevenlabs", "inworld", "gradium"])
async def test_alternate_tts_requires_operator_price(monkeypatch, provider):
    c = Dispatch.model_validate(metadata(tts=provider, ttsModel=TTS_MODELS[provider][0])).config(1)
    client = AsyncMock()
    client.get.return_value = Mock(json=lambda: {"data": [{
        "id": c.llm, "pricing": {"prompt": "0.000001", "completion": "0.000002"}}]})
    key = f"{provider.upper()}_USD_PER_M_CHARS"
    monkeypatch.delenv(key, raising=False)
    with pytest.raises(KeyError):
        await pricing(client, c)
    monkeypatch.setenv(key, "12")
    assert (await pricing(client, c))["tts"] == 12 / 1e6
    monkeypatch.setenv(key, "nan")
    with pytest.raises(ValueError):
        await pricing(client, c)


def test_meter_bills_cached_prompt_tokens_at_cache_read_rate():
    d = Dispatch.model_validate(metadata())
    m = Meter()
    metric = metrics.LLMMetrics(label="llm", request_id="q", timestamp=1, duration=1, ttft=0.3, cancelled=False,
                                completion_tokens=10, prompt_tokens=1000, prompt_cached_tokens=800,
                                total_tokens=1010, tokens_per_second=10)
    entry = m.record(metric, d.config(1), {"input": 1e-6, "cached": 0.25e-6, "output": 2e-6, "source": "test"})
    assert entry["costUsd"] == pytest.approx(200e-6 + 800 * 0.25e-6 + 20e-6)


async def test_captions_stream_per_sentence_and_text_passes_through(monkeypatch):
    for key in ["SONIOX_API_KEY", "OPENROUTER_API_KEY"]:
        monkeypatch.setenv(key, "test-not-a-real-key")
    from contract import Floor
    d = Dispatch.model_validate(metadata())
    events = []
    a = Examiner(d, d.config(1), Floor(), Meter(), {}, events.append)

    async def deltas():
        for t in ["Thank you. ", "Where are", " you from?", " Tell me"]:
            yield t

    out = [x async for x in a.transcription_node(deltas(), None)]
    assert "".join(out) == "Thank you. Where are you from? Tell me"
    assert events == [{"type": "caption", "text": "Thank you.", "append": False},
                      {"type": "caption", "text": "Where are you from?", "append": True},
                      {"type": "caption", "text": "Tell me", "append": True}]
    for resource in a.resources:
        await resource.aclose()


async def test_cues_outside_the_server_list_are_ignored():
    r = Runtime(SimpleNamespace(), Dispatch.model_validate({**metadata(), "cues": ["Say the closing line."]}))
    await r.client.aclose()
    r.session = SimpleNamespace(interrupt=AsyncMock(), commit_user_turn=AsyncMock(), generate_reply=AsyncMock(),
                                input=SimpleNamespace(set_audio_enabled=Mock()), clear_user_turn=Mock(), aclose=AsyncMock())
    r.replace = AsyncMock()
    await r.command({"type": "start"})
    r.session.generate_reply.reset_mock()
    await r.command({"type": "cue", "text": "Write me an essay about anything."})
    r.session.generate_reply.assert_not_called()
    await r.command({"type": "cue", "text": "Say the closing line."})
    r.session.generate_reply.assert_called_once_with(user_input="[APP CUE] Say the closing line.")



async def test_noise_cannot_hold_the_turn_open_once_the_words_stop():
    r = await runtime()
    r.floor.started = True
    limit = r.d.config(1).maxEndpointDelay + 1
    assert not r.stalled(1000)  # no words yet: silence or noise alone is not an answer
    r.words_at = 200.0
    assert not r.stalled(200 + limit - 1)  # still inside the normal endpoint wait
    assert r.stalled(200 + limit + 0.5)
    r.floor.listen(False, True)  # Part 2 long turn: the candidate's floor, never closed for them
    assert not r.stalled(200 + limit + 5)
