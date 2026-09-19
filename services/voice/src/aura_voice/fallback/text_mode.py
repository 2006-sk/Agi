"""Text-mode helpers — same downstream contracts without Gradium audio."""

from __future__ import annotations

from typing import Any

from aura_voice.clients.gateway import GatewayClient
from aura_voice.config import Settings
from aura_voice.events import call_ended, call_started, transcript_final


async def run_text_turn(
    gateway: GatewayClient,
    settings: Settings,
    session_id: str,
    text: str,
    *,
    language: str = "en",
) -> dict[str, Any]:
    await gateway.publish_event(
        transcript_final(session_id, text=text, language=language)
    )
    result = await gateway.submit_utterance(session_id, text, language=language)
    reply = None
    if result:
        reply = result.get("reply_text") or result.get("text")
    if not reply:
        reply = settings.safe_fallback_line
    return {"session_id": session_id, "reply_text": reply}


async def demo_text_session(
    gateway: GatewayClient,
    settings: Settings,
    session_id: str,
    utterances: list[str],
    *,
    language: str = "en",
) -> list[dict[str, Any]]:
    await gateway.publish_event(
        call_started(session_id, language=language, channel="text")
    )
    turns: list[dict[str, Any]] = []
    for text in utterances:
        turns.append(
            await run_text_turn(
                gateway, settings, session_id, text, language=language
            )
        )
    await gateway.publish_event(call_ended(session_id, reason="text_demo_complete"))
    return turns
