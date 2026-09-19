'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';

import { Panel } from '@/components/ui/Panel';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { COLOR, EASE, withAlpha } from '@/lib/tokens';
import {
  useAuraStore,
  useResponderMayMove,
  type DispatchState,
  type StageState,
  type ToolEntry,
} from '@/state/auraStore';
import {
  TOOL_STAGES,
  TOOL_STAGE_LABEL,
  type ToolStage,
  type ToolStatus,
} from '@/types/events';

const SLOT = 100 / TOOL_STAGES.length;
/** Centre of station `i` as a % of track width. -0.5 resolves to the left edge. */
function centre(i: number): number {
  return SLOT * (i + 0.5);
}

/** Node row geometry. Connectors and packets align to this, in px from track top. */
const NODE_Y = 11;
const NODE = 13;
const TRACK_H = 36;

/** Live packets are capped so a burst of tool calls cannot swamp the rail. */
const PACKET_CAP = 6;
const TRAVEL_S = 0.7;

const LOG_LINES = 3;

function stageColor(stage: ToolStage, state: StageState): string {
  if (state === 'blocked') return COLOR.red;
  if (state === 'error') return COLOR.amber;
  if (stage === 'human_approval') {
    if (state === 'done') return COLOR.green;
    if (state === 'active') return COLOR.amber;
    return COLOR.muted;
  }
  return state === 'idle' ? COLOR.muted : COLOR.cyan;
}

/**
 * The authoritative state of the human-approval station.
 *
 * `stages.human_approval` is writable by tool events (`tool.invoked` / `tool.result`
 * carrying stage 'human_approval'), so on its own it would paint the gate cleared
 * with no operator decision behind it. The only facts that may clear this gate are
 * `dispatch` / useResponderMayMove(): a tool-sourced 'done' is clamped back to
 * 'active' — still awaiting a human — until movement is actually permitted.
 *
 * Pure, and exported so the invariant can be asserted directly.
 */
export function resolveGateStage(
  stored: StageState,
  dispatch: DispatchState,
  mayMove: boolean,
): StageState {
  if (mayMove) return 'done';
  if (dispatch === 'rejected') return 'blocked';
  return stored === 'done' ? 'active' : stored;
}

function statusGlyph(status: ToolStatus): string {
  return status === 'ok' ? '✓' : status === 'error' ? '✕' : '⋯';
}

function statusColor(status: ToolStatus): string {
  return status === 'ok' ? COLOR.green : status === 'error' ? COLOR.amber : COLOR.cyan;
}

/* ------------------------------------------------------------------ */

function GateBracket({
  color,
  active,
  still,
}: {
  color: string;
  active: boolean;
  still: boolean;
}) {
  const corners: React.CSSProperties[] = [
    { top: 0, left: 0, borderWidth: '1.5px 0 0 1.5px' },
    { top: 0, right: 0, borderWidth: '1.5px 1.5px 0 0' },
    { bottom: 0, left: 0, borderWidth: '0 0 1.5px 1.5px' },
    { bottom: 0, right: 0, borderWidth: '0 1.5px 1.5px 0' },
  ];

  return (
    <span
      className="pointer-events-none absolute"
      style={{
        top: NODE_Y - 13,
        left: '50%',
        width: 26,
        height: 26,
        transform: 'translateX(-50%)',
      }}
      aria-hidden
    >
      {corners.map((c, i) => (
        <span
          key={i}
          className="absolute"
          style={{
            ...c,
            width: 7,
            height: 7,
            borderStyle: 'solid',
            borderColor: withAlpha(color, active ? 0.95 : 0.5),
          }}
        />
      ))}
      {active && (
        <span
          className="absolute inset-0 rounded-full"
          style={{
            border: `1px solid ${withAlpha(color, 0.6)}`,
            boxShadow: `0 0 16px ${withAlpha(color, 0.5)}`,
          }}
        />
      )}
      {active && !still && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ border: `1.5px solid ${color}` }}
          initial={{ scale: 0.55, opacity: 0.9 }}
          animate={{ scale: 1.9, opacity: 0 }}
          transition={{ duration: 1.5, ease: 'easeOut', repeat: Infinity }}
        />
      )}
    </span>
  );
}

