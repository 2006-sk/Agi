# Voice events Aditya produces

Shresth wraps these in the canonical envelope (`event_id`, `session_id`, `type`, `timestamp`, `sequence`, `payload`).

Voice service POSTs the object below to `POST {GATEWAY_URL}/internal/voice-events`.

## Envelope (pre-sequence)

```json
{
  "event_id": "evt_abc123",
  "session_id": "call_001",
  "type": "transcript.final",
  "timestamp": "2026-09-19T21:00:00.000Z",
  "payload": {}
}
```

## Types

### `call.started`

```json
{
  "caller_label": "caller",
  "language": "en",
  "channel": "voice"
}
```

### `call.ended`

```json
{ "reason": "normal" }
```

### `audio.level`

Throttled (~15 Hz).

```json
{ "level": 0.42, "speaker": "caller" }
```

### `transcript.partial` / `transcript.final`

```json
{
  "speaker": "caller",
  "text": "He stopped breathing",
  "confidence": 0.97,
  "language": "en"
}
```

`language` follows the detected caller language when `MULTILINGUAL=true`
(Gradium supports `en|es|fr|de|pt`). Utterance POSTs to the gateway include
the same `language` so intelligence can reply in-kind.

### `agent.speaking`

```json
{ "text": "Okay, I understand…", "active": true }
```

### `agent.interrupted`

```json
{
  "interrupted_text": "Okay, I understand…",
  "reason": "barge_in"
}
```

### `voice.error`

```json
{
  "code": "gradium_disconnect",
  "message": "WebSocket closed",
  "recoverable": true
}
```

## Utterance → reply contract

`POST /api/calls/{session_id}/utterance`

Request:

```json
{ "text": "He stopped breathing", "speaker": "caller", "language": "en" }
```

Expected response:

```json
{ "reply_text": "I am preparing EMS. Stay on the line.", "session_id": "call_001" }
```
