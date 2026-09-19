# AURA — Design System (source of truth for every frontend contributor)

AURA is a human-supervised emergency-intake console. The screen is a **dispatch instrument**, not a SaaS
dashboard. Everything below is binding. If a choice is not covered here, pick the quieter option.

## 1. Thesis

**"One line from voice to vehicle."** A call enters on the left, is understood on the right, travels the
action rail along the bottom, stops at a human, and only then becomes a vehicle moving through the city.
The UI is *etched onto the glass over the city* — it is not a set of boxes sitting on top of it.

- The 3D city is full-bleed. HUD columns sit on **edge scrims** (black → transparent gradients), never in cards.
- Structure comes from **hairline rules, alignment and type**, not from containers, shadows or blur.
- Colour is **state, never decoration**. If nothing is happening, the screen is nearly monochrome navy.
- The call is the hero: transcript, priority and approval state must always be readable at a glance.

## 2. Colour (tokens live in `src/app/globals.css` + `src/lib/palette.ts` — never hard-code hex)

| Token | Hex | Role |
| --- | --- | --- |
| `void` | `#04060A` | page background, scrim base |
| `abyss` | `#070B12` | deepest surface |
| `navy-900/800/700` | `#0A1220 / #0F1B2E / #16263F` | fog, building bodies, quiet fills |
| `rule` / `rule-strong` | `rgb(148 178 220 / .14)` / `.30` | hairlines |
| `ink` / `ink-2` / `ink-3` | `#DDE7F3 / #8C9BB3 / #66758E` | text: primary / secondary / tertiary |
| `listen` | `#54E0F5` | cyan — AURA is **listening** / caller audio / live input |
| `reason` | `#9B82FF` | violet — AURA is **reasoning** / tool calls / model work |
| `urgent` | `#FFB547` | amber — **urgent** priority |
| `critical` | `#FF3D47` | red — **critical** priority, escalation |
| `approved` | `#42F0A2` | green — **human-approved** response only |

Rules:
- A semantic colour may only appear when its state is true. Green never appears before `approval.resolved{approved:true}`.
- Tints: use the colour at 8–14% alpha for fills, 35–60% for borders, 100% only for the live element (one per region).
- Glow (`box-shadow`/bloom) is reserved for **live** things: active speaker, running tool, critical priority, approval CTA. Max one glowing element per region.
- Gradients: only (a) edge scrims, (b) the navy vertical fog. **No purple→blue gradients, no gradient text, no gradient borders.**

## 3. Type

| Role | Family | CSS var / Tailwind | Use |
| --- | --- | --- | --- |
| Display | **Big Shoulders** (civic signage) | `font-display` | priority words, the approval gate, big timers' labels, wordmark. UPPERCASE, weight 700–800, tracking `0.02em`. Use sparingly — max 1–2 display items per region. |
| Body | **Atkinson Hyperlegible Next** | `font-sans` | transcript, reasons, sentences. Legibility under stress is the point. |
| Utility | **Martian Mono** | `font-mono` | labels, timestamps, callsigns, protocol ids, confidence numbers. |

Scale (px): mono label **10** (uppercase, tracking `0.14em`, `ink-2`), mono data **11–12**, body **14**, transcript **15–16** / line-height 1.45,
display **28 / 44 / 72**. All running numbers: `font-mono` + `tabular-nums`. Time is 24h `HH:MM:SS`. Call timers `MM:SS`.
Never use tracking wider than `0.16em`. Never centre body text. Sentence case for sentences, UPPERCASE only for mono labels and display words.

## 4. Shape, space, surface

