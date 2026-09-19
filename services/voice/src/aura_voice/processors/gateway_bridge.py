"""Bridge finalized caller speech to Shresth; speak only gateway-approved text."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

from loguru import logger
from pipecat.frames.frames import Frame, TranscriptionFrame, TTSSpeakFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from aura_voice.clients.gateway import GatewayClient
from aura_voice.metrics import TurnMetrics
from aura_voice.language import (
    GradiumLang,
    normalize_lang,
    safe_fallback,
)
from aura_voice.local_protocol import local_protocol_reply

ReplyHandler = Callable[[str], Awaitable[None]]


class GatewayBridge(FrameProcessor):
    """
    On transcript.final (TranscriptionFrame): ask gateway for approved reply text.
    Never invents emergency instructions — only speaks gateway (or safe fallback) text.
    With local_echo=True, uses a deterministic medical-protocol mock for bring-up.
    """

    def __init__(
        self,
        session_id: str,
        *,
        gateway: GatewayClient,
        safe_fallback_line: str,
        language: str = "en",
        local_echo: bool = False,
        on_agent_text: Callable[[str], None] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.session_id = session_id
        self.gateway = gateway
        self.safe_fallback_line = safe_fallback_line
        self.language: GradiumLang = normalize_lang(language)
        # When True (local scripts before gateway exists), use local protocol mock.
        self.local_echo = local_echo
        self.on_agent_text = on_agent_text
        self._busy = False

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and direction == FrameDirection.DOWNSTREAM:
            await self.push_frame(frame, direction)
            text = (frame.text or "").strip()
            # Ignore tiny / noise-hallucination fragments
            if len(text) < 4 or len(text.split()) < 2:
                logger.debug("skipping short final transcript: {!r}", text)
                return
            await self._handle_final(text)
            return

        await self.push_frame(frame, direction)

    async def _handle_final(self, text: str) -> None:
        cleaned = (text or "").strip()
        if not cleaned or self._busy:
            return
        self._busy = True
        turn = TurnMetrics(session_id=self.session_id, turn_id=uuid4().hex[:8])
        turn.mark_stt_final()
        try:
            reply = await self._resolve_reply(cleaned, turn)
            if reply:
                if self.on_agent_text:
                    self.on_agent_text(reply)
                await self.push_frame(TTSSpeakFrame(reply))
                turn.mark_tts_first_byte()
        finally:
            turn.mark_turn_complete()
            self._busy = False

    async def _resolve_reply(self, text: str, turn: TurnMetrics) -> str | None:
        if self.local_echo:
            reply = local_protocol_reply(self.session_id, text, self.language)
            logger.info(
                "local_protocol session={} heard={!r} -> reply={!r}",
                self.session_id,
                text[:80],
                reply[:80],
            )
            return reply

        turn.mark_gateway_request()
        result = await self.gateway.submit_utterance(
            self.session_id, text, language=self.language
        )
        turn.mark_gateway_response()

        if not result:
            logger.warning(
                "gateway unavailable — safe fallback session={}", self.session_id
            )
            return safe_fallback(self.language, self.safe_fallback_line)

        reply = result.get("reply_text") or result.get("text")
        if not reply or not str(reply).strip():
            logger.warning("gateway returned empty reply session={}", self.session_id)
            return safe_fallback(self.language, self.safe_fallback_line)
        return str(reply).strip()

    async def speak(self, text: str) -> None:
        """External /internal/speak entry — only approved text should be passed in."""
        cleaned = (text or "").strip()
        if not cleaned:
            return
        if self.on_agent_text:
            self.on_agent_text(cleaned)
        await self.push_frame(TTSSpeakFrame(cleaned))
