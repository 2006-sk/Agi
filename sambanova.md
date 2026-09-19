# Pranay — AURA Intelligence Backend Handoff

## Your ownership

You own the emergency-intelligence service: structured fact extraction, classification, protocol state, next-question selection, escalation logic and simulated responder tools. The service uses SambaNova through General Compute and must return strict structured output.

## Responsibilities

- Convert each finalized caller utterance into an updated incident state.
- Classify category and priority with confidence.
- Extract location, people at risk, symptoms and hazards.
- Detect contradictions and request verification.
- Select the next question from the current protocol.
- Detect state-changing phrases such as “stopped breathing.”
- Prepare, but never autonomously execute, consequential dispatch actions.
- Emit explanations concise enough for the frontend.
- Implement simulated GIS, unit availability and CAD tools.

## Sponsor use

- Send inference through **General Compute’s SambaNova endpoint**.
- Use **SambaNova** for rapid structured extraction, classification and state-delta reasoning.

The protocol itself must live in deterministic code or JSON. The model interprets speech and proposes state changes; it does not invent emergency procedures.

## Main endpoint

```http
POST /internal/analyze
Content-Type: application/json
```

```json
{
  "session_id": "call_001",
  "utterance": "Wait, he stopped breathing",
  "current_state": {},
  "conversation_summary": "Adult caller reports chest pain at verified address."
}
```

Return:

```json
{
  "state_patch": {
    "priority": "critical",
    "facts_added": ["not breathing"],
    "recommended_services": ["EMS"],
    "human_required": true
  },
  "protocol_transition": {
    "from": "assess_breathing",
    "to": "human_dispatch_approval",
    "reason": "Caller reports patient is not breathing"
  },
  "next_response": "I understand. Stay on the line while I alert the emergency dispatcher.",
  "proposed_tools": [
    {"name": "find_available_units", "arguments": {"service": "EMS"}}
  ],
  "confidence": 0.96
}
```

## Deterministic medical protocol MVP

```text
verify_location
→ identify_problem
→ conscious_check
→ breathing_check
→ collect_hazards
→ prepare_response
→ human_dispatch_approval
```

Each state defines required facts, allowed next states, approved prompt templates and which tool proposals are legal.

## Simulated tools

- `normalize_address(raw_address)`
- `geocode_address(normalized_address)`
- `find_available_units(service, location)`
- `calculate_route(unit, incident_location)`
- `create_cad_draft(incident_state)`
- `request_specialist(type, reason)`

Return credible deterministic sample data. Do not spend hackathon time integrating real emergency systems.

## Model reliability

- Enforce a JSON schema on every model response.
- Validate category and priority against enums.
- Reject protocol transitions not allowed by the state machine.
- Keep the previous state when confidence is too low.
- Mark uncertain facts as unverified instead of guessing.
- Retry malformed responses once, then use deterministic fallback extraction.
- Include model latency and validation outcome in internal logs.

## Build order

1. Create strict incident-state and analysis-response schemas.
2. Implement the medical protocol state machine.
3. Call SambaNova through General Compute for structured extraction.
4. Validate model output and apply only legal patches.
5. Add simulated EMS tools.
6. Test the complete scripted medical conversation.
7. Add fire/police only if the medical path is stable.

## Done when

- The same scripted conversation produces the same valid incident progression repeatedly.
- “He stopped breathing” changes priority and protocol within one inference turn.
- Invalid model output cannot bypass the deterministic protocol.
- Tool calls are proposed with safe structured arguments.
- Every consequential proposal has `human_required: true`.