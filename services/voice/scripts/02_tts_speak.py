"""Phase 2 — Fixed text → Gradium TTS → speakers.

Requires GRADIUM_API_KEY in .env
Run from services/voice:
  uv run python scripts/02_tts_speak.py
  uv run python scripts/02_tts_speak.py --text "Hello, this is AURA."
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

from dotenv import load_dotenv
from loguru import logger

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
load_dotenv(override=True)


async def main(text: str) -> None:
    from pipecat.frames.frames import TTSSpeakFrame
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.services.gradium.tts import GradiumTTSService
    from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
    from pipecat.workers.runner import WorkerRunner

    api_key = os.getenv("GRADIUM_API_KEY")
    voice_id = os.getenv("GRADIUM_VOICE_ID", "_6Aslh2DxfmnRLmP")
    if not api_key:
        logger.error("Set GRADIUM_API_KEY in .env (copy from .env.example)")
        sys.exit(1)

    transport = LocalAudioTransport(
        params=LocalAudioTransportParams(
            audio_in_enabled=False,
            audio_out_enabled=True,
        )
    )
    tts = GradiumTTSService(
        api_key=api_key,
        settings=GradiumTTSService.Settings(voice=voice_id),
    )
    pipeline = Pipeline([tts, transport.output()])
    worker = PipelineWorker(pipeline, params=PipelineParams(enable_metrics=True))
    runner = WorkerRunner(handle_sigint=True)

    await runner.add_workers(worker)

    async def _speak_then_idle() -> None:
        await asyncio.sleep(0.5)
        logger.info("Speaking: {}", text)
        await worker.queue_frame(TTSSpeakFrame(text))
        # Keep process alive long enough for audio to play
        await asyncio.sleep(max(4.0, len(text) * 0.08))
        await runner.cancel()

    asyncio.create_task(_speak_then_idle())
    await runner.run()
    logger.info("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--text",
        default="This is AURA. Please stay on the line while I gather information.",
    )
    args = parser.parse_args()
    asyncio.run(main(args.text))
