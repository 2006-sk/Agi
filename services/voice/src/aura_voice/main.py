"""FastAPI entrypoint — session lifecycle + /internal/speak."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

from aura_voice.config import get_settings
from aura_voice.events import transcript_final
from aura_voice.session_manager import SessionManager

manager = SessionManager()


class StartSessionBody(BaseModel):
    session_id: str
    language: str = "en"
    local_echo: bool = False


class SpeakBody(BaseModel):
    session_id: str
    text: str = Field(min_length=1)


class CancelBody(BaseModel):
    session_id: str
    reason: str = "manual"


class UtteranceBody(BaseModel):
    """Text-mode fallback: inject caller text without mic/STT."""

    session_id: str
    text: str = Field(min_length=1)
    language: str = "en"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    logger.info(
        "aura-voice starting mode={} gateway={}",
        settings.voice_mode,
        settings.gateway_url,
    )
    if not settings.gradium_api_key and settings.voice_mode == "live":
        logger.warning(
            "GRADIUM_API_KEY is empty — live mode will fail until you set .env"
        )
    await manager.startup()
    yield
    await manager.shutdown()


app = FastAPI(title="AURA Voice", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "ok": True,
        "mode": settings.voice_mode,
        "gradium_configured": bool(settings.gradium_api_key),
        "active_sessions": list(manager.sessions.keys()),
    }


@app.post("/sessions/start")
async def start_session(body: StartSessionBody) -> dict[str, Any]:
    manager.local_echo = body.local_echo
    try:
        await manager.start_session(body.session_id, language=body.language)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"session_id": body.session_id, "status": "started"}


@app.post("/sessions/end")
async def end_session(body: CancelBody) -> dict[str, Any]:
    await manager.end_session(body.session_id, reason=body.reason)
    return {"session_id": body.session_id, "status": "ended"}


@app.post("/internal/speak")
async def internal_speak(body: SpeakBody) -> dict[str, Any]:
    """Stream approved agent text through Gradium TTS."""
    try:
        await manager.speak(body.session_id, body.text)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"session_id": body.session_id, "status": "speaking"}


@app.post("/internal/cancel")
async def internal_cancel(body: CancelBody) -> dict[str, Any]:
    try:
        await manager.cancel_speech(body.session_id, reason=body.reason)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"session_id": body.session_id, "status": "cancelled"}


@app.post("/internal/utterance")
async def internal_utterance(body: UtteranceBody) -> dict[str, Any]:
    """
    Text-mode fallback: publish transcript.final and ask gateway for a reply,
    then speak it if a live session exists.
    """
    gateway = manager.gateway
    if not gateway:
        raise HTTPException(status_code=503, detail="gateway not ready")

    await gateway.publish_event(
        transcript_final(
            body.session_id,
            text=body.text,
            language=body.language,
        )
    )
    result = await gateway.submit_utterance(
        body.session_id, body.text, language=body.language
    )
    reply = None
    if result:
        reply = result.get("reply_text") or result.get("text")
    if not reply:
        reply = get_settings().safe_fallback_line

    if body.session_id in manager.sessions:
        await manager.speak(body.session_id, str(reply))

    return {
        "session_id": body.session_id,
        "reply_text": reply,
        "spoke": body.session_id in manager.sessions,
    }


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "aura_voice.main:app",
        host=settings.voice_host,
        port=settings.voice_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
