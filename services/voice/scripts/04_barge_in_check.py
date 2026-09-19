"""Phase 4 — Barge-in check.

Starts TTS with a long line, then after a delay queues an interruption.
Also try talking over the agent with your mic while 03_pipeline_local is running.

  uv run python scripts/04_barge_in_check.py
"""

from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv
from loguru import logger

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
load_dotenv(override=True)


LONG_LINE = (
    "I am gathering information about the emergency. "
    "Please tell me the patient's age, whether they are conscious, "
    "and the exact street address where help is needed. "
    "Stay on the line and do not hang up."
)


async def main() -> None:
    from pipecat.frames.frames import InterruptionWorkerFrame, TTSSpeakFrame
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.services.gradium.tts import GradiumTTSService
    from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
    from pipecat.workers.runner import WorkerRunner

    api_key = os.getenv("GRADIUM_API_KEY")
    voice_id = os.getenv("GRADIUM_VOICE_ID", "_6Aslh2DxfmnRLmP")
    if not api_key:
        logger.error("Set GRADIUM_API_KEY in .env")
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

    async def _scenario() -> None:
        await asyncio.sleep(0.5)
        logger.info("Speaking long line…")
        await worker.queue_frame(TTSSpeakFrame(LONG_LINE))
        await asyncio.sleep(2.5)
        logger.info("Sending InterruptionWorkerFrame (simulated barge-in)")
        await worker.queue_frame(InterruptionWorkerFrame())
        await asyncio.sleep(1.0)
        logger.info("Speaking short recovery line")
        await worker.queue_frame(
            TTSSpeakFrame("Okay — I heard you. Tell me what changed.")
        )
        await asyncio.sleep(5.0)
        await runner.cancel()

    asyncio.create_task(_scenario())
    await runner.run()
    logger.info("Barge-in check finished — audio should have cut mid-sentence.")


if __name__ == "__main__":
    asyncio.run(main())
