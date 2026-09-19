"""Voice event payload shapes Aditya produces (Shresth wraps the envelope)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

Speaker = Literal["caller", "agent"]
VoiceEventType = Literal[
    "call.started",
    "call.ended",
    "audio.level",
    "transcript.partial",
    "transcript.final",
    "agent.speaking",
    "agent.interrupted",
    "voice.error",
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


class VoiceEvent(BaseModel):
    """Internal message before Shresth adds sequence / canonical envelope fields."""

    event_id: str = Field(default_factory=lambda: f"evt_{uuid4().hex[:12]}")
    session_id: str
    type: VoiceEventType
    timestamp: str = Field(default_factory=utc_now_iso)
    payload: dict[str, Any] = Field(default_factory=dict)


def call_started(
    session_id: str,
    *,
    caller_label: str = "caller",
    language: str = "en",
    channel: str = "voice",
) -> VoiceEvent:
    return VoiceEvent(
        session_id=session_id,
        type="call.started",
        payload={
            "caller_label": caller_label,
            "language": language,
            "channel": channel,
        },
    )


def call_ended(session_id: str, *, reason: str = "normal") -> VoiceEvent:
    return VoiceEvent(
        session_id=session_id,
        type="call.ended",
        payload={"reason": reason},
    )


def audio_level(
    session_id: str, *, level: float, speaker: Speaker
) -> VoiceEvent:
    return VoiceEvent(
        session_id=session_id,
        type="audio.level",
        payload={"level": max(0.0, min(1.0, level)), "speaker": speaker},
    )


def transcript_partial(
    session_id: str,
    *,
    text: str,
    speaker: Speaker = "caller",
    confidence: float | None = None,
    language: str = "en",
) -> VoiceEvent:
    payload: dict[str, Any] = {
        "speaker": speaker,
        "text": text,
        "language": language,
    }
    if confidence is not None:
        payload["confidence"] = confidence
    return VoiceEvent(
        session_id=session_id, type="transcript.partial", payload=payload
    )


def transcript_final(
    session_id: str,
    *,
    text: str,
    speaker: Speaker = "caller",
    confidence: float | None = None,
    language: str = "en",
) -> VoiceEvent:
    payload: dict[str, Any] = {
        "speaker": speaker,
        "text": text,
        "language": language,
    }
    if confidence is not None:
        payload["confidence"] = confidence
    return VoiceEvent(
        session_id=session_id, type="transcript.final", payload=payload
    )


def agent_speaking(
    session_id: str, *, text: str, active: bool
) -> VoiceEvent:
    return VoiceEvent(
        session_id=session_id,
        type="agent.speaking",
        payload={"text": text, "active": active},
    )


def agent_interrupted(
    session_id: str, *, interrupted_text: str, reason: str
) -> VoiceEvent:
    return VoiceEvent(
        session_id=session_id,
        type="agent.interrupted",
        payload={"interrupted_text": interrupted_text, "reason": reason},
    )


def voice_error(
    session_id: str, *, code: str, message: str, recoverable: bool = True
) -> VoiceEvent:
    return VoiceEvent(
        session_id=session_id,
        type="voice.error",
        payload={
            "code": code,
            "message": message,
            "recoverable": recoverable,
        },
    )
