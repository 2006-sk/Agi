# Intelligence Service: Integration Notes

Things to know when wiring `services/intelligence` (Pranay) into the gateway (Shresth), the frontend (Kenil) and the voice pipeline (Aditya). Full contract in `README.md`.

## Where it runs

- Default `http://localhost:8082`, three routes: `POST /internal/analyze`, `POST /internal/tools/execute`, `GET /internal/health`.
- Internal service: no auth, no CORS. Only the gateway should call it (server to server).
- `GET /internal/health?probe=1` also pings General Compute and tells you whether the configured model is being served. Use it for the `system.degraded` check at startup.
- Runs fully offline with `USE_MOCK_MODEL=true` (canned model that follows the demo script). Use this if the API key or network is down during the demo; the frontend cannot tell the difference except `meta.source === "mock"`.

## Stateless: round-trip the state

- The service stores nothing. Every `/internal/analyze` call must include the previous response's `state` as `current_state` (`{}` on the first turn).
- `state` is authoritative. `state_patch` is a convenience diff for animations (`facts_added`, `priority`, ...). Do not rebuild state from patches; you will lose `protocol.asked` / `protocol.last_prompt`, which the service needs to interpret short answers like "no".
- `session_id` in the request wins over whatever is inside `current_state`.
- Send one request per **final** transcript segment (`transcript.final`), never partials. Calls are independent, so sequential per session; do not fire two turns for the same session concurrently.

## Events (Shresth)

- `response.events` already use the shared envelope (`event_id`, `session_id`, `type`, `timestamp`, `sequence`, `payload`).
- `sequence` is per response (1..n). Re-stamp it with the session-wide counter before broadcasting. `event_id` and `timestamp` can be kept.
- Types produced here: `tool.started`, `tool.completed`, `protocol.changed`, `dispatch.proposed`, `incident.updated`. Order within a response is: tool events (as they ran), then `protocol.changed`, then `dispatch.proposed`, then `incident.updated` **always last** and carrying the full state.
- `tool.completed.payload.result_summary` is a one-liner meant for the UI; `payload.result` is the full tool output (units, polyline, geocode...).
- A failed tool still emits `tool.completed` with `result: null` and a `result_summary` starting with `failed:`.
- `approval.requested` / `approval.resolved` / `system.degraded` are yours; this service never emits them.

## Approval flow (Shresth + Kenil)

1. On `dispatch.proposed` (payload: `action_id`, `services`, `units`, `route`, `reason`, `human_required: true`) raise `approval.requested`. The matching `proposed_tools` in the same response list what will run on approval (`create_cad_draft`, sometimes `request_specialist`).
2. On approval, call `POST /internal/tools/execute` with `{ session_id, tool: { name, arguments }, current_state, approved: true, reviewer }` using the proposal's `name`/`arguments` verbatim (`arguments` is `{}` for `create_cad_draft`; the service uses `current_state`).
3. Broadcast the returned `events` and store the returned `state`. After an approved `create_cad_draft`: `status: "dispatched"`, `human_required: false`, `response_plan.cad_id` set.
4. Without `approved: true` the call returns **403 `human_approval_required`**. This is the hard gate; there is no other path to a CAD record. On rejection just do not call it; the incident stays `awaiting_approval`.
5. Informational tools (`normalize_address`, `geocode_address`, `find_available_units`, `calculate_route`) run automatically inside `/analyze`; you never need to call them, but you can.

## Frontend field guide (Kenil)

