# AURA — Integration (Shresth)

How the three backends and the deck become one product, and how to run it.

The master handoff, the per-person handoffs and the event contract still apply;
this file records what was actually built and what is actually true after wiring
it together.

## Repository

```
aura/
├── apps/
│   ├── web/                 deck (Kenil) — Next.js
│   └── gateway/             integration gateway (Shresth) — the only service the deck talks to
├── packages/
│   └── contracts/           shared contract; owned here, imported by everyone
├── services/
│   ├── intelligence/        SambaNova via General Compute (Pranay)
│   └── voice/               Pipecat + Gradium (Aditya)
└── scripts/                 start, stop, demo, health, test
```

Branches: `main` and `pranay` hold the intelligence service, `aditya` the voice
service, `shresth-integration` the wiring. The two services were imported as
subtrees rather than merged — both branches keep their code at the repo root, so
a merge would have been a forty-file conflict for no benefit.

## Run it

```bash
npm run install:all          # once
npm run dev                  # intelligence :8082 + gateway :8000
npm run dev -- --voice       # also Aditya's Pipecat service :8100
npm run dev -- --web         # also the deck :3000
npm run dev -- --all
```

`dev.sh` waits on each service's own health check and prints the tail of its log
if it fails, so a bad start is visible before anyone reaches for a microphone.
The deck and the voice service are opt-in because each is usually already
running in its own terminal.

```bash
npm run health               # is the stack demo-ready (probes General Compute)
npm run demo                 # the golden cardiac path
./scripts/demo.sh cardiac approve
npm run stop                 # free the ports after a crash
npm test                     # every suite; LIVE=1 adds the live-model e2e
```

There is no Docker. The demo machine had none, and a compose file nobody has run
is worse than none at all.

## Ports

| Service | Port | Owner |
| --- | --- | --- |
| intelligence | 8082 | Pranay |
| gateway | 8000 | Shresth |
| voice | 8100 | Aditya |
| deck | 3000 | Kenil |

## Gateway routes

```text
POST /api/calls                      create (accepts your own session_id)
GET  /api/calls/{id}                 combined state + pending approvals
GET  /api/calls/{id}/events?since=N  the append-only log
POST /api/calls/{id}/utterance       final caller text -> AURA's approved reply
POST /api/calls/{id}/approval        the human decision
POST /api/calls/{id}/demo            deterministic scenario (cardiac | vague)
POST /api/calls/{id}/reset           wipe back to opening state, keep the id
POST /api/calls/{id}/end
WS   /ws/calls/{id}                  the deck's single stream
POST /internal/voice-events          fan-in from the voice service
GET  /health, /health/deps?probe=1
GET  /voice                          browser microphone fallback console
```

## The two event vocabularies

The backend handoffs specify one vocabulary (`incident.updated`,
`dispatch.proposed`, `protocol.changed`). The deck was built against a
finer-grained one (`fact.extracted`, `route.proposed`, `protocol.step`), in world
coordinates rather than lat/lng.

Rather than force either side to rewrite, the gateway **broadcasts both on one
socket**. Canonical events are the log and the contract; view events are derived
from them. The deck ignores types it does not know, so canonical events are inert
there; the backend never learns a view layer exists.

Two rules make this safe, both enforced in `src/adapter/toFrontend.ts`:

- **A name shared by both vocabularies is emitted once**, with a payload carrying
  both field sets (`transcript.final`, `audio.level`, `call.ended`,
  `approval.requested`). Two events would be two `event_id`s for one fact, and the
  deck would render the caller's sentence twice.
- **Nothing is re-emitted.** The deck keys facts and steps by id, but a repeated
  `fact.extracted` still burns a sequence number and replays an animation.

The translation is a pure function over an explicit projection state, so it is
tested without a socket, a browser or a model (31 cases).

| Canonical | Derived for the deck |
| --- | --- |
| `call.started` | `call.incoming` |
| `incident.updated` | `incident.classified` / `reclassified`, `fact.extracted`, `fact.missing`, `location.candidate` / `verified`, `protocol.activated`, `protocol.step`, `responders.available`, `route.proposed` |
| `protocol.changed` | `protocol.step` (old step done, new step active) |
| `tool.started` / `tool.completed` | `tool.invoked` / `tool.result` |
| `dispatch.proposed` | `responders.available`, `route.proposed` |
| `agent.speaking` | `transcript.final` with `speaker: "aura"` |
| `agent.interrupted` | `audio.interrupted` |
| `approval.resolved` | `approval.granted` / `approval.rejected` |
| — | `session.started`, `dispatch.started` / `progress` / `arrived` |

### Coordinates

`adapter/geo.ts` projects SF lat/lng onto the deck's 120×120 plane, anchored so
`170 St Germain Ave` lands exactly where the mock script put the hero incident
(`{x: 12.5, z: -27}`). The projection is compressed, not true-scale: at true
scale most of the unit roster would sit several city-widths off screen. It is
aspect-correct so routes still look like routes, and clamped to the rim so a
distant unit is visible rather than lost.

## Event guarantees

- One `event_id` per event; one sequence counter per session, contiguous from 1.
- `session.started` is always sequence 1. The deck treats it as a reset of its
  ingest baseline, which is what makes replay work.
- On connect, a deck is sent the entire log from sequence 1. Reload, dropped
  Wi-Fi and a late-joining second screen all converge on the same state, and the
  deck's `event_id` de-duplication makes the replay idempotent.
- Canonical events are broadcast before the view events derived from them.