function Station({
  stage,
  state,
  still,
}: {
  stage: ToolStage;
  state: StageState;
  still: boolean;
}) {
  const color = stageColor(stage, state);
  const lit = state !== 'idle';
  const struck = state === 'error' || state === 'blocked';
  const gate = stage === 'human_approval';

  return (
    <div className="relative flex min-w-0 flex-1 flex-col items-center">
      {gate && <GateBracket color={color} active={state === 'active'} still={still} />}
      <span
        className={`relative rounded-full ${state === 'active' && !still ? 'aura-breathe' : ''}`}
        style={{
          marginTop: NODE_Y - NODE / 2,
          width: NODE,
          height: NODE,
          background: lit && !struck ? color : 'rgba(3, 8, 20, 0.9)',
          border: `1px solid ${withAlpha(color, lit ? 0.92 : 0.4)}`,
          boxShadow: lit
            ? `0 0 10px ${withAlpha(color, 0.7)}, inset 0 0 6px ${withAlpha(color, 0.45)}`
            : 'none',
        }}
      >
        {struck && (
          <span
            className="absolute top-1/2 left-1/2"
            style={{
              width: NODE + 7,
              height: 1.5,
              background: color,
              boxShadow: `0 0 6px ${color}`,
              transform: 'translate(-50%, -50%) rotate(-45deg)',
            }}
          />
        )}
      </span>
      <span
        className="aura-label mt-1.5 w-full truncate text-center"
        style={{
          fontSize: 8.5,
          letterSpacing: '0.13em',
          color: lit ? withAlpha(color, 0.95) : COLOR.muted,
        }}
        title={TOOL_STAGE_LABEL[stage]}
      >
        {TOOL_STAGE_LABEL[stage]}
      </span>
    </div>
  );
}

