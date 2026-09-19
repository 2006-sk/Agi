from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    gradium_api_key: str = ""
    gradium_voice_id: str = "_6Aslh2DxfmnRLmP"
    voice_mode: Literal["live", "playback", "text"] = "live"
    gateway_url: str = "http://localhost:8000"
    voice_host: str = "0.0.0.0"
    voice_port: int = 8100
    default_language: str = "en"
    multilingual: bool = True

    # Local Silero VAD — raise to ignore ambient / TV bleed
    vad_min_volume: float = 0.55
    vad_confidence: float = 0.75
    vad_start_secs: float = 0.35
    vad_stop_secs: float = 0.5

    # Gradium semantic turn detection — off by default (its turn-start also barge-ins)
    gradium_turn_detection: bool = False
    gradium_eot_horizon_s: float = 3.0
    gradium_eot_threshold: float = 0.4
    gradium_delay_in_frames: int = 16

    # off = mute mic while agent speaks (best against room noise)
    # transcript = interrupt only when STT produces real text
    # vad = interrupt on any VAD speech start (sensitive)
    barge_in_mode: Literal["off", "transcript", "vad"] = "off"
    barge_in_min_chars: int = 12

    audio_level_hz: float = 15.0
    safe_fallback_line: str = (
        "Please stay on the line while I connect you to a dispatcher."
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
