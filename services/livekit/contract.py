"""Strict dispatch configuration and untrusted room-control parsing."""

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


TTS_MODELS = {
    "soniox": ["tts-rt-v2"],
    "cartesia": ["sonic-3.6", "sonic-3.5"],
    "elevenlabs": ["eleven_flash_v2_5", "eleven_turbo_v2_5"],
    "inworld": ["inworld-tts-2-flash", "inworld-tts-2"],
    "gradium": ["gradium-tts-beta", "default"],
}


class Config(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)
    stt: Literal["soniox", "elevenlabs"] = "soniox"
    sttModel: Literal["stt-rt-v5", "scribe_v2_realtime"] = "stt-rt-v5"
    llm: Literal["openai/gpt-6-luna", "deepseek/deepseek-v4.1-flash"] = "deepseek/deepseek-v4.1-flash"
    tts: Literal["soniox", "cartesia", "elevenlabs", "inworld", "gradium"] = "soniox"
    ttsModel: str = Field(default="tts-rt-v2", min_length=1, max_length=64)
    voice: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)] = "Adrian"
    turnDetection: Literal["audio", "vad"] = "audio"
    minEndpointDelay: float = Field(default=0.5, ge=0, le=10)
    maxEndpointDelay: float = Field(default=4.0, ge=0.1, le=10)
    vadSilence: float = Field(default=0.3, ge=0.1, le=2)
    interruptions: bool = True
    preemptiveGeneration: bool = False
    temperature: float = Field(default=0.5, ge=0, le=2)
    maxTokens: int = Field(default=400, ge=16, le=2048)

    @model_validator(mode="after")
    def consistent(self):
        if self.minEndpointDelay > self.maxEndpointDelay:
            raise ValueError("endpoint delays reversed")
        if self.sttModel != {"soniox": "stt-rt-v5", "elevenlabs": "scribe_v2_realtime"}[self.stt]:
            raise ValueError("STT model does not match provider")
        if self.ttsModel not in TTS_MODELS[self.tts]:
            raise ValueError("TTS model does not match provider")
        return self


class Dispatch(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sessionId: str = Field(min_length=1, max_length=200)
    userId: str = Field(min_length=1, max_length=200)
    participantIdentity: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=100000, repr=False)
    cuePrefix: str = Field(min_length=1, max_length=200, repr=False)
    reportUrl: str = Field(repr=False)
    reportToken: str = Field(min_length=1, max_length=4096, repr=False)
    cfg: dict = Field(default_factory=dict)
    # The only cue texts this room may send (None: the owner's playground, any text). The LLM runs on the server's key.
    cues: list[str] | None = Field(default=None, max_length=100, repr=False)

    @model_validator(mode="after")
    def validate_contract(self):
        url = urlsplit(self.reportUrl)
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.fragment:
            raise ValueError("invalid report URL")
        parts = self.cfg.get("parts", {})
        if not isinstance(parts, dict) or set(parts) - {"1", "2", "3"}:
            raise ValueError("invalid part overrides")
        self.config(1)
        self.config(2)
        self.config(3)
        return self

    def config(self, part: int) -> Config:
        base = {k: v for k, v in self.cfg.items() if k != "parts"}
        # Validate the base separately; overrides cannot hide invalid base settings.
        Config.model_validate(base)
        override = self.cfg.get("parts", {}).get(str(part), {})
        if not isinstance(override, dict) or set(override) - set(Config.model_fields):
            raise ValueError("invalid override")
        return Config.model_validate(base | override)


@dataclass
class Floor:
    started: bool = False
    hearing: bool = True
    replies: bool = True

    def listen(self, on: bool, fresh: bool):
        self.replies = on
        self.hearing = on or fresh


def control(expected: str, sender: str | None, payload: bytes) -> dict | None:
    if sender != expected or len(payload) > 8192:
        return None
    try:
        d = json.loads(payload)
    except (ValueError, UnicodeError):
        return None
    if not isinstance(d, dict):
        return None
    kind = d.get("type")
    if kind == "start" and set(d) == {"type"}:
        return d
    if kind == "cue" and set(d) <= {"type", "text", "key"} and isinstance(d.get("text"), str) and 0 < len(d["text"]) <= 4000:
        if "key" not in d or isinstance(d["key"], str) and len(d["key"]) <= 100:
            return d
    if kind == "listen" and set(d) == {"type", "on", "fresh"} and type(d["on"]) is bool and type(d["fresh"]) is bool:
        return d
    if kind == "configure" and set(d) == {"type", "part"} and type(d["part"]) is int and d["part"] in (1, 2, 3):
        return d
    return None


async def send_report(client, dispatch: Dispatch, report_id: str, entries: list, delay=1) -> bool:
    if not entries:
        return True
    body = dict(sessionId=dispatch.sessionId, userId=dispatch.userId, reportId=report_id, entries=entries)
    for attempt in range(3):
        try:
            r = await client.post(dispatch.reportUrl, json=body,
                                  headers={"x-livekit-report-token": dispatch.reportToken})
            r.raise_for_status()
            return True
        except Exception as e:
            # Status and body (the server's validation message), never the token or entries.
            res = getattr(e, "response", None)
            logging.getLogger("ielts.livekit").warning("Usage report %s failed (attempt %d): %s %s", report_id, attempt + 1,
                                                       res.status_code if res is not None else type(e).__name__,
                                                       res.text[:300] if res is not None else "")
            if attempt < 2:
                await asyncio.sleep(delay * 2 ** attempt)
    return False