function Connector({
  from,
  done,
  color,
  sweepColor,
  still,
}: {
  from: number;
  done: boolean;
  color: string;
  /** Set while the station this connector feeds is active. */
  sweepColor: string | null;
  still: boolean;
}) {
  return (
    <span
      className="pointer-events-none absolute overflow-hidden rounded-full"
      style={{
        left: `${centre(from)}%`,
        width: `${SLOT}%`,
        top: NODE_Y,
        height: 2,
        transform: 'translateY(-50%)',
        background: done
          ? `linear-gradient(90deg, ${withAlpha(color, 0.9)}, ${withAlpha(color, 0.45)})`
          : COLOR.inert,
        boxShadow: done ? `0 0 10px ${withAlpha(color, 0.45)}` : 'none',
      }}
      aria-hidden
    >
      {sweepColor && !still && (
        <span
          className="absolute inset-y-0"
          style={{
            width: '38%',
            background: `linear-gradient(90deg, transparent, ${withAlpha(sweepColor, 0.95)}, transparent)`,
            animation: 'aura-sweep 1.4s linear infinite',
          }}
        />
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The bottom action rail: the fixed five-stage pipeline, with each tool call
 * travelling the track as a packet that lands on its station.
 */
export function ToolRail() {
  const reduced = useReducedMotion();
  const degraded = useAuraStore((s) => s.degraded);
  const still = reduced || degraded;

  const storedStages = useAuraStore((s) => s.stages);
  const dispatchState = useAuraStore((s) => s.dispatch);
  const mayMove = useResponderMayMove();

  const stages: Record<ToolStage, StageState> = {
    ...storedStages,
    human_approval: resolveGateStage(
      storedStages.human_approval,
      dispatchState,
      mayMove,
    ),
  };

  // Counted off the clamped map, so the header never reports the gate as cleared
  // before the operator has decided.
  const doneCount = TOOL_STAGES.filter((st) => stages[st] === 'done').length;
  const anyActive = TOOL_STAGES.some((st) => stages[st] === 'active');

  // Only staged calls travel, and only the last PACKET_CAP of them are rendered so a
  // burst of tool calls cannot swamp the track. A settled packet stays mounted but
  // fully faded — it is retired when it falls out of this window or the session resets.
  const packets = useAuraStore(
    useShallow((s) =>
      s.tools
        .filter((t): t is ToolEntry & { stage: ToolStage } => t.stage !== null)
        .slice(-PACKET_CAP),
    ),
  );
  const log = useAuraStore(useShallow((s) => s.tools.slice(-LOG_LINES)));

  return (
    <Panel
      label="ACTION PIPELINE"
      accent={COLOR.cyan}
      className="h-[var(--aura-rail-h)] w-full overflow-hidden"
      bodyClassName="px-3.5 py-1.5"
      trailing={
        <span className="flex items-center gap-2">
          {anyActive && (
            <span
              className={`size-1.5 rounded-full ${still ? '' : 'aura-breathe'}`}
              style={{ background: COLOR.cyan, boxShadow: `0 0 8px ${COLOR.cyan}` }}
              aria-hidden
            />
          )}
          <span className="aura-mono" style={{ fontSize: 9.5, color: COLOR.muted }}>
            {doneCount}/{TOOL_STAGES.length}
          </span>
        </span>
      }
    >
      <div className="flex min-h-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="relative w-full" style={{ height: TRACK_H }}>
            {TOOL_STAGES.slice(0, -1).map((stage, i) => {
              const next = TOOL_STAGES[i + 1];
              const done = stages[stage] === 'done';
              return (
                <Connector
                  key={stage}
                  from={i}
                  done={done}
                  color={stageColor(stage, stages[stage])}
                  sweepColor={
                    stages[next] === 'active' ? stageColor(next, 'active') : null
                  }
                  still={still}
                />
              );
            })}

            <AnimatePresence>
              {packets.map((tool) => {
                const to = TOOL_STAGES.indexOf(tool.stage);
                // Stage 0 has no predecessor: the packet enters from the rail edge.
                const from = to === 0 ? -0.5 : to - 1;
                // Only a false "cleared" is held back: an ok result on the gate
                // stage stays a waiting packet until movement is permitted. A real
                // error still reads as an error.
                const status: ToolStatus =
                  tool.stage === 'human_approval' && !mayMove && tool.status === 'ok'
                    ? 'pending'
                    : tool.status;
                const colour =
                  status === 'error'
                    ? COLOR.amber
                    : tool.stage === 'human_approval'
                      ? COLOR.amber
                      : COLOR.cyan;

                return (
                  <motion.span
                    key={tool.id}
                    // Above the stations, so the landing reads as the ignition.
                    className="pointer-events-none absolute z-10"
                    style={{ top: NODE_Y, x: '-50%', y: '-50%' }}
                    initial={{ left: `${centre(still ? to : from)}%` }}
                    animate={{ left: `${centre(to)}%` }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: still ? 0 : TRAVEL_S, ease: EASE.out }}
                    aria-hidden
                  >
                    <motion.span
                      className="block rounded-full"
                      style={{
                        width: 7,
                        height: 7,
                        background: colour,
                        boxShadow: `0 0 10px ${colour}, 0 0 22px ${withAlpha(colour, 0.6)}`,
                      }}
                      initial={{ opacity: still ? 1 : 0.15, scale: still ? 1 : 0.5 }}
                      animate={
                        status === 'ok'
                          ? { opacity: 0, scale: 2.6, y: 0 }
                          : status === 'error'
                            ? { opacity: 0, scale: 0.7, y: 14 }
                            : { opacity: 1, scale: 1, y: 0 }
                      }
                      transition={{
                        duration: still ? 0 : status === 'pending' ? 0.24 : 0.42,
                        ease: EASE.snap,
                      }}
                    />
                  </motion.span>
                );
              })}
            </AnimatePresence>

            <div className="absolute inset-0 flex items-start">
              {TOOL_STAGES.map((stage) => (
                <Station
                  key={stage}
                  stage={stage}
                  state={stages[stage]}
                  still={still}
                />
              ))}
            </div>
          </div>
        </div>

        <span
          className="h-full w-px shrink-0"
          style={{
            background:
              'linear-gradient(180deg, transparent, rgba(34,211,238,0.22), transparent)',
          }}
          aria-hidden
        />

        <div
          className="flex shrink-0 flex-col justify-center gap-[3px]"
          style={{ width: 'clamp(150px, 26%, 268px)' }}
        >
          {log.length === 0 ? (
            <span className="aura-label" style={{ fontSize: 8.5 }}>
              standby · no tool activity
            </span>
          ) : (
            [...log].reverse().map((t) => (
              <div key={t.id} className="flex min-w-0 items-baseline gap-1.5">
                <span
                  className="aura-mono shrink-0"
                  style={{ fontSize: 9, color: statusColor(t.status), width: 7 }}
                >
                  {statusGlyph(t.status)}
                </span>
                <span
                  className="aura-mono shrink-0 truncate"
                  style={{ fontSize: 9.5, color: COLOR.text, maxWidth: '46%' }}
                  title={t.label}
                >
                  {t.label}
                </span>
                <span
                  className="aura-mono min-w-0 truncate"
                  style={{ fontSize: 9, color: COLOR.muted }}
                  title={t.summary}
                >
                  {t.summary || 'working…'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Panel>
  );
}
