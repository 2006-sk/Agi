# AURA Voice Service (Aditya)

Real-time voice layer for AURA: **Pipecat** orchestration + **Gradium** streaming STT/TTS.
No LLM inside this service — only gateway-approved reply text is spoken.

## API keys you need

| Service | Key required? | Where |
| --- | --- | --- |
| **Gradium** | **Yes** | `GRADIUM_API_KEY` (+ optional `GRADIUM_VOICE_ID`) from [gradium.ai](https://gradium.ai) |
| **Pipecat** | No | Open-source framework (`pipecat-ai`) |
| Daily / WebRTC | Only if Kenil uses Daily transport later | Not needed for local mic scripts |

Copy env and paste your Gradium key:

```powershell
cd aura/services/voice
Copy-Item .env.example .env
# edit .env → GRADIUM_API_KEY=gsk_...
```

## Setup

```powershell
cd aura/services/voice
uv sync
```

## Bring-up order

```powershell
# 1) Mic → Gradium STT → terminal
uv run python scripts/01_stt_mic.py

# 2) Fixed text → Gradium TTS → speakers
uv run python scripts/02_tts_speak.py

# 3) Full local loop (local_echo, no gateway required)
uv run python scripts/03_pipeline_local.py

# 4) Forced barge-in cancellation
uv run python scripts/04_barge_in_check.py

# HTTP control plane (session start/speak/cancel)
uv run aura-voice
# → http://localhost:8100/health
```

## Noise / mic sensitivity

Most ambient false barge-ins came from **local VAD interrupting TTS** (and TV audio being transcribed).

Default now: `BARGE_IN_MODE=off` — mic is muted to Gradium while AURA speaks, so the agent finishes the line.

| Mode | Behavior |
| --- | --- |
| `off` | No barge-in; best against room/TV noise |
| `transcript` | Interrupt only when STT produces real text (≥12 chars) |
| `vad` | Interrupt on any speech-start (demo barge-in; sensitive) |

For the “He stopped breathing” demo interrupt:

```env
BARGE_IN_MODE=transcript
```

- Gradium STT uses `language=any` (en / es / fr / de / pt)
- Caller language is inferred from each final transcript
- Gradium TTS language updates mid-call
- Local-echo and safe-fallback lines switch to match
- Gateway utterance requests include `language` so Pranay can reply in-kind

Pin a single language with `MULTILINGUAL=false` and `DEFAULT_LANGUAGE=es`.

`GatewayBridge` POSTs finals to Shresth (`/api/calls/{id}/utterance`) and speaks only `reply_text`.
With `local_echo=True`, it uses a fixed safe question so you can develop without the gateway.

## HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness + active sessions |
| `POST` | `/sessions/start` | `{session_id, language, local_echo?}` |
| `POST` | `/sessions/end` | End session |
| `POST` | `/internal/speak` | Speak approved text via Gradium TTS |
| `POST` | `/internal/cancel` | Barge-in / cancel TTS |
| `POST` | `/internal/utterance` | Text-mode fallback |

Events published to gateway: see [docs/events.md](docs/events.md).
