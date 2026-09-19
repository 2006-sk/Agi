"""Phase 1 — Local mic → Gradium STT → terminal transcripts.

Requires GRADIUM_API_KEY in .env

  uv run python scripts/01_stt_mic.py
  uv run python scripts/01_stt_mic.py --device 10
  uv run python scripts/_list_mics.py
"""

from __future__ import annotations

import argparse
import array
import asyncio
import os
import sys
import time

from dotenv import load_dotenv
from loguru import logger

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
load_dotenv(override=True)


def _list_input_devices() -> None:
    import pyaudio

    p = pyaudio.PyAudio()
    try:
        d = p.get_default_input_device_info()
        print(f"Default mic: [{d['index']}] {d['name']}")
    except Exception as exc:
        print(f"No default mic: {exc}")
    print("Input devices:")
    for i in range(p.get_device_count()):
        info = p.get_device_info_by_index(i)
        if int(info["maxInputChannels"]) > 0:
            print(
                f"  {i}: {info['name']} "
                f"(ch={info['maxInputChannels']}, "
                f"rate={int(info['defaultSampleRate'])})"
            )
    p.terminate()


def _rms_level(pcm16: bytes) -> float:
    samples = array.array("h")
    samples.frombytes(pcm16[: len(pcm16) - (len(pcm16) % 2)])
    if not samples:
        return 0.0
    mean_sq = sum(int(s) * int(s) for s in samples) / len(samples)
    return min(1.0, (mean_sq**0.5) / 5000.0)


async def main(device_index: int | None) -> None:
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.audio.vad.vad_analyzer import VADParams
    from pipecat.frames.frames import (
        Frame,
        InputAudioRawFrame,
        InterimTranscriptionFrame,
        TranscriptionFrame,
        UserStartedSpeakingFrame,
        UserStoppedSpeakingFrame,
        VADUserStartedSpeakingFrame,
        VADUserStoppedSpeakingFrame,
    )
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.processors.audio.vad_processor import VADProcessor
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
    from pipecat.services.gradium.stt import GradiumSTTService
    from pipecat.transcriptions.language import Language
    from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
    from pipecat.turns.user_turn_processor import UserTurnProcessor
    from pipecat.workers.runner import WorkerRunner

    api_key = os.getenv("GRADIUM_API_KEY")
    if not api_key:
        print("ERROR: Set GRADIUM_API_KEY in .env")
        sys.exit(1)

    print("=" * 60)
    _list_input_devices()
    if device_index is not None:
        print(f"Using input device index: {device_index}")
    else:
        print("Using system default input device")
    print("=" * 60)

    class MicMeterAndTranscripts(FrameProcessor):
        def __init__(self) -> None:
            super().__init__()
            self._last_meter = 0.0
            self._frames = 0

        async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
            await super().process_frame(frame, direction)

            if isinstance(frame, InputAudioRawFrame):
                self._frames += 1
                now = time.perf_counter()
                if now - self._last_meter >= 0.25:
                    self._last_meter = now
                    level = _rms_level(frame.audio)
                    bar = "#" * int(level * 20)
                    print(
                        f"\r[mic] level={level:0.2f} |{bar:<20}| frames={self._frames}   ",
                        end="",
                        flush=True,
                    )

            elif isinstance(frame, (VADUserStartedSpeakingFrame, UserStartedSpeakingFrame)):
                print("\n[vad] speech START")
            elif isinstance(frame, (VADUserStoppedSpeakingFrame, UserStoppedSpeakingFrame)):
                print("\n[vad] speech STOP (flushing STT)")
            elif isinstance(frame, InterimTranscriptionFrame):
                print(f"\n[partial] {frame.text}")
            elif isinstance(frame, TranscriptionFrame):
                print(f"\n[final]   {frame.text}")

            await self.push_frame(frame, direction)

    # Raise thresholds to ignore ambient / surround sound (tune via values below)
    vad = VADProcessor(
        vad_analyzer=SileroVADAnalyzer(
            params=VADParams(
                confidence=0.7,
                start_secs=0.25,
                stop_secs=0.4,
                min_volume=0.45,
            )
        )
    )
    transport = LocalAudioTransport(
        params=LocalAudioTransportParams(
            audio_in_enabled=True,
            audio_out_enabled=False,
            input_device_index=device_index,
        )
    )
    stt = GradiumSTTService(
        api_key=api_key,
        settings=GradiumSTTService.Settings(language=Language.EN),
    )
    pipeline = Pipeline(
        [
            transport.input(),
            vad,
            stt,
            UserTurnProcessor(),
            MicMeterAndTranscripts(),
        ]
    )
    worker = PipelineWorker(pipeline, params=PipelineParams(enable_metrics=True))
    runner = WorkerRunner(handle_sigint=True)

    print()
    print("READY — speak clearly into the mic now.")
    print("You should see [mic] levels move. Then [partial]/[final] text.")
    print("If levels stay at 0.00, pick another device: --device N")
    print("Ctrl+C to stop.")
    print()

    await runner.add_workers(worker)
    await runner.run()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--device",
        type=int,
        default=None,
        help="PyAudio input device index (see scripts/_list_mics.py)",
    )
    args = parser.parse_args()
    # Quieter pipecat debug so the speak prompt is visible
    logger.remove()
    logger.add(sys.stderr, level="INFO")
    asyncio.run(main(args.device))
