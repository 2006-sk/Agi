"""HTTP client for Shresth's gateway — utterance ingest + voice event fan-in."""

from __future__ import annotations

from typing import Any

import httpx
from loguru import logger

from aura_voice.events import VoiceEvent


class GatewayClient:
    def __init__(self, base_url: str, timeout: float = 15.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=timeout)

    async def close(self) -> None:
        await self._client.aclose()

    async def publish_event(self, event: VoiceEvent) -> None:
        """POST voice events for Shresth to envelope + sequence + WS broadcast."""
        try:
            response = await self._client.post(
                "/internal/voice-events",
                json=event.model_dump(),
            )
            if response.status_code >= 400:
                logger.warning(
                    "gateway event reject status={} type={} session={}",
                    response.status_code,
                    event.type,
                    event.session_id,
                )
        except httpx.HTTPError as exc:
            logger.warning(
                "gateway event failed type={} session={} err={}",
                event.type,
                event.session_id,
                type(exc).__name__,
            )

    async def submit_utterance(
        self, session_id: str, text: str, *, language: str = "en"
    ) -> dict[str, Any] | None:
        """
        Send finalized caller text. Expected response shape (negotiable with Shresth):
        { "reply_text": "...", "session_id": "..." }
        """
        try:
            response = await self._client.post(
                f"/api/calls/{session_id}/utterance",
                json={"text": text, "speaker": "caller", "language": language},
            )
            if response.status_code >= 400:
                logger.warning(
                    "utterance reject status={} session={}",
                    response.status_code,
                    session_id,
                )
                return None
            return response.json()
        except httpx.HTTPError as exc:
            logger.warning(
                "utterance failed session={} err={}",
                session_id,
                type(exc).__name__,
            )
            return None
