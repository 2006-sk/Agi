"""Build the no-LLM Pipecat pipeline: Gradium STT → events → gateway → Gradium TTS."""

from __future__ import annotations

from dataclasses import dataclass

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.services.gradium.stt import GradiumSTTService
from pipecat.services.gradium.tts import GradiumTTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import BaseTransport
from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
from pipecat.turns.user_start import (
    TranscriptionUserTurnStartStrategy,
    VADUserTurnStartStrategy,
)
from pipecat.turns.user_turn_processor import UserTurnProcessor
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from aura_voice.clients.gateway import GatewayClient
from aura_voice.config import Settings
from aura_voice.language import normalize_lang
from aura_voice.processors.bot_speaking_gate import BotSpeakingGate
from aura_voice.processors.event_emitter import EventEmitter
from aura_voice.processors.gateway_bridge import GatewayBridge
from aura_voice.processors.language_tracker import LanguageTracker


def _stt_language(code: str, *, multilingual: bool):
    """Gradium: pin a language, or \"any\" for auto-detect transcription."""
    if multilingual or code.lower() == "any":
        return "any"
    mapping = {
        "en": Language.EN,
        "es": Language.ES,
        "fr": Language.FR,
        "de": Language.DE,
        "pt": Language.PT,
    }
    return mapping.get(code.lower(), Language.EN)


def _tts_language(code: str) -> Language:
    mapping = {
        "en": Language.EN,
        "es": Language.ES,
        "fr": Language.FR,
        "de": Language.DE,
        "pt": Language.PT,
    }
    return mapping.get(normalize_lang(code), Language.EN)


def _user_turn_strategies(barge_in_mode: str) -> UserTurnStrategies:
    """
    VAD speech-start interrupts are the main ambient false barge-in source.
    Keep VAD for turn boundaries, but only allow interruptions in 'vad' mode.
    """
    allow_vad_interrupt = barge_in_mode == "vad"
    return UserTurnStrategies(
        start=[
            VADUserTurnStartStrategy(enable_interruptions=allow_vad_interrupt),
            TranscriptionUserTurnStartStrategy(use_interim=True),
        ]
    )


@dataclass
class VoicePipeline:
    session_id: str
    transport: BaseTransport
    worker: PipelineWorker
    bridge: GatewayBridge
    emitter: EventEmitter
    language_tracker: LanguageTracker
    stt: GradiumSTTService
    tts: GradiumTTSService


def build_local_transport() -> LocalAudioTransport:
    return LocalAudioTransport(
        params=LocalAudioTransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        )
    )


def build_voice_pipeline(
    session_id: str,
    *,
    settings: Settings,
    gateway: GatewayClient,
    transport: BaseTransport | None = None,
    language: str | None = None,
    local_echo: bool = False,
) -> VoicePipeline:
    """
    Pipeline shape (no LLM — gateway owns reply text):

      transport.input
        → BotSpeakingGate   # mute mic over TTS when barge_in_mode=off
        → VADProcessor
        → GradiumSTT
        → UserTurnProcessor
        → LanguageTracker
        → EventEmitter
        → GatewayBridge
        → GradiumTTS
        → transport.output
    """
    if not settings.gradium_api_key:
        raise RuntimeError(
            "GRADIUM_API_KEY is missing. Copy .env.example to .env and set your key."
        )

    lang = language or settings.default_language
    transport = transport or build_local_transport()

    speaking_gate = BotSpeakingGate(
        mode=settings.barge_in_mode,
        min_interrupt_chars=settings.barge_in_min_chars,
    )

    vad = VADProcessor(
        vad_analyzer=SileroVADAnalyzer(
            params=VADParams(
                confidence=settings.vad_confidence,
                start_secs=settings.vad_start_secs,
                stop_secs=settings.vad_stop_secs,
                min_volume=settings.vad_min_volume,
            )
        )
    )
    user_turn = UserTurnProcessor(
        user_turn_strategies=_user_turn_strategies(settings.barge_in_mode)
    )

    stt_settings_kwargs: dict = {
        "language": _stt_language(lang, multilingual=settings.multilingual),
        "delay_in_frames": settings.gradium_delay_in_frames,
    }
    if settings.gradium_turn_detection:
        stt_settings_kwargs["eot_horizon_s"] = settings.gradium_eot_horizon_s
        stt_settings_kwargs["eot_threshold"] = settings.gradium_eot_threshold

    stt = GradiumSTTService(
        api_key=settings.gradium_api_key,
        enable_turn_detection=settings.gradium_turn_detection,
        settings=GradiumSTTService.Settings(**stt_settings_kwargs),
    )
    tts = GradiumTTSService(
        api_key=settings.gradium_api_key,
        settings=GradiumTTSService.Settings(
            voice=settings.gradium_voice_id,
            language=_tts_language(lang),
        ),
    )

    emitter = EventEmitter(
        session_id,
        on_event=gateway.publish_event,
        language=normalize_lang(lang),
        audio_level_hz=settings.audio_level_hz,
    )
    bridge = GatewayBridge(
        session_id,
        gateway=gateway,
        safe_fallback_line=settings.safe_fallback_line,
        language=lang,
        local_echo=local_echo,
        on_agent_text=emitter.note_agent_text,
    )
    language_tracker = LanguageTracker(
        bridge=bridge,
        emitter=emitter,
        default_language=lang,
        enabled=settings.multilingual,
    )

    pipeline = Pipeline(
        [
            transport.input(),
            speaking_gate,
            vad,
            stt,
            user_turn,
            language_tracker,
            emitter,
            bridge,
            tts,
            transport.output(),
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
    )

    logger.info(
        "voice pipeline built session={} barge_in_mode={} vad_min_volume={} "
        "gradium_turn_detection={} multilingual={}",
        session_id,
        settings.barge_in_mode,
        settings.vad_min_volume,
        settings.gradium_turn_detection,
        settings.multilingual,
    )
    return VoicePipeline(
        session_id=session_id,
        transport=transport,
        worker=worker,
        bridge=bridge,
        emitter=emitter,
        language_tracker=language_tracker,
        stt=stt,
        tts=tts,
    )
