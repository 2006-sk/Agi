"""Latency timing helpers — log IDs and durations, never raw audio."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from loguru import logger


@dataclass
class TurnMetrics:
    session_id: str
    turn_id: str
    stt_final_at: float | None = None
    gateway_request_at: float | None = None
    gateway_response_at: float | None = None
    tts_first_byte_at: float | None = None
    turn_complete_at: float | None = None
    extra: dict[str, float] = field(default_factory=dict)

    def mark_stt_final(self) -> None:
        self.stt_final_at = time.perf_counter()

    def mark_gateway_request(self) -> None:
        self.gateway_request_at = time.perf_counter()

    def mark_gateway_response(self) -> None:
        self.gateway_response_at = time.perf_counter()

    def mark_tts_first_byte(self) -> None:
        if self.tts_first_byte_at is None:
            self.tts_first_byte_at = time.perf_counter()

    def mark_turn_complete(self) -> None:
        self.turn_complete_at = time.perf_counter()
        self.log_summary()

    def _delta_ms(self, start: float | None, end: float | None) -> float | None:
        if start is None or end is None:
            return None
        return round((end - start) * 1000, 1)

    def log_summary(self) -> None:
        logger.info(
            "turn_metrics session={} turn={} stt_to_gateway_ms={} "
            "gateway_rtt_ms={} gateway_to_tts_ms={} full_turn_ms={}",
            self.session_id,
            self.turn_id,
            self._delta_ms(self.stt_final_at, self.gateway_request_at),
            self._delta_ms(self.gateway_request_at, self.gateway_response_at),
            self._delta_ms(self.gateway_response_at, self.tts_first_byte_at),
            self._delta_ms(self.stt_final_at, self.turn_complete_at),
        )
