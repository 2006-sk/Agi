# AURA — Master Handoff

## One-line pitch

**AURA is a human-supervised emergency-intake voice agent that answers overflow calls, understands chaotic speech, follows approved protocols, prepares the correct response, and visualizes the emergency live.**

This is a hackathon simulation, not a production 911 system. A human must approve consequential actions such as dispatch, medical instructions, or specialist escalation.

## Demo story

The demo begins on a black 3D city. Several emergency calls arrive as pulsing locations. A caller reports chest pain; AURA speaks naturally, extracts the address and symptoms, and builds the incident live. When the caller interrupts with “He stopped breathing,” AURA immediately changes the priority to critical, switches protocol, prepares EMS dispatch, and opens the human-approval gate. The route, ambulance, protocol state, transcript, confidence, and tool calls all animate in real time.

## Team ownership

| Person | Ownership | Must deliver |
| --- | --- | --- |
| **Kenil** | Frontend only | Complete black-background 3D command center, animations, audio UI, incident panels and WebSocket integration |
| **Aditya** | Voice backend | Pipecat + Gradium real-time audio pipeline, barge-in, transcripts, TTS and normalized voice events |
| **Pranay** | Intelligence backend | SambaNova through General Compute, classification, fact extraction, protocol state and simulated response tools |
| **Shresth** | Integration backend | Gateway, session state, shared schemas, event bus, WebSockets, service wiring, fallbacks and final end-to-end demo |

Only Kenil edits the frontend. Aditya, Pranay and Shresth work exclusively on backend services. Shresth is the integration owner and resolves contract conflicts.

## Sponsor architecture

| Sponsor | Load-bearing responsibility |
| --- | --- |
| **Gradium** | Streaming speech-to-text and natural text-to-speech; optional multilingual speech |
| **Pipecat** | Real-time voice pipeline, turn detection, interruptions and conversation transport |
| **SambaNova** | Low-latency incident classification, structured extraction and state-change reasoning |
| **General Compute** | Hosted SambaNova inference endpoint used by the intelligence service |

## System flow

1. A call session begins through the Pipecat service.
2. Gradium emits partial and final transcripts.
3. The integration gateway forwards finalized caller speech to the intelligence service.
4. SambaNova returns structured incident updates and the next approved question.
5. The protocol controller validates the output and prepares tool calls.
6. The integration gateway broadcasts normalized events to the frontend.
7. The 3D city, incident card, protocol tree and responder routes update immediately.
8. Consequential actions stop at a visible human-approval gate.

## Shared event contract

Every frontend update must use this envelope:

```json
{
  "event_id": "evt_123",
  "session_id": "call_001",
  "type": "incident.updated",
  "timestamp": "2026-09-19T18:02:11.120Z",
  "sequence": 14,
  "payload": {}
}
```

Required event types:

| Event | Producer | Important payload fields |
| --- | --- | --- |
| `call.started` | Aditya/Shresth | caller label, language, channel |
| `audio.level` | Aditya | normalized level, speaker |
| `transcript.partial` | Aditya | text, speaker, confidence |
| `transcript.final` | Aditya | text, speaker, confidence |
| `agent.speaking` | Aditya | text, active |
| `agent.interrupted` | Aditya | interrupted text, reason |
| `incident.updated` | Pranay | complete incident state |
| `protocol.changed` | Pranay | previous step, current step, reason |
| `tool.started` | Pranay | tool name, safe arguments |
| `tool.completed` | Pranay | tool name, result summary |
| `dispatch.proposed` | Pranay | services, units, route, reason |
| `approval.requested` | Shresth | action, risk, timeout |
| `approval.resolved` | Shresth | approved, reviewer |
| `system.degraded` | Shresth | failed dependency, fallback mode |

## Canonical incident state

```json
{
  "session_id": "call_001",
  "category": "medical",
  "priority": "critical",
  "status": "active",
  "location": {
    "raw": "170 St. Germain Avenue",
    "normalized": "170 St Germain Ave, San Francisco, CA",
    "latitude": 37.754,
    "longitude": -122.452,
    "confidence": 0.96,
    "verified": true
  },
  "people_at_risk": 1,
  "facts": ["adult", "not breathing"],
  "hazards": [],
  "missing_fields": [],
  "protocol": {
    "id": "MED_CARDIAC_01",
    "step": "human_dispatch_approval"
  },
  "recommended_services": ["EMS"],
  "confidence": 0.94,
  "human_required": true
}
```

## Backend endpoints

| Method | Route | Owner | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/calls` | Shresth | Create a call and return `session_id` |
| `POST` | `/api/calls/{id}/demo` | Shresth | Start a deterministic demo scenario |
| `GET` | `/api/calls/{id}` | Shresth | Return current combined state |
| `WS` | `/ws/calls/{id}` | Shresth | Stream all normalized events |
| `POST` | `/api/calls/{id}/utterance` | Aditya integration | Submit final caller text for text-mode fallback |
| `POST` | `/api/calls/{id}/approval` | Shresth | Approve or reject a proposed action |
| `POST` | `/internal/analyze` | Pranay | Convert an utterance plus state into an incident update |
| `POST` | `/internal/speak` | Aditya | Stream or return synthesized agent audio |

## Repository layout

```text
aura/
├── apps/
│   ├── web/                 # Kenil
│   └── gateway/             # Shresth
├── services/
│   ├── voice/               # Aditya
│   └── intelligence/        # Pranay
├── packages/
│   ├── contracts/           # Shresth owns; everyone imports
│   └── demo-scenarios/      # Shresth owns
├── docs/
└── docker-compose.yml
```

## Integration order

1. Shresth publishes contracts, mock WebSocket events and one deterministic scenario first.
2. Kenil builds against the mock event stream without waiting for the backend.
3. Aditya makes one two-way live voice conversation work and emits normalized transcript events.
4. Pranay accepts text plus state and returns strict JSON for one medical protocol.
5. Shresth replaces mocks one service at a time and keeps the same frontend contract.
6. The team adds fire or police only after the medical scenario works end to end.

## Definition of done

- The caller can speak naturally and interrupt AURA.
- AURA responds with low enough latency to feel conversational.
- The incident changes from incomplete information to a verified structured state.
- “He stopped breathing” visibly changes priority and protocol immediately.
- At least one simulated tool call proposes EMS and draws a route.
- Dispatch cannot complete without human approval.
- Every sponsor is visible in the architecture and used during the live demo.
- A deterministic text/audio fallback can complete the demo if an external API fails.

## Scope guardrails

- Build one excellent medical-emergency path first.
- Police, fire, multilingual calls and concurrent calls are stretch goals.
- Never allow the model to invent protocols; protocols are code/configuration.
- Never claim that AURA autonomously replaces trained dispatchers.
- Never let a visual effect delay or block the actual voice loop.