- `state.priority`: `unknown | low | medium | high | critical`. Monotonic within a call; it never goes down without a human.
- `state.status`: `active | awaiting_approval | dispatched | closed`.
- `state.category`: `unknown | medical | fire | police | other`. Set once from the first classifiable utterance; later changes are refused (listed in `meta.rejected`).
- `state.facts` are verified (trigger-confirmed or mentioned twice); `state.unverified_facts` are model-only. Render the second list dimmed.
- `state.assessment`: `chief_complaint`, `conscious` (`yes|no|unknown`), `breathing` (`normal|labored|no|unknown`), `hazards_checked`.
- `state.missing_fields`: human-readable field names still needed at the current step (`location`, `consciousness`, `breathing`, `hazards`, `recommended_services`).
- `state.location`: `raw` (as spoken), `normalized`, `latitude`, `longitude`, `confidence`, `verified`. Only plot when `verified` is true; before that lat/lng are null.
- `state.response_plan` (null until units are found): `services`, `units[]` (`unit_id`, `type`, `station`, `latitude`, `longitude`, `eta_minutes`, `distance_km`), `route` (`unit_id`, `distance_km`, `eta_minutes`, `polyline: [[lat, lng], ...]`), `reason`, `cad_id`. Polyline points are `[latitude, longitude]` pairs, 5 points, first = unit, last = incident.
- Protocol tree for `MED_CARDIAC_01`, in order: `verify_location`, `identify_problem`, `conscious_check`, `breathing_check`, `collect_hazards`, `prepare_response`, `human_dispatch_approval`. `GENERAL_INTAKE_01` (non-medical): `verify_location`, `identify_problem`, `prepare_response`, `human_dispatch_approval`. Current step is `state.protocol.step`; `protocol.changed.payload.escalation === true` marks a jump (show it red).
- `explanation` is one dispatcher-facing sentence per turn; `confidence` is per turn (0..1).
- `meta` is diagnostic: `model_latency_ms`, `source` (`model | mock | fallback`), `validation` (`ok | retried | fallback | low_confidence`), `triggers_matched`, `rejected`. Good material for a "tool calls / confidence" panel.

## Voice (Aditya)

- `next_response` is the only text AURA should speak. It comes from approved protocol templates, never from the model. Feed it to `/internal/speak` as-is.
- If a new `transcript.final` arrives while AURA is speaking (barge-in), the gateway should still pass the previous `state`; the service knows what was asked via `protocol.last_prompt` and will interpret "no" / "yeah" against that question.
- `conversation_summary` is optional context for the model. Passing the concatenated `explanation` strings of previous turns works well.

## Latency and failure behaviour

- Model latency on `minimax-m2.7` (the default) is ~1.9-2.9 s per turn today; `gpt-oss-120b` and `deepseek-v3.2` are in the same range. Total turn is model latency + a few ms. Set frontend timeouts to at least 8 s per turn (model timeout 4 s + one retry + fallback).
- `minimax-m2.7` is generous with facts: expect extra entries in `unverified_facts` (e.g. the address repeated as a fact). The verified `facts` list stays clean; render the unverified list dimmed.
- If the model times out or returns invalid JSON twice, the service falls back to deterministic regex extraction and still returns 200 with `meta.source: "fallback"`. Life-threat phrases ("stopped breathing", "not responding") always take effect regardless of the model. Two consecutive fallback turns are a good trigger for `system.degraded` with `failed_dependency: "general_compute"`.
- Model output with `confidence` below 0.5 is ignored (`meta.validation: "low_confidence"`); the turn still succeeds.

## Demo-critical phrases (deterministic, do not depend on the model)

- "stopped breathing" / "not breathing" / "no pulse" -> `critical`, jump to `human_dispatch_approval`, EMS units + route, `dispatch.proposed`.
- "unresponsive" / "passed out" / "not responding" -> `critical`, jump to `breathing_check`.
- "chest pain" -> medical, `high`.
- A street address with a number and suffix ("170 St. Germain Avenue", "1800 Market Street apt 4B") is captured and geocoded in the same turn.
- Short answers ("no", "yeah he is") only mean something at `conscious_check` / `breathing_check` after that question was asked.

## Known limitations

- One real protocol (medical). Fire/police go through `GENERAL_INTAKE_01`, which collects address + problem and hands off to a human with FIRE/POLICE units prepared.
- Geodata is simulated San Francisco sample data. `170 St Germain Ave` is a known table entry (37.754, -122.452); other numbered addresses geocode deterministically near SF; vague places ("near the park") stay unverified and block dispatch.
- Unit roster is fixed (`M-20` is always the closest EMS unit to the demo address). No real CAD, GIS or dispatch integration.
- English only; number words in addresses ("one seventy") rely on the model, not the regex.
- Concurrent calls are supported only in the sense that the service is stateless; nothing coordinates units across sessions.