- Radius: **2px** everywhere. No pills, no `rounded-xl`. Chips are small rectangles.
- Borders: 1px hairlines in `rule`. A section is separated by a rule + 10px mono label, not by a box.
- **No cards, no drop shadows, no `backdrop-blur` panels.** The single exception is the Approval Gate, which may use one solid `abyss/92%` plate because it must win over the city.
- Spacing rhythm: 4 / 8 / 12 / 16 / 24 / 32. Column padding 24px. Related items sit closer (8) than unrelated ones (24).
- Icons: tiny custom inline SVG glyphs (12–14px, 1.25 stroke, `currentColor`). No icon library, no emoji, no icon-in-a-rounded-square tiles.
- Shared primitives are in `src/components/ui/` — use them (`SectionHeader`, `Chip`, `PriorityTag`, `StateDot`, `Glyph`) instead of inventing new ones.

## 5. Layout (design for 1280×720 → 1920×1080; demo laptop likely renders ~1536×864 CSS px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ AURA  overflow intake        [ pipeline strip ]         SIMULATION  18:02:11 │  top bar 48
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│ CALLS         │                                      │ INCIDENT              │
│ ● call 001    │                                      │ priority · protocol   │
│   waveform    │            living 3D city            │ location ring · facts │
│ ○ call 101    │        (orbit / zoom stays live)     │ ───────────────────── │
│ ○ call 102    │                                      │ TRANSCRIPT (hero)     │
│               │        [ approval gate slides in ]   │                       │
├───────────────┴──────────────────────────────────────┴───────────────────────┤
│ ●━━━━━━━●━━━━━━━●━━━━━━━●━━━━━━━◆   action rail = a transit line with stations │  ~132
└──────────────────────────────────────────────────────────────────────────────┘
```
- Left column `clamp(250px, 20vw, 330px)`, right column `clamp(340px, 28vw, 460px)`.
- The overlay root is `pointer-events-none`; only real controls opt back in, so the city stays orbitable.
- Nothing may cover the transcript, the priority tag, or the approval gate.

## 6. Motion

Tokens (`src/lib/motion.ts`): `fast 120ms`, `base 240ms`, `slow 420ms`, `cine 900ms`; ease-out `cubic-bezier(.2,.8,.2,1)`,
ease-in `cubic-bezier(.7,0,.84,0)`; layout spring `{stiffness: 420, damping: 38}`.
- Motion must explain **state, causality or spatial change**. No idle wiggles, no hover bounces, no staggered fade-ups for their own sake.
- Entrances: 8px translate + opacity, `base`. Exits are faster than entrances.
- The **critical escalation** is the one loud moment: a single red shockwave ≤ 700ms, once. Never loops.
- Everything time-based is **delta-time** driven (demo panel is 360 Hz). Never animate per-frame constants.
- `prefers-reduced-motion` / low-quality mode: camera cuts instead of flying, packets jump station-to-station, shockwave becomes a 200ms colour wash.
- Animate `transform`/`opacity` only. Audio-driven visuals read from `audioBus` in rAF — never via React state.

## 7. Voice & copy

Dispatch vernacular, plain verbs, no marketing, no exclamation marks, no "AI magic" language.
- Say **"AURA prepared"**, **"Proposed"**, **"Awaiting human approval"** — never "AURA dispatched" before approval.
- Buttons say what happens: `APPROVE RESPONSE`, `REJECT`. After: `RESPONSE APPROVED`, `RESPONSE REJECTED`.
- Units are callsigns (`MEDIC 12`), ETAs are `4 MIN`, protocol ids are shown verbatim in mono (`MED_CARDIAC_01`).
- A persistent `SIMULATION` tag stays in the top bar. Never imply this is a live 911 system.
- Never invent numbers. If the event stream did not provide a value, show a hollow/empty state, not a fake one.

## 8. Banned (instant rejection)

Glassmorphism cards · rounded-2xl · purple/blue gradient blobs · gradient text · emoji · sparkle/"AI" icons ·
icon tiles · generic stat cards (big number + small label + trend arrow) · fake charts or fake latency numbers ·
`01 / 02 / 03` decoration · glow on non-live elements · centred hero text · Inter/Geist/Space Grotesk · bouncy springs · looping attention animations on idle UI.
