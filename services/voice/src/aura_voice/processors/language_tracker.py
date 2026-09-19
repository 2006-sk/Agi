"""Detect caller language from finals and retarget TTS + bridge replies."""

from __future__ import annotations

from typing import Any

from loguru import logger
from pipecat.frames.frames import Frame, TranscriptionFrame, TTSUpdateSettingsFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.gradium.tts import GradiumTTSService
from pipecat.transcriptions.language import Language

from aura_voice.language import GradiumLang, detect_language, normalize_lang
from aura_voice.processors.event_emitter import EventEmitter
from aura_voice.processors.gateway_bridge import GatewayBridge

_LANG_ENUM: dict[GradiumLang, Language] = {
    "en": Language.EN,
    "es": Language.ES,
    "fr": Language.FR,
    "de": Language.DE,
    "pt": Language.PT,
}


class LanguageTracker(FrameProcessor):
    """
    On each final transcript, infer language and:
    - update EventEmitter / GatewayBridge language
    - push TTSUpdateSettingsFrame so Gradium TTS matches
    """

    def __init__(
        self,
        *,
        bridge: GatewayBridge,
        emitter: EventEmitter,
        default_language: str = "en",
        enabled: bool = True,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.bridge = bridge
        self.emitter = emitter
        self.enabled = enabled
        self.current: GradiumLang = normalize_lang(default_language)
        self.bridge.language = self.current
        self.emitter.language = self.current

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        if (
            self.enabled
            and isinstance(frame, TranscriptionFrame)
            and direction == FrameDirection.DOWNSTREAM
        ):
            await self._maybe_switch(frame.text or "")

        await self.push_frame(frame, direction)

    async def _maybe_switch(self, text: str) -> None:
        chosen = detect_language(text, default=self.current)
        if chosen == self.current:
            return

        self.current = chosen
        self.bridge.language = chosen
        self.emitter.language = chosen
        logger.info("caller language switched to {}", chosen)
        await self.push_frame(
            TTSUpdateSettingsFrame(
                delta=GradiumTTSService.Settings(language=_LANG_ENUM[chosen])
            )
        )
