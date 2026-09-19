# AURA — frontend (`apps/web`)

The emergency-intake command center. Owned by Kenil. Design rules live in [DESIGN.md](./DESIGN.md) and are binding.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and press **D** (or click *Start demo call*).

With no gateway configured it plays a deterministic local scenario — the full medical demo, end to end,
including the human-approval gate. Nothing about the visuals differs from live mode.

### Operator keys

| Key | Action |
| --- | --- |
| `D` / `Enter` | start or restart the demo call |
| `A` | approve the proposed response (only while the gate is open) |
| `R` | reject it |

### URL switches (for rehearsing)

| Query | Effect |
| --- | --- |
| `?t=29` | jump straight to a moment in the scenario (seconds). `?t=29` lands on the escalation, `?t=33` on the approval gate |
| `?speed=2` | run the scenario faster |
| `?mock=1` | force the local scenario even if a gateway is configured |
| `?gateway=http://localhost:8000` | point at a gateway for this session only |
| `?quality=low` | force reduced-effects mode (no bloom, no ambient motion) |
| `?voice=1` | live voice call — skip the backend's deterministic demo trigger |

## Connecting the live backend — for Shresth

Set the gateway once and the frontend switches over with no visual changes:

```bash
echo "NEXT_PUBLIC_AURA_GATEWAY=http://localhost:8000" > .env.local
```

On start the frontend does:

1. `POST /api/calls` → expects `{ "session_id": "call_001" }` (`id` is also accepted)
2. opens `WS /ws/calls/{session_id}`
3. `POST /api/calls/{session_id}/demo` — skipped when `?voice=1`
4. on the operator's decision: `POST /api/calls/{session_id}/approval` with `{ "approved": true, "reviewer": "Supervisor console" }`

**If any of that fails the frontend falls back to the local scenario automatically** and shows the degraded
state in the top bar. The demo can always complete.

### What the frontend expects over the socket

The envelope from the master handoff, one JSON object per frame (an array of them also works):

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

Guarantees on our side — you do not need to be careful about these:

- **Duplicates are dropped** by `event_id`.
- **Order is enforced** by `sequence`, per session. An event whose sequence is below what we already applied is
  discarded, so animations never run backward. Out-of-order arrivals are held ~70ms to let stragglers slot in.
- **Unknown event types are ignored**, never fatal. Ship new types whenever you like.
- **Missing fields are tolerated.** Anything absent renders as an explicit empty state — we never invent a value.
- `audio.level` bypasses React entirely, so send it as often as you like (20–50/s is fine).

Payload shapes we read are in [`src/lib/contracts.ts`](./src/lib/contracts.ts). Priority and category strings are
normalised loosely (`p1`/`echo`/`immediate` all map to `critical`), so minor naming drift will not break the UI.

### The one hard rule

**No responder unit animates as dispatched until `approval.resolved` arrives with `approved: true`.**
`dispatch.proposed` lights up candidate units and draws the proposed route — it never moves anything.
Please don't send a resolved-approval event the operator didn't cause.

## Architecture

```
src/
├── lib/contracts.ts     shared event contract + defensive parsers
├── lib/geo.ts           San Francisco: projection, shoreline, hills, street grids, routing  [locked contract]
├── lib/palette.ts       colour tokens as hex (three.js can't read CSS vars)
├── lib/auraClient.ts    the ONLY place that talks to the network
├── state/ingest.ts      dedupe + ordering — every event enters here
├── state/auraStore.ts   zustand store; the single source of truth for every visual
├── state/audioBus.ts    audio levels, deliberately outside React
├── demo/                the deterministic scenario and its player
└── components/          city (3D) · calls · incident · protocol · actions · approval · hud
```

Visual components only read from the store. They cannot tell whether an event came from the mock player or the
live socket, which is why swapping in the real gateway changes nothing on screen.
