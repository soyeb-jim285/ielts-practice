import json
import re
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from contract import Config, Dispatch, Floor, TTS_MODELS, control, send_report


def metadata(**overrides):
    return dict(sessionId="s", userId="u", participantIdentity="candidate", prompt="secret",
                cuePrefix="[APP CUE] ", reportUrl="https://api.example/report",
                reportToken="token", cfg=overrides)


def test_defaults_and_parts():
    d = Dispatch.model_validate(metadata(parts={"2": {"turnDetection": "vad", "voice": "other"}}))
    assert d.config(1).stt == "soniox"
    assert d.config(2).voice == "other"
    assert d.config(3).voice == "Adrian"


def test_shared_defaults_and_model_allowlists():
    shared = (Path(__file__).resolve().parents[3] / "packages/core/src/livekit.ts").read_text()
    defaults = shared.split("export const DEFAULT_LIVEKIT: LiveKitConfig = {")[1].split("};")[0]
    values = {k: json.loads(v.replace("'", '"')) for k, v in
              re.findall(r"(\w+): ('[^']*'|true|false|[\d.]+)", defaults)}
    assert Config().model_dump() == values
    models = shared.split("export const LIVEKIT_TTS_MODELS = {")[1].split("} as const")[0]
    assert TTS_MODELS == {k: json.loads(v.replace("'", '"')) for k, v in
                          re.findall(r"(\w+): (\[[^\]]*\])", models)}


@pytest.mark.parametrize("cfg", [{"llm": "anthropic/claude"}, {"minEndpointDelay": 4, "maxEndpointDelay": 1},
                                   {"temperature": float("nan")}, {"sttModel": "scribe_v2_realtime"},
                                   {"parts": {"2": {"llm": "bad"}}}, {"unknown": True},
                                   {"maxEndpointDelay": 10.01}, {"vadSilence": 2.01},
                                   {"vadSilence": 0.09}, {"maxTokens": 2049},
                                   {"ttsModel": "default"}, {"tts": "cartesia"},
                                   {"tts": "inworld", "ttsModel": "inworld-tts-1.5-max"},
                                   {"voice": " "}, {"voice": "a" * 129}])
def test_bad_config(cfg):
    with pytest.raises(ValueError):
        Dispatch.model_validate(metadata(**cfg))


def test_control_security():
    assert control('candidate', 'other', b'{"type":"start"}') is None
    assert control('candidate', 'candidate', b'{"type":"start"}') == {"type": "start"}
    for payload in [b'bad', b'[]', b'{"type":"configure","part":true}', b'{"type":"listen","on":"false","fresh":false}']:
        assert control('candidate', 'candidate', payload) is None


def test_floor_prep_and_long_turn():
    f = Floor()
    assert not f.started
    f.listen(False, False)
    assert not f.hearing and not f.replies
    f.listen(False, True)
    assert f.hearing and not f.replies
    f.listen(True, False)
    assert f.hearing and f.replies


async def test_report_retry_identical_id_and_payload():
    client = AsyncMock()
    response = AsyncMock()
    response.raise_for_status = lambda: None
    client.post.side_effect = [OSError(), response]
    d = Dispatch.model_validate(metadata())
    assert await send_report(client, d, "fixed-id", [{"costUsd": 0.01}], delay=0)
    assert client.post.call_count == 2
    assert client.post.call_args_list[0] == client.post.call_args_list[1]
    assert client.post.call_args.kwargs['headers'] == {'x-livekit-report-token': 'token'}


async def test_empty_report_never_posts():
    client = AsyncMock()
    assert await send_report(client, Dispatch.model_validate(metadata()), "id", [])
    client.post.assert_not_called()
