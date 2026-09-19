"""Prerecorded WAV playback for deterministic demo (Phase 6)."""

from __future__ import annotations

from pathlib import Path

from loguru import logger

# Placeholder — Phase 6 wires a WAV file into Gradium STT or replays timed
# transcript.final events matching the medical demo script.


async def play_prerecorded(
    session_id: str,
    wav_path: Path,
) -> None:
    if not wav_path.exists():
        raise FileNotFoundError(wav_path)
    logger.info(
        "playback stub session={} path={} — implement timed event replay in Phase 6",
        session_id,
        wav_path,
    )
