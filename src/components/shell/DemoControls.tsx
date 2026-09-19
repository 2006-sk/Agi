'use client';

import { useCallback } from 'react';

import { Panel } from '@/components/ui/Panel';
import { DEMO_BEATS, PRE_DURATION_MS, SESSION_ID } from '@/demo/mockEvents';
import type { MockPlayer, PlayerState } from '@/demo/mockPlayer';
import type { useAuraFeed } from '@/hooks/useAuraFeed';
import { COLOR, withAlpha } from '@/lib/tokens';
import { useAuraStore, type Connection } from '@/state/auraStore';

const SPEEDS = [0.5, 1, 2];

const CONNECTION: Record<Connection, { label: string; color: string }> = {
  offline: { label: 'Offline', color: COLOR.inert },
  mock: { label: 'Mock feed', color: COLOR.muted },
  connecting: { label: 'Connecting to gateway', color: COLOR.amber },
  live: { label: 'Live gateway', color: COLOR.cyan },
  error: { label: 'Gateway unreachable', color: COLOR.red },
};

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function beatAt(ms: number): string {
  let label = DEMO_BEATS[0]?.label ?? '';
  for (const b of DEMO_BEATS) {
    if (b.at <= ms) label = b.label;
    else break;
  }
  return label;
}

function TransportButton({
  onClick,
  disabled,
  label,
  accent,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed"
      style={{
        border: `1px solid ${withAlpha(accent, disabled ? 0.16 : 0.42)}`,
        background: withAlpha(accent, disabled ? 0.03 : 0.1),
        color: disabled ? withAlpha(COLOR.muted, 0.6) : accent,
      }}
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <path d="M2.5 1.6 L10 6 L2.5 10.4 Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <rect x="2.6" y="2" width="2.4" height="8" fill="currentColor" />
      <rect x="7" y="2" width="2.4" height="8" fill="currentColor" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <rect x="2" y="2" width="1.8" height="8" fill="currentColor" />
      <path d="M10.2 2 L10.2 10 L4.6 6 Z" fill="currentColor" />
    </svg>
  );
}

function Scrub({ player, state }: { player: MockPlayer; state: PlayerState }) {
  const scrubbable = state.segment === 'pre';
  const span = scrubbable ? PRE_DURATION_MS : Math.max(1, state.durationMs);
  const t = Math.max(0, Math.min(1, state.clockMs / span));
  const accent = state.phase === 'gated' ? COLOR.amber : COLOR.cyan;

  const seekFromEvent = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = (e.clientX - rect.left) / rect.width;
      player.seek(Math.max(0, Math.min(1, ratio)) * PRE_DURATION_MS);
    },
    [player],
  );

  const nudge = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 2000 : 500;
      if (e.key === 'ArrowRight') player.seek(state.clockMs + step);
      else if (e.key === 'ArrowLeft') player.seek(state.clockMs - step);
      else if (e.key === 'Home') player.seek(0);
      else return;
      e.preventDefault();
    },
    [player, state.clockMs],
  );

  return (
    <div className="relative h-6 min-w-0 flex-1">
      <div
        role={scrubbable ? 'slider' : 'progressbar'}
        aria-label={scrubbable ? 'Scrub the pre-approval timeline' : 'Dispatch playback'}
        aria-valuemin={0}
        aria-valuemax={Math.round(span)}
        aria-valuenow={Math.round(state.clockMs)}
        aria-valuetext={beatAt(state.clockMs)}
        tabIndex={scrubbable ? 0 : -1}
        onClick={scrubbable ? seekFromEvent : undefined}
        onKeyDown={scrubbable ? nudge : undefined}
        className={`absolute inset-0 flex items-center ${scrubbable ? 'cursor-pointer' : ''}`}
      >
        <div
          className="h-[3px] w-full rounded-full"
          style={{ background: withAlpha(COLOR.edge, 0.95) }}
        />
        <div
          className="absolute left-0 h-[3px] rounded-full"
          style={{
            width: `${t * 100}%`,
            background: accent,
            boxShadow: `0 0 8px ${withAlpha(accent, 0.9)}`,
          }}
        />
        <div
          className="absolute size-2 -translate-x-1/2 rounded-full"
          style={{
            left: `${t * 100}%`,
            background: accent,
            boxShadow: `0 0 9px ${accent}`,
          }}
        />
      </div>

      {scrubbable &&
        DEMO_BEATS.map((beat) => {
          const passed = state.clockMs >= beat.at;
          return (
            <button
              key={beat.at}
              type="button"
              title={beat.label}
              aria-label={`Jump to ${beat.label}`}
              onClick={() => player.seek(beat.at)}
              className="absolute top-0 h-full w-3 -translate-x-1/2"
              style={{ left: `${(beat.at / PRE_DURATION_MS) * 100}%` }}
            >
              <span
                className="mx-auto block h-2.5 w-px"
                style={{
                  background: passed ? withAlpha(COLOR.cyan, 0.85) : withAlpha(COLOR.muted, 0.7),
                }}
              />
            </button>
          );
        })}
    </div>
  );
}