### One subtlety worth knowing

When the operator clicks Approve, the deck applies its own optimistic
`approval.granted` immediately, consuming one sequence number locally. The
gateway's canonical `approval.resolved` then arrives in that slot and the deck
discards it as stale — which is correct, because the deck already knows. That is
why `approval.resolved` is published *first* after a decision: it is the event
that can afford to be dropped. Everything after it lands in order.

## The turn

```text
final caller transcript
→ per-session queue (never two analyses for one session at once)
→ open a turn id
→ cancel AURA's speech if the caller barged in
→ analyze against the full previous state
→ apply state, publish the service's events
→ raise the approval gate if dispatch was proposed
→ discard the reply if a newer turn has opened
→ hand the approved line back to whoever is speaking
```

**Turns are serialized per session.** The intelligence service is stateless and
the whole incident state round-trips through it, so two concurrent turns would
each analyse against a state missing the other's facts.

**A superseded turn still applies its state**, and discards only its reply. The
facts the caller gave are real; the answer is to a question they have moved past.

**Who speaks the reply.** The voice service's bridge speaks the HTTP response
itself. So for `source: "voice"` or `"text"` the gateway returns `reply_text` and
does *not* also push `/internal/speak` — that would make AURA say every line
twice. For `"demo"` and `"operator"` nobody is listening, so the gateway does
publish `agent.speaking` and push TTS.

## The approval gate

1. The intelligence service proposes `dispatch.proposed` with an `action_id`.
2. The gateway checks the location is verified, and withholds the gate if not —
   sending an ambulance to an address nobody confirmed is the failure this
   project exists to prevent.
3. `approval.requested` is broadcast, reusing the proposal's `action_id` as the
   `approval_id` so the deck echoes back an id that already exists.
4. The decision arrives by `POST /api/calls/{id}/approval` or as an
   `operator.decision` frame on the socket. Both run the same code.
5. Only then does the gateway call `/internal/tools/execute` with
   `approved: true`. It is the only caller in the system that ever sets that
   flag.

The gate is not a UI affordance: the intelligence service answers **403
`human_approval_required`** to anyone who tries to create a CAD record without
it, and the e2e suite asserts that by bypassing the gateway entirely.

On rejection nothing runs. If the approved tool fails, the gateway emits
`tool.completed` with a `failed:` summary and degrades — it never pretends a
dispatch succeeded.

Responder movement (`dispatch.started` → `progress` → `arrived`) is simulated by
the gateway, because the intelligence service stops at the CAD record and real
telemetry does not exist. It only ever runs after an approval, so a unit can
never be seen moving before a human said yes.

## Degraded modes

| Failure | Behaviour |
| --- | --- |
| Intelligence unreachable or timing out | Turn still returns 200 with the safe line; `system.degraded` with `failed_dependency: intelligence` |
| Two consecutive model-fallback turns | `system.degraded` with `general_compute` |
| Voice service down or absent | Incident continues; text, demo and browser-console modes all work |
| Unrecoverable `voice.error` | `system.degraded` with `gradium`, fall back to text |
| Deck reconnects | Full replay from sequence 1 |
| Approved tool fails | `tool.completed` with `failed:`, degrade, no dispatch |

`system.degraded` is raised once per session, not once per failure.

## Testing

```bash
npm test                     # intelligence (73) + gateway (86)
LIVE=1 npm test              # adds the gateway e2e against live General Compute
```

- **31 adapter cases** — the projection, as a pure function.
- **46 gateway cases** — routes, sequencing, WebSocket fan-out and replay,
  the approval gate, barge-in, supersession, degraded modes, reset.
- **9 end-to-end cases** — the real gateway against Pranay's real service,
  spawned as a process. Nothing faked below HTTP.

The e2e suite runs the cardiac scenario **three consecutive times** and asserts
the same incident each time, which is the handoff's acceptance bar. Offline it
also asserts the event stream is identical event for event; against the live
model it asserts the milestone spine instead, because a live model extracts a
different number of facts on each run.

Verified against live General Compute (`minimax-m2.7`): the full path reaches the
gate with `170 St Germain Ave` verified, `M-20` routed at 4 minutes, and the CAD
record created only after approval.

## Known gaps

- **The voice service cannot install on an Intel Mac.** `pipecat-ai[silero]`
  pulls `onnxruntime` 1.24.4, which publishes no macOS x86_64 wheel — the newest
  that does is 1.23.2. Aditya's own machine and Linux are unaffected. The
  one-line fix, if wanted, is a marked constraint in `services/voice/pyproject.toml`:
  `"onnxruntime<1.24; sys_platform == 'darwin' and platform_machine == 'x86_64'"`.
  Left unapplied so far, because his service is his to change.
- **Live Gradium STT/TTS is the one thing not covered by an automated test.** It
  needs a microphone and a key; it has to be exercised by hand on a machine where
  the voice service runs.
- `GET /voice` is a browser-microphone console using the Web Speech API. It
  speaks the same HTTP contract as the Pipecat bridge, so the gateway cannot tell
  them apart. It exists so the voice loop is demonstrable on a machine where the
  real service will not install — **it is a fallback, not the demo**. Aditya's
  handoff is explicit that browser speech APIs must not stand in for Gradium and
  Pipecat during judging, and both are load-bearing sponsor requirements.
- Sessions are in memory. The append-only log is the only thing a persistence
  layer would need, but there is no persistence layer.
- The root `README.md` still describes the frontend only; it predates the
  monorepo move and its paths now live under `apps/web/`.
