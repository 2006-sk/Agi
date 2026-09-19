"""Map Pipecat frames → AURA voice events and publish to the gateway."""

from __future__ import annotations

import array
import time
from collections.abc import Awaitable, Callable
from typing import Any

from loguru import logger
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    TranscriptionFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from aura_voice.events import (
    VoiceEvent,
    agent_interrupted,
    agent_speaking,
    audio_level,
    transcript_final,
    transcript_partial,
)

EventSink = Callable[[VoiceEvent], Awaitable[None]]


class EventEmitter(FrameProcessor):
    """
    Observes the pipeline and emits normalized voice events.
    Does not alter conversational flow — always pushes frames downstream.
    """

    def __init__(
        self,
        session_id: str,
        *,
        on_event: EventSink,
        language: str = "en",
        audio_level_hz: float = 15.0,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.session_id = session_id
        self.on_event = on_event
        self.language = language
        self._min_level_interval = 1.0 / max(audio_level_hz, 1.0)
        self._last_level_at = 0.0
        self._last_agent_text = ""
        self._agent_speaking = False

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        try:
            await self._handle(frame)
        except Exception:
            logger.exception("event_emitter failed session={}", self.session_id)

        await self.push_frame(frame, direction)

    async def _handle(self, frame: Frame) -> None:
        if isinstance(frame, InterimTranscriptionFrame):
            await self.on_event(
                transcript_partial(
                    self.session_id,
                    text=frame.text,
                    language=self.language,
                )
            )
            return

        if isinstance(frame, TranscriptionFrame):
            confidence = getattr(frame, "confidence", None)
            await self.on_event(
                transcript_final(
                    self.session_id,
                    text=frame.text,
                    confidence=confidence,
                    language=self.language,
                )
            )
            return

        if isinstance(frame, InputAudioRawFrame):
            await self._maybe_emit_level(frame)
            return

        if isinstance(frame, (BotStartedSpeakingFrame, TTSStartedFrame)):
            self._agent_speaking = True
            await self.on_event(
                agent_speaking(
                    self.session_id,
                    text=self._last_agent_text,
                    active=True,
                )
            )
            return

        if isinstance(frame, (BotStoppedSpeakingFrame, TTSStoppedFrame)):
            if self._agent_speaking:
                self._agent_speaking = False
                await self.on_event(
                    agent_speaking(
                        self.session_id,
                        text=self._last_agent_text,
                        active=False,
                    )
                )
            return

        if isinstance(frame, InterruptionFrame):
            await self.on_event(
                agent_interrupted(
                    self.session_id,
                    interrupted_text=self._last_agent_text,
                    reason="barge_in",
                )
            )
            self._agent_speaking = False
            return

        text = getattr(frame, "text", None)
        if isinstance(text, str) and text and "TTS" in type(frame).__name__:
            self._last_agent_text = text

    def note_agent_text(self, text: str) -> None:
        self._last_agent_text = text

    async def _maybe_emit_level(self, frame: InputAudioRawFrame) -> None:
        now = time.perf_counter()
        if now - self._last_level_at < self._min_level_interval:
            return
        self._last_level_at = now
        raw = frame.audio
        if not raw:
            return
        # Python 3.13+ removed audioop — compute PCM16 RMS manually
        samples = array.array("h")
        samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
        if not samples:
            return
        mean_sq = sum(int(s) * int(s) for s in samples) / len(samples)
        rms = mean_sq**0.5
        level = min(1.0, rms / 5000.0)
        await self.on_event(
            audio_level(self.session_id, level=level, speaker="caller")
        )