function MockTransport({ player, state }: { player: MockPlayer; state: PlayerState }) {
  const gated = state.phase === 'gated';
  const playing = state.phase === 'playing';
  const done = state.phase === 'done';
  const accent = gated ? COLOR.amber : COLOR.violet;

  const status = gated
    ? 'Held — awaiting human approval'
    : done
      ? `Scenario complete · ${state.segment === 'rejected' ? 'dispatch rejected' : 'unit arrived'}`
      : playing
        ? beatAt(state.clockMs)
        : state.phase === 'paused'
          ? `Paused · ${beatAt(state.clockMs)}`
          : 'Standby';

  return (
    <Panel
      label="Demo feed"
      accent={accent}
      trailing={
        <span className="flex items-center gap-1">
          {SPEEDS.map((s) => {
            const on = Math.abs(state.speed - s) < 0.01;
            return (
              <button
                key={s}
                type="button"
                onClick={() => player.setSpeed(s)}
                aria-pressed={on}
                className="aura-mono rounded px-1.5 py-[1px]"
                style={{
                  fontSize: 9,
                  color: on ? COLOR.cyan : COLOR.muted,
                  border: `1px solid ${withAlpha(on ? COLOR.cyan : COLOR.muted, on ? 0.45 : 0.2)}`,
                  background: on ? withAlpha(COLOR.cyan, 0.1) : 'transparent',
                }}
              >
                {s}x
              </button>
            );
          })}
        </span>
      }
    >
      <div className="flex flex-col gap-1.5 px-3 pb-2.5 pt-2">
        <div className="flex items-center gap-2">
          <TransportButton
            onClick={() => player.toggle()}
            disabled={gated || done}
            label={playing ? 'Pause' : 'Play'}
            accent={COLOR.cyan}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </TransportButton>
          <TransportButton onClick={() => player.reset()} label="Restart scenario" accent={COLOR.muted}>
            <RestartIcon />
          </TransportButton>
          <Scrub player={player} state={state} />
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <span
            className="aura-mono truncate"
            style={{ fontSize: 10, color: gated ? COLOR.amber : withAlpha(COLOR.text, 0.72) }}
          >
            {status}
          </span>
          <span className="aura-mono shrink-0" style={{ fontSize: 9.5, color: COLOR.muted }}>
            {seconds(state.clockMs)}/{seconds(state.durationMs)}s
          </span>
        </div>
      </div>
    </Panel>
  );
}

function GatewayReadout({ socketError }: { socketError: string | null }) {
  const connection = useAuraStore((s) => s.connection);
  const sessionId = useAuraStore((s) => s.sessionId);
  const link = CONNECTION[connection];

  return (
    <Panel
      label="Gateway"
      accent={link.color}
      trailing={
        <span
          className="size-[6px] rounded-full"
          style={{ background: link.color, boxShadow: `0 0 8px ${withAlpha(link.color, 0.9)}` }}
          aria-hidden
        />
      }
    >
      <div className="flex flex-col gap-1 px-3 pb-2.5 pt-2">
        <span className="aura-mono" style={{ fontSize: 11.5, color: link.color }}>
          {link.label}
        </span>
        <span className="aura-mono truncate" style={{ fontSize: 9.5, color: COLOR.muted }}>
          {sessionId ?? SESSION_ID}
        </span>
        {socketError && (
          <span className="aura-mono truncate" style={{ fontSize: 9.5, color: COLOR.red }}>
            {socketError}
          </span>
        )}
      </div>
    </Panel>
  );
}

/**
 * The one component in the deck that takes props: the ~40Hz transport clock stops
 * here and never reaches the city or the panels.
 */
export function DemoControls({ feed }: { feed: ReturnType<typeof useAuraFeed> }) {
  const { mode, player, playerState, socketError } = feed;

  return (
    <div
      className="pointer-events-auto absolute bottom-[var(--aura-gutter)] left-[var(--aura-gutter)] z-20 w-[var(--aura-panel-w)] max-w-[calc(100vw-2*var(--aura-gutter))] max-[1100px]:w-[248px]"
    >
      {mode === 'live' ? (
        <GatewayReadout socketError={socketError} />
      ) : player && playerState ? (
        <MockTransport player={player} state={playerState} />
      ) : (
        <Panel label="Demo feed" accent={COLOR.muted}>
          <div className="px-3 pb-2.5 pt-2">
            <span className="aura-mono" style={{ fontSize: 10.5, color: COLOR.muted }}>
              Initialising transport…
            </span>
          </div>
        </Panel>
      )}
    </div>
  );
}
