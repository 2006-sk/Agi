'use client';

import { useEffect, useRef } from 'react';
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useAnimationControls,
} from 'framer-motion';

import { Panel } from '@/components/ui/Panel';
import { COLOR, DURATION, EASE, PRIORITY_COLOR, withAlpha } from '@/lib/tokens';
import { useAuraStore, type ProtocolStepEntry } from '@/state/auraStore';

/** Either flag collapses motion to a still, still-readable state. */
function useStill(): boolean {
  return useAuraStore((s) => s.reducedMotion || s.degraded);
}

type Connector = 'lit' | 'flow' | 'dim';

export function ProtocolFlow() {
  const still = useStill();
  const protocol = useAuraStore((s) => s.protocol);
  const priority = useAuraStore((s) => s.incident?.priority ?? 'unknown');

  // A protocol swap is a re-announcement, not a quiet data update. The keyed
  // subtrees below remount on the new id; the border flash is fired here off a
  // ref holding the previous id, so a swap announces harder than a first
  // activation.
  const flash = useAnimationControls();
  const prevProtocolId = useRef<string | null>(null);

  useEffect(() => {
    prevProtocolId.current = useAuraStore.getState().protocol?.id ?? null;
    if (still) {
      // Motion just went off: a flash already in flight must not keep running.
      flash.stop();
      flash.set({ opacity: 0 });
    }
    return useAuraStore.subscribe((s) => {
      const next = s.protocol?.id ?? null;
      if (next === prevProtocolId.current) return;
      const swap = prevProtocolId.current !== null && next !== null;
      prevProtocolId.current = next;
      if (!next || still) return;
      void flash.start({ opacity: [swap ? 1 : 0.7, 0] }, { duration: 0.9, ease: EASE.out });
    });
  }, [flash, still]);

  const steps = protocol?.steps ?? [];
  const done = steps.filter((s) => s.status === 'done').length;
  const active = steps.find((s) => s.status === 'active') ?? null;
  const incidentColor = PRIORITY_COLOR[priority];

  return (
    <MotionConfig reducedMotion={still ? 'always' : 'user'}>
      <div className="relative h-full min-h-0">
        {/* Sibling of the panel so the flash reads as the panel's own border. */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-[14px]"
          initial={{ opacity: 0 }}
          animate={flash}
          style={{
            border: `1px solid ${incidentColor}`,
            boxShadow: `inset 0 0 26px ${withAlpha(incidentColor, 0.28)}, 0 0 22px ${withAlpha(incidentColor, 0.35)}`,
          }}
        />
        <Panel
          label="Protocol"
          accent={COLOR.violet}
          className="h-full min-h-0"
          trailing={
            steps.length > 0 ? (
              <span className="aura-mono" style={{ fontSize: 11, color: withAlpha(COLOR.text, 0.8) }}>
                {done}
                <span style={{ color: COLOR.muted }}>/{steps.length}</span>
              </span>
            ) : (
              <span className="aura-label">idle</span>
            )
          }
        >
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="aura-scroll min-h-0 flex-1 overflow-y-auto px-3.5 pt-2.5 pb-3">
              {protocol ? (
                <>
                  {/* popLayout: the new name enters at once, the old one leaves the
                      flow, so the re-announcement never waits or jumps. */}
                  <div className="relative">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.div
                        key={protocol.id}
                        initial={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
                        transition={{ duration: still ? 0 : DURATION.base, ease: EASE.out }}
                      >
                        <h3
                          className="text-[13.5px] leading-tight font-semibold tracking-tight"
                          style={{
                            color: COLOR.text,
                            textShadow: `0 0 14px ${withAlpha(COLOR.violet, 0.55)}`,
                          }}
                        >
                          {protocol.name}
                        </h3>
                        {protocol.why && (
                          <p
                            className="mt-1 text-[11px] leading-snug"
                            style={{ color: withAlpha(COLOR.violet, 0.92) }}
                          >
                            {protocol.why}
                          </p>
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  <div className="my-2.5 aura-rule" style={{ opacity: 0.55 }} />

                  <ol key={protocol.id} className="flex flex-col">
                    {protocol.steps.map((step, i) => (
                      <StepRow
                        key={step.id}
                        step={step}
                        connector={connectorFor(protocol.steps, i)}
                        last={i === protocol.steps.length - 1}
                        index={i}
                        still={still}
                      />
                    ))}
                  </ol>

                  {active && (
                    <p className="mt-1 text-[10px] leading-snug" style={{ color: COLOR.muted }}>
                      <span className="aura-label">current · </span>
                      <span style={{ color: withAlpha(COLOR.text, 0.8) }}>{active.label}</span>
                    </p>
                  )}
                </>
              ) : (
                <EmptySpine />
              )}
            </div>
          </div>
        </Panel>
      </div>
    </MotionConfig>
  );
}

/** Lit only between two completed steps; everything past the active step is dim. */
function connectorFor(steps: ProtocolStepEntry[], i: number): Connector {
  const here = steps[i];
  const next = steps[i + 1];
  if (!next) return 'dim';
  if (here.status === 'done' && next.status === 'done') return 'lit';
  if (here.status === 'done' && next.status === 'active') return 'flow';
  return 'dim';
}

const NODE_BOX = 20;

function StepRow({
  step,
  connector,
  last,
  index,
  still,
}: {
  step: ProtocolStepEntry;
  connector: Connector;
  last: boolean;
  index: number;
  still: boolean;
}) {
  const active = step.status === 'active';
  const blocked = step.status === 'blocked';
  const done = step.status === 'done';
  const delay = still ? 0 : 0.06 + index * 0.07;

  const label = active
    ? COLOR.text
    : done
      ? withAlpha(COLOR.text, 0.62)
      : blocked
        ? withAlpha(COLOR.amber, 0.95)
        : withAlpha(COLOR.muted, 0.85);

  const line =
    connector === 'lit'
      ? `linear-gradient(180deg, ${withAlpha(COLOR.violet, 0.85)}, ${withAlpha(COLOR.violet, 0.85)})`
      : connector === 'flow'
        ? `linear-gradient(180deg, ${withAlpha(COLOR.violet, 0.85)}, ${withAlpha(COLOR.violet, 0.2)})`
        : `linear-gradient(180deg, ${withAlpha(COLOR.muted, 0.28)}, ${withAlpha(COLOR.muted, 0.14)})`;

  return (
    <motion.li
      className="relative flex gap-2.5 pb-3.5 last:pb-0"
      initial={{ opacity: still ? 1 : 0, y: still ? 0 : -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: still ? 0 : 0.34, ease: EASE.out, delay }}
    >
      <div className="relative flex shrink-0 justify-center" style={{ width: NODE_BOX }}>
        {!last && (
          <motion.span
            aria-hidden
            className="absolute left-1/2 w-[1.5px] origin-top"
            style={{
              top: NODE_BOX / 2 + 7,
              bottom: -14,
              marginLeft: -0.75,
              background: line,
              boxShadow:
                connector === 'dim' ? undefined : `0 0 8px ${withAlpha(COLOR.violet, 0.45)}`,
            }}
            initial={{ scaleY: still ? 1 : 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: still ? 0 : 0.4, ease: EASE.out, delay }}
          />
        )}
        <StepNode status={step.status} still={still} />
      </div>

      <div className="min-w-0 flex-1">
        <span
          className="block text-[12.5px] leading-[1.25]"
          style={{
            color: label,
            fontWeight: active ? 500 : 400,
            textDecoration: blocked ? 'line-through' : undefined,
            textShadow: active ? `0 0 14px ${withAlpha(COLOR.violet, 0.5)}` : undefined,
          }}
        >
          {step.label}
        </span>
        {(active || blocked) && step.why && (
          <motion.span
            className="mt-0.5 block text-[10.5px] leading-snug"
            style={{ color: blocked ? withAlpha(COLOR.amber, 0.9) : withAlpha(COLOR.violet, 0.95) }}
            initial={{ opacity: still ? 1 : 0, x: still ? 0 : -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: still ? 0 : DURATION.base, ease: EASE.out }}
          >
            {step.why}
          </motion.span>
        )}
      </div>
    </motion.li>
  );
}

function StepNode({ status, still }: { status: ProtocolStepEntry['status']; still: boolean }) {
  if (status === 'active') {
    return (
      <span className="relative flex items-center justify-center" style={{ height: NODE_BOX }}>
        <span
          aria-hidden
          className={`absolute size-[22px] rounded-full ${still ? '' : 'aura-breathe'}`}
          style={{
            border: `1px solid ${withAlpha(COLOR.violet, 0.5)}`,
            boxShadow: `0 0 16px ${withAlpha(COLOR.violet, 0.45)}`,
          }}
        />
        <span
          className="size-[12px] rounded-full"
          style={{
            background: COLOR.violet,
            boxShadow: `0 0 14px ${withAlpha(COLOR.violet, 0.95)}`,
          }}
        />
      </span>
    );
  }

  if (status === 'done') {
    return (
      <span className="relative flex items-center justify-center" style={{ height: NODE_BOX }}>
        <span
          className="flex size-[13px] items-center justify-center rounded-full"
          style={{ background: withAlpha(COLOR.violet, 0.85) }}
        >
          <svg width={13} height={13} viewBox="0 0 13 13" aria-hidden>
            <motion.path
              d="M3.4 6.8 L5.5 9 L9.6 4.2"
              fill="none"
              stroke={COLOR.ground}
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: still ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: still ? 0 : 0.28, ease: EASE.out }}
            />
          </svg>
        </span>
      </span>
    );
  }

  if (status === 'blocked') {
    return (
      <span className="relative flex items-center justify-center" style={{ height: NODE_BOX }}>
        <svg width={15} height={15} viewBox="0 0 15 15" aria-hidden>
          <circle
            cx={7.5}
            cy={7.5}
            r={6}
            fill="rgba(3, 8, 20, 0.6)"
            stroke={COLOR.amber}
            strokeWidth={1.2}
          />
          <line
            x1={3.6}
            y1={11.4}
            x2={11.4}
            y2={3.6}
            stroke={COLOR.amber}
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className="relative flex items-center justify-center" style={{ height: NODE_BOX }}>
      <span
        className="size-[11px] rounded-full"
        style={{
          border: `1px solid ${withAlpha(COLOR.muted, 0.5)}`,
          background: 'rgba(3, 8, 20, 0.6)',
        }}
      />
    </span>
  );
}

/** The shape of the thing, empty — a dim spine with nothing on it yet. */
function EmptySpine() {
  return (
    <div>
      <span className="aura-label">no protocol active</span>
      <ol className="mt-3 flex flex-col">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="relative flex gap-2.5 pb-3.5 last:pb-0">
            <div className="relative flex shrink-0 justify-center" style={{ width: NODE_BOX }}>
              {i < 3 && (
                <span
                  aria-hidden
                  className="absolute left-1/2 w-[1.5px]"
                  style={{
                    top: NODE_BOX / 2 + 7,
                    bottom: -14,
                    marginLeft: -0.75,
                    background: withAlpha(COLOR.muted, 0.16),
                  }}
                />
              )}
              <StepNode status="idle" still />
            </div>
            <div className="flex min-w-0 flex-1 items-center">
              <span
                className="block h-[7px] rounded-full"
                style={{
                  width: `${62 - i * 9}%`,
                  background: withAlpha(COLOR.muted, 0.12),
                }}
                aria-hidden
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
