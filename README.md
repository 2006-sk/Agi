# AURA — Emergency Response Command Surface

The frontend for AURA: a live 911 call, rendered as a command centre rather than a
dashboard. A 3D city carries the incident, the call stack carries the people, the
right column carries what AURA knows and why, and the bottom rail carries what it is
doing — ending at a human approval gate that nothing gets past on its own.

```
npm install
npm run dev          # http://localhost:3000 — runs the full demo from mock events
npm run verify       # asserts the demo sequence + event-pipeline invariants, no browser
npm run typecheck
npm run build
```

## Architecture

```
src/
├── types/events.ts          the AuraEvent envelope + the event taxonomy
├── state/auraStore.ts       ALL UI state. applyEvent() is the only way it changes.
├── lib/cityLayout.ts        deterministic city geometry + street routing
├── lib/tokens.ts            semantic colour, easing, duration
├── hooks/useAuraSocket.ts   /ws/calls/{session_id} client
├── hooks/useAuraFeed.ts     the mock ⇄ live switch
├── demo/mockEvents.ts       the scripted medical scenario
├── demo/mockPlayer.ts       virtual-clock player that stops dead at the approval gate
└── components/
    ├── city/                the 3D city (R3F) — beacons, routes, responders, camera
    ├── calls/               left: live call stack + voice orbs
    ├── incident/            right: incident intelligence + transcript
    ├── protocol/            right: protocol spine and why it changed
    ├── actions/             bottom: the tool pipeline rail
    ├── approval/            centre: the human approval gate
    ├── shell/               layout, canvas mount, fallback, demo transport
    └── ui/                  Panel, ConfidenceRing, Waveform, PriorityBadge, FactChip
```

## Integration contract

The frontend connects **only** to Shresth's gateway. It never calls Gradium, Pipecat,
SambaNova or any other upstream service directly.

```ts
type AuraEvent = {
  event_id: string;
  session_id: string;
  type: string;
  timestamp: string;
  sequence: number;
  payload: Record<string, unknown>;
};
```

Every event — mock or live — enters through one function, `auraStore.applyEvent`:

- **Duplicates** are ignored by `event_id`.
- **Ordering** is by `sequence`. An event older than the last applied one is dropped, so
  animations never move backward. An event ahead of the next expected one is buffered
  until the gap fills; `flushGaps()` releases it if the missing event never arrives, so a
  dropped frame cannot stall the demo.
- **Unknown `type` values** are counted and ignored, never thrown on.

`npm run verify` proves all of this against the real store, including duplicate and
jittered delivery.

### Event taxonomy

`session.started`, `call.incoming`, `call.ended`, `audio.level`, `audio.interrupted`,
`transcript.partial`, `transcript.final`, `fact.extracted`, `fact.missing`,
`location.candidate`, `location.verified`, `incident.classified`,
`incident.reclassified`, `protocol.activated`, `protocol.step`, `tool.invoked`,
`tool.result`, `responders.available`, `route.proposed`, `approval.requested`,
`approval.granted`, `approval.rejected`, `dispatch.started`, `dispatch.progress`,
`dispatch.arrived`.

Payload shapes are in `src/types/events.ts`. Anything outside this list is safely ignored.

### Going live

```bash
NEXT_PUBLIC_AURA_WS_URL=ws://localhost:8000 npm run dev
```

That is the whole of milestone 2. `useAuraFeed` stops creating the mock player and
opens `ws://localhost:8000/ws/calls/{session_id}` instead. No visual component changes,
because no visual component knows where events come from.

Operator decisions travel back up the same socket as
`{ type: 'operator.decision', payload: { kind: 'approval', approval_id, decision } }`.

## The approval gate is a state machine, not a component

`state.dispatch` moves `none → proposed → approved → enroute → arrived`, or
`→ rejected`. The store refuses a `dispatch.started` event unless an `approval.granted`
has already landed — a backend bug cannot make a unit move on screen.

- A route may be **drawn** at `proposed`.
- A responder may only be **shown moving** from `approved` onward (`useResponderMayMove()`).

## Performance and fallback

- 418 buildings render as one `InstancedMesh`; every glowing edge in the city is one
  merged `LineSegments`.
- `PerformanceMonitor` degrades in steps: lower DPR → drop vignette and particles →
  disable postprocessing entirely, setting `state.degraded`.
- `prefers-reduced-motion`, no WebGL, or a collapsed frame rate all fall back to
  `CityFallback` — a 2D top-down SVG city built from the same geometry, showing the same
  incident, route and responder, under the same approval invariant.

## Demo

The mock script plays the full medical scenario: calm idle city → call arrives, camera
flies in → transcript and waveform → address verified, pin locks → medical/urgent in
amber → *"He stopped breathing"* → response interrupted, one red flash, priority
critical → cardiac protocol expands, EMS illuminates, route draws itself → approval gate
slides in → **and stops there** until a human presses `APPROVE RESPONSE`. Only then does
the green signal travel the route and the unit start moving.
