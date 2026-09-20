# AURA Command Center (frontend)

Black 3D city command center for the AURA demo: live incident card, protocol tree with escalation jumps, Gradium-style transcript with barge-in, tool-call trace, waveform deck, human approval gate, ambulance routing.

## Run

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5173
```

Press **Space** (or "answer the overflow queue"). Background calls light up the city, Caller 4471 reports chest pain, the address locks in, "he stopped breathing" barges in and escalates to CRITICAL, the approval gate opens. **Enter** approves (CAD created, ambulance rolls, CPR coaching), **R** rejects. `` ` `` opens the presenter console (auto/manual mode, pace, voices, free-text caller input, reset).

## Backends

- Default: built-in **mock event stream** (`src/mock/`), the deterministic scenario the master plan tells the frontend to build against. Runs entirely in the browser and emits the shared envelope (`event_id, session_id, type, timestamp, sequence, payload`) for every event type in the plan.
- Team gateway: open `http://localhost:5173/?transport=gateway` (optionally `&gateway=http://host:8080`, or set `VITE_TRANSPORT=gateway` / `VITE_GATEWAY_URL`). Uses the master-plan endpoints: `POST /api/calls`, `POST /api/calls/{id}/demo`, `WS /ws/calls/{id}`, `POST /api/calls/{id}/utterance`, `POST /api/calls/{id}/approval`.

Contract schemas the UI validates against live in `src/contracts/index.ts` (mirror of `packages/contracts`). Additive events the UI understands when present: `analysis.started`, `analysis.completed`, `system.reset`.

## Layout

```text
src/contracts/   event envelope + payload schemas + incident state (zod)
src/mock/        scenario data, deterministic protocol/tool engine, in-browser mock gateway
src/lib/         transport interface, gateway transport, geo projection, colours
src/store/       zustand store: applyEvents reducer, cues for camera/audio side effects
src/scene/       react-three-fiber city, beacons, stations, routes, ambulance, camera director, bloom
src/hud/         panels: top bar, roster, incident, protocol tree, transcript, tool log, audio deck, approval gate, console
src/audio/       browser speech synthesis (AURA + caller voices) and synthesized SFX
```

The HUD is designed for 1920x1080 and scales down uniformly on smaller screens. Voices use the browser's speech synthesis as a stand-in for Gradium TTS.
