"""Phase 3 — Full local loop: mic → Gradium STT → local echo reply → Gradium TTS.

Uses local_echo=True so you do not need Shresth's gateway yet.
Requires GRADIUM_API_KEY in .env

  uv run python scripts/03_pipeline_local.py
"""

from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv
from loguru import logger

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
load_dotenv(override=True)


async def main() -> None:
    from aura_voice.clients.gateway import GatewayClient
    from aura_voice.config import get_settings
    from aura_voice.events import VoiceEvent, call_started
    from aura_voice.pipeline import build_voice_pipeline
    from pipecat.workers.runner import WorkerRunner

    settings = get_settings()
    if not settings.gradium_api_key:
        logger.error("Set GRADIUM_API_KEY in .env")
        sys.exit(1)

    async def log_event(event: VoiceEvent) -> None:
        if event.type == "audio.level":
            return
        logger.info("event {} {}", event.type, event.payload)

    gateway = GatewayClient(settings.gateway_url)

    # Monkey-patch publish to local logger (gateway may be down)
    gateway.publish_event = log_event  # type: ignore[method-assign]

    session_id = "local_dev_001"
    vp = build_voice_pipeline(
        session_id,
        settings=settings,
        gateway=gateway,
        local_echo=True,
    )
    runner = WorkerRunner(handle_sigint=True)

    logger.info(
        "Local two-way call ready (multilingual={}, local medical protocol mock ON). "
        "Try: 'chest pain' → give an address → 'he stopped breathing'. Ctrl+C to stop.",
        settings.multilingual,
    )
    await log_event(call_started(session_id, channel="local_dev"))
    await runner.add_workers(vp.worker)
    try:
        await runner.run()
    finally:
        await gateway.close()


if __name__ == "__main__":
    asyncio.run(main())
