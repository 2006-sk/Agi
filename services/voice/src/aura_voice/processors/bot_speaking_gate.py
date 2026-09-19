"""Gate caller audio / barge-in while the agent is speaking (noisy-room fix)."""

from __future__ import annotations

from typing import Any, Literal

from loguru import logger
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

BargeInMode = Literal["off", "transcript", "vad"]


class BotSpeakingGate(FrameProcessor):
    """
    Reduces false barge-ins from ambient / TV audio.

    Modes:
      - off: while agent speaks, replace mic audio with silence and drop
        InterruptionFrame / interim transcripts (agent finishes the line)
      - transcript: allow audio; only real STT text should interrupt
        (pair with VAD enable_interruptions=False)
      - vad: pass-through (original sensitive behavior)
    """

    def __init__(
        self,
        *,
        mode: BargeInMode = "off",
        min_interrupt_chars: int = 12,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.mode: BargeInMode = mode
        self.min_interrupt_chars = min_interrupt_chars
        self._bot_speaking = False

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
            await self.push_frame(frame, direction)
            return

        if not self._bot_speaking or self.mode == "vad":
            await self.push_frame(frame, direction)
            return

        # Bot is speaking — apply gate
        if self.mode == "off":
            if isinstance(frame, InputAudioRawFrame):
                # Feed silence so Gradium doesn't hear TV / room noise over TTS
                silent = InputAudioRawFrame(
                    audio=b"\x00" * len(frame.audio),
                    sample_rate=frame.sample_rate,
                    num_channels=frame.num_channels,
                )
                await self.push_frame(silent, direction)
                return
            if isinstance(frame, (InterruptionFrame, InterimTranscriptionFrame)):
                return
            await self.push_frame(frame, direction)
            return

        # transcript mode: drop empty/short interims & raw interruption frames
        if isinstance(frame, InterruptionFrame):
            return
        if isinstance(frame, InterimTranscriptionFrame):
            text = (frame.text or "").strip()
            if len(text) < self.min_interrupt_chars:
                return
            logger.debug("barge-in allowed via transcript ({} chars)", len(text))
            await self.push_frame(frame, direction)
            return

        await self.push_frame(frame, direction)
