'use client';

import { COLOR, withAlpha } from '@/lib/tokens';
import { useAuraStore, type Connection, type Phase } from '@/state/auraStore';

const PHASE_STEPS: { key: Phase; label: string }[] = [
  { key: 'incoming', label: 'Incoming' },
  { key: 'assessing', label: 'Assessing' },
  { key: 'awaiting_approval', label: 'Approval' },
  { key: 'dispatched', label: 'Dispatch' },
  { key: 'resolved', label: 'Resolved' },
];

/** `critical` is an escalation of assessing, not a step of its own. */
const PHASE_INDEX: Record<Phase, number> = {
  idle: -1,
  incoming: 0,
  assessing: 1,
  critical: 1,
  awaiting_approval: 2,
  dispatched: 3,
  resolved: 4,
};

const PHASE_COLOR: Record<Phase, string> = {
  idle: COLOR.muted,
  incoming: COLOR.cyan,
  assessing: COLOR.violet,
  critical: COLOR.red,
  awaiting_approval: COLOR.amber,
  dispatched: COLOR.green,
  resolved: COLOR.muted,
};

/** Green stays reserved for approval, so the link state speaks in cyan and amber. */
const CONNECTION: Record<Connection, { label: string; color: string }> = {
  offline: { label: 'Offline', color: COLOR.inert },
  mock: { label: 'Mock feed', color: COLOR.muted },
  connecting: { label: 'Connecting', color: COLOR.amber },
  live: { label: 'Live gateway', color: COLOR.cyan },
  error: { label: 'Gateway error', color: COLOR.red },
};

function Stat({ label, value, tint }: { label: string; value: number; tint?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="aura-label" style={{ fontSize: 8 }}>
        {label}
      </span>
      <span
        className="aura-mono"
        style={{ fontSize: 10.5, color: tint ?? withAlpha(COLOR.text, 0.8) }}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Instrumentation strip, not navigation. Left: identity and where the call is in its
 * lifecycle. Right: proof the event pipeline is actually running.
 */
export function TopBar() {
  const phase = useAuraStore((s) => s.phase);
  const sessionId = useAuraStore((s) => s.sessionId);
  const connection = useAuraStore((s) => s.connection);
  const liveCalls = useAuraStore((s) =>
    s.callIds.reduce((n, id) => n + (s.calls[id]?.status === 'live' ? 1 : 0), 0),
  );
  const applied = useAuraStore((s) => s.stats.applied);
  const duplicates = useAuraStore((s) => s.stats.duplicates);
  const buffered = useAuraStore((s) => s.stats.buffered);
  const reduced = useAuraStore((s) => s.reducedMotion || s.degraded);

  const phaseColor = PHASE_COLOR[phase];
  const current = PHASE_INDEX[phase];
  const link = CONNECTION[connection];

  return (
    <header
      className="relative flex h-[46px] shrink-0 items-center gap-4 px-[var(--aura-gutter)]"
      style={{
        background:
          'linear-gradient(180deg, rgba(3,8,20,0.92) 0%, rgba(3,8,20,0.66) 70%, transparent 100%)',
      }}
    >
      {/* wordmark */}
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          className={`size-[6px] rounded-full ${reduced ? '' : 'aura-breathe'}`}
          style={{ background: COLOR.cyan, boxShadow: `0 0 8px ${COLOR.cyan}` }}
          aria-hidden
        />
        <span
          className="aura-mono"
          style={{ fontSize: 13, letterSpacing: '0.44em', color: COLOR.text }}
        >
          AURA
        </span>
      </div>

      <span className="h-4 w-px shrink-0" style={{ background: withAlpha(COLOR.edge, 0.9) }} />

      <span className="aura-mono shrink-0 max-[900px]:hidden" style={{ fontSize: 10, color: COLOR.muted }}>
        {sessionId ?? '— awaiting session —'}
      </span>

      <span className="h-4 w-px shrink-0 max-[900px]:hidden" style={{ background: withAlpha(COLOR.edge, 0.9) }} />

      {/* phase ladder */}
      <nav className="flex min-w-0 items-center gap-2.5" aria-label="Call phase">
        {PHASE_STEPS.map((step, i) => {
          const active = i === current;
          const passed = i < current;
          return (
            <span key={step.key} className="flex shrink-0 items-center gap-1.5">
              <span
                className="h-[3px] w-4 rounded-full"
                style={{
                  background: active
                    ? phaseColor
                    : passed
                      ? withAlpha(phaseColor, 0.4)
                      : COLOR.inert,
                  boxShadow: active ? `0 0 9px ${phaseColor}` : undefined,
                }}
                aria-hidden
              />
              <span
                className={`aura-label ${active ? '' : 'max-[1240px]:hidden'}`}
                style={{
                  color: active
                    ? phaseColor
                    : passed
                      ? withAlpha(COLOR.text, 0.5)
                      : COLOR.muted,
                }}
                aria-current={active ? 'step' : undefined}
              >
                {step.label}
              </span>
            </span>
          );
        })}
        {current < 0 && (
          <span className="aura-label" style={{ color: COLOR.muted }}>
            Standby
          </span>
        )}
      </nav>

      <span
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-[3px]"
        style={{
          borderColor: withAlpha(liveCalls > 0 ? COLOR.cyan : COLOR.muted, 0.35),
          background: withAlpha(liveCalls > 0 ? COLOR.cyan : COLOR.muted, 0.08),
        }}
      >
        <span
          className="aura-mono"
          style={{ fontSize: 11, color: liveCalls > 0 ? COLOR.cyan : COLOR.muted }}
        >
          {liveCalls}
        </span>
        <span className="aura-label" style={{ fontSize: 8 }}>
          live
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className="size-[6px] rounded-full"
          style={{ background: link.color, boxShadow: `0 0 7px ${withAlpha(link.color, 0.8)}` }}
          aria-hidden
        />
        <span className="aura-label" style={{ color: link.color }}>
          {link.label}
        </span>
      </span>

      <span className="h-4 w-px shrink-0 max-[1040px]:hidden" style={{ background: withAlpha(COLOR.edge, 0.9) }} />

      <div className="flex shrink-0 items-center gap-3 max-[1040px]:hidden" title="Ingest telemetry">
        <Stat label="applied" value={applied} tint={COLOR.cyan} />
        <Stat label="dup" value={duplicates} tint={duplicates > 0 ? COLOR.amber : undefined} />
        <Stat label="buf" value={buffered} tint={buffered > 0 ? COLOR.amber : undefined} />
      </div>

      <div className="aura-rule absolute inset-x-0 bottom-0" aria-hidden />
    </header>
  );
}
