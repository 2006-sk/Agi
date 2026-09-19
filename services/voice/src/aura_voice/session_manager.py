"""Session lifecycle: start / speak / cancel / end."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from loguru import logger
from pipecat.frames.frames import InterruptionWorkerFrame, TTSSpeakFrame
from pipecat.workers.runner import WorkerRunner

from aura_voice.clients.gateway import GatewayClient
from aura_voice.config import Settings, get_settings
from aura_voice.events import call_ended, call_started, voice_error
from aura_voice.pipeline import VoicePipeline, build_voice_pipeline


@dataclass
class VoiceSession:
    session_id: str
    language: str
    pipeline: VoicePipeline
    runner: WorkerRunner
    task: asyncio.Task[Any] | None = None
    active_text: str = ""


@dataclass
class SessionManager:
    settings: Settings = field(default_factory=get_settings)
    gateway: GatewayClient | None = None
    sessions: dict[str, VoiceSession] = field(default_factory=dict)
    local_echo: bool = False

    async def startup(self) -> None:
        self.gateway = GatewayClient(self.settings.gateway_url)

    async def shutdown(self) -> None:
        for session_id in list(self.sessions.keys()):
            await self.end_session(session_id, reason="shutdown")
        if self.gateway:
            await self.gateway.close()
            self.gateway = None

    def _require_gateway(self) -> GatewayClient:
        if not self.gateway:
            raise RuntimeError("SessionManager not started")
        return self.gateway

    async def start_session(
        self, session_id: str, language: str | None = None
    ) -> VoiceSession:
        if session_id in self.sessions:
            raise ValueError(f"session already active: {session_id}")

        lang = language or self.settings.default_language
        gateway = self._require_gateway()

        vp = build_voice_pipeline(
            session_id,
            settings=self.settings,
            gateway=gateway,
            language=lang,
            local_echo=self.local_echo,
        )
        runner = WorkerRunner(handle_sigint=False)

        session = VoiceSession(
            session_id=session_id,
            language=lang,
            pipeline=vp,
            runner=runner,
        )

        async def _run() -> None:
            try:
                await runner.add_workers(vp.worker)
                await gateway.publish_event(
                    call_started(session_id, language=lang, channel="voice")
                )
                await runner.run()
            except Exception as exc:
                logger.exception("session crashed session={}", session_id)
                await gateway.publish_event(
                    voice_error(
                        session_id,
                        code="session_crash",
                        message=type(exc).__name__,
                        recoverable=False,
                    )
                )
            finally:
                self.sessions.pop(session_id, None)

        session.task = asyncio.create_task(_run(), name=f"voice-{session_id}")
        self.sessions[session_id] = session
        logger.info("session started session={} language={}", session_id, lang)
        return session

    def get(self, session_id: str) -> VoiceSession | None:
        return self.sessions.get(session_id)

    async def speak(self, session_id: str, text: str) -> None:
        """Only speak gateway-approved text (or explicit /internal/speak)."""
        session = self.sessions.get(session_id)
        if not session:
            raise KeyError(f"unknown session: {session_id}")
        cleaned = (text or "").strip()
        if not cleaned:
            return
        session.active_text = cleaned
        session.pipeline.emitter.note_agent_text(cleaned)
        await session.pipeline.worker.queue_frame(TTSSpeakFrame(cleaned))

    async def cancel_speech(self, session_id: str, reason: str = "barge_in") -> None:
        session = self.sessions.get(session_id)
        if not session:
            raise KeyError(f"unknown session: {session_id}")
        logger.info("cancel_speech session={} reason={}", session_id, reason)
        try:
            await session.pipeline.worker.queue_frame(InterruptionWorkerFrame())
        except Exception:
            # Fallback: broadcast from bridge if worker API differs
            await session.pipeline.bridge.broadcast_interruption()

    async def end_session(self, session_id: str, reason: str = "normal") -> None:
        session = self.sessions.pop(session_id, None)
        if not session:
            return
        gateway = self._require_gateway()
        await gateway.publish_event(call_ended(session_id, reason=reason))
        try:
            await session.runner.cancel()
        except Exception:
            logger.warning("runner cancel failed session={}", session_id)
        if session.task and not session.task.done():
            session.task.cancel()
            try:
                await session.task
            except asyncio.CancelledError:
                pass
        logger.info("session ended session={} reason={}", session_id, reason)
