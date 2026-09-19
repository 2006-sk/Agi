'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useSignalPulse } from '@/hooks/useSignal';
import { COLOR, EASE, PRIORITY_COLOR, withAlpha } from '@/lib/tokens';
import { useAuraStore, useResponderMayMove } from '@/state/auraStore';

const SEGMENTS = 30;
/** How long the decision stamp stays up before the card clears the city. */
const DISMISS_MS = 1200;

function fmtEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function fmtDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return '—';
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

function SegmentRow({
  lit,
  color,
  reverse = false,
}: {
  lit: number;
  color: string;
  reverse?: boolean;
}) {
  return (
    <div className="flex w-full gap-[2px]" aria-hidden>
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const index = reverse ? SEGMENTS - 1 - i : i;
        const on = index < lit;
        return (
          <span
            key={i}
            className="h-[3px] flex-1 rounded-full"
            style={{
              background: on ? withAlpha(color, 0.9) : 'rgba(148, 208, 255, 0.07)',
              boxShadow: on ? `0 0 7px ${withAlpha(color, 0.55)}` : 'none',
              transition: 'background 240ms linear, box-shadow 240ms linear',
            }}
          />
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  color = COLOR.text,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="aura-label" style={{ fontSize: 8.5 }}>
        {label}
      </span>
      <span className="aura-mono truncate" style={{ fontSize: 15, color }} title={value}>
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The human-approval gate. Nothing is dispatched until an operator decides here,
 * and expiry never decides for them.
 */
export function ApprovalGate() {
  const reduced = useReducedMotion();
  const degraded = useAuraStore((s) => s.degraded);
  const still = reduced || degraded;

  const approval = useAuraStore((s) => s.approval);
  const route = useAuraStore((s) => s.route);
  const units = useAuraStore((s) => s.units);
  const incident = useAuraStore((s) => s.incident);
  const resolveApproval = useAuraStore((s) => s.resolveApproval);
  const mayMove = useResponderMayMove();
  const flare = useSignalPulse('approvalOpen', 900);

  const id = approval?.id ?? null;
  const state = approval?.state ?? null;
  const expires = approval?.expiresInS ?? 0;
  const unitId = approval?.unitId ?? '';

  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [tick, setTick] = useState<{ id: string; left: number } | null>(null);
  const decided = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const unit = useMemo(
    () => units.find((u) => u.selected) ?? units.find((u) => u.id === unitId) ?? null,
    [units, unitId],
  );

  const priority = incident?.priority ?? 'unknown';
  const accent = incident ? PRIORITY_COLOR[priority] : COLOR.amber;
  const visible = approval !== null && approval.id !== dismissedId;
  const pending = visible && state === 'pending';

  useEffect(() => {
    decided.current = false;
  }, [id]);

  // Countdown anchored to a wall-clock start, so a slow tick never drifts. The ticks
  // are tagged with the approval id, so a new gate starts full without a reset pass.
  const counting = id !== null && state === 'pending' && expires > 0;
  const remaining = counting ? (tick?.id === id ? tick.left : expires) : null;

  useEffect(() => {
    if (!counting || !id) return;
    const startedAt = Date.now();
    const handle = window.setInterval(() => {
      const left = expires - (Date.now() - startedAt) / 1000;
      setTick({ id, left: left > 0 ? left : 0 });
      if (left <= 0) window.clearInterval(handle);
    }, 250);
    return () => window.clearInterval(handle);
  }, [counting, id, expires]);

  // A decided gate acknowledges, then gets out of the way. The cleanup also drops
  // the dismissal as soon as this decided gate is left behind: the scenario
  // re-issues the SAME approval id on restart, so a dismissal held past that point
  // would suppress the next gate for the rest of the page session.
  useEffect(() => {
    if (!id || state === null || state === 'pending') return;
    const handle = window.setTimeout(() => setDismissedId(id), DISMISS_MS);
    return () => {
      window.clearTimeout(handle);
      setDismissedId(null);
    };
  }, [id, state]);

  const decide = useCallback(
    (decision: 'granted' | 'rejected') => {
      if (decided.current) return;
      decided.current = true;
      resolveApproval(decision, 'operator');
    },
    [resolveApproval],
  );

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target?.isContentEditable) return;
      // A focused button owns Enter, or Enter on REJECT would approve.
      if (e.key === 'Enter' && tag === 'BUTTON') return;
      if (e.key === 'Enter' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        decide('granted');
      } else if (e.key === 'Escape' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        decide('rejected');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, decide]);

  useEffect(() => {
    if (pending) cardRef.current?.focus({ preventScroll: true });
  }, [pending, id]);

  const granted = state === 'granted';
  const rejected = state === 'rejected';
  const expired = pending && remaining !== null && remaining <= 0;
  const decisionColor = granted ? COLOR.green : rejected ? COLOR.red : accent;
  const frameColor = granted || rejected ? decisionColor : accent;
  const lit =
    remaining === null || expires <= 0
      ? SEGMENTS
      : Math.max(0, Math.min(SEGMENTS, Math.ceil((remaining / expires) * SEGMENTS)));

  return (
    <AnimatePresence>
      {visible && approval && (
        <motion.div
          key={approval.id}
          ref={cardRef}
          role="alertdialog"
          tabIndex={-1}
          aria-labelledby="aura-approval-title"
          aria-describedby="aura-approval-summary"
          className="pointer-events-auto relative outline-none"
          style={{ width: 'min(92vw, 540px)' }}
          initial={still ? { opacity: 0 } : { opacity: 0, y: 38, scale: 0.94 }}
          animate={still ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={still ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: still ? 0.12 : 0.44, ease: EASE.out }}
        >
          <div
            className="relative overflow-hidden rounded-2xl px-6 pt-4 pb-5"
            style={{
              background:
                'linear-gradient(180deg, rgba(10, 24, 48, 0.94) 0%, rgba(2, 5, 13, 0.97) 100%)',
              border: `1px solid ${withAlpha(frameColor, 0.55)}`,
              backdropFilter: degraded ? undefined : 'blur(18px) saturate(140%)',
              boxShadow: `0 40px 110px rgba(0,0,0,0.72), 0 0 70px ${withAlpha(frameColor, 0.2)}, inset 0 1px 0 ${withAlpha(frameColor, 0.22)}`,
            }}
          >
            {/* Heavy bracketed frame — instrumentation, not a dialog box. */}
            {(
              [
                { top: 10, left: 10, borderWidth: '2px 0 0 2px' },
                { top: 10, right: 10, borderWidth: '2px 2px 0 0' },
                { bottom: 10, left: 10, borderWidth: '0 0 2px 2px' },
                { bottom: 10, right: 10, borderWidth: '0 2px 2px 0' },
              ] as React.CSSProperties[]
            ).map((corner, i) => (
              <span
                key={i}
                className="pointer-events-none absolute"
                style={{
                  ...corner,
                  width: 18,
                  height: 18,
                  borderStyle: 'solid',
                  borderColor: frameColor,
                  boxShadow: `0 0 14px ${withAlpha(frameColor, 0.55)}`,
                }}
                aria-hidden
              />
            ))}

            {granted && (
              <motion.span
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `radial-gradient(120% 90% at 50% 50%, ${withAlpha(COLOR.green, 0.45)} 0%, transparent 72%)`,
                  mixBlendMode: 'screen',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: still ? 0.32 : [0, 0.6, 0.12] }}
                transition={{ duration: still ? 0 : 0.9, ease: EASE.out }}
                aria-hidden
              />
            )}

            <div className="relative flex flex-col gap-3.5">
              <SegmentRow lit={lit} color={decisionColor} />

              <header className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    className={`size-1.5 rounded-full ${still ? '' : 'aura-breathe'}`}
                    style={{ background: accent, boxShadow: `0 0 10px ${accent}` }}
                    aria-hidden
                  />
                  <span
                    id="aura-approval-title"
                    className="aura-label"
                    style={{ color: accent, fontSize: 10, letterSpacing: '0.24em' }}
                  >
                    HUMAN APPROVAL REQUIRED
                  </span>
                </span>
                <span className="aura-mono" style={{ fontSize: 9.5, color: COLOR.muted }}>
                  {incident?.id ?? approval.id}
                </span>
              </header>

              <p
                id="aura-approval-summary"
                className="m-0"
                style={{ fontSize: 19, lineHeight: 1.35, color: COLOR.text }}
              >
                {approval.summary || 'Dispatch the staged unit to this incident.'}
              </p>

              <div className="aura-rule" />

              <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
                <Stat
                  label="Unit"
                  value={unit ? unit.label : approval.unitId || '—'}
                  color={COLOR.cyan}
                />
                <Stat label="ETA" value={fmtEta(route?.etaS ?? unit?.etaS ?? 0)} />
                <Stat
                  label="Distance"
                  value={fmtDistance(route?.distanceM ?? unit?.distanceM ?? 0)}
                />
                <div className="flex flex-col gap-1">
                  <span className="aura-label" style={{ fontSize: 8.5 }}>
                    Priority
                  </span>
                  <PriorityBadge
                    priority={priority}
                    category={incident?.category}
                    pulse={priority === 'critical' && !still}
                  />
                </div>
              </div>

              {/* The standing claim must never outlive the decision that makes it
                  false: once movement is permitted, this states the fact instead. */}
              <div className="flex items-center gap-2">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={
                    mayMove
                      ? {
                          background: COLOR.green,
                          boxShadow: `0 0 10px ${withAlpha(COLOR.green, 0.9)}`,
                        }
                      : { border: `1px solid ${withAlpha(COLOR.muted, 0.8)}` }
                  }
                  aria-hidden
                />
                <span
                  className="aura-label"
                  style={{
                    fontSize: 8.5,
                    letterSpacing: '0.2em',
                    color: mayMove ? withAlpha(COLOR.green, 0.9) : undefined,
                  }}
                >
                  {mayMove
                    ? 'DISPATCH AUTHORISED BY OPERATOR'
                    : 'NO UNIT IS MOVING UNTIL YOU APPROVE'}
                </span>
              </div>

              {expired && (
                <span
                  className="aura-label"
                  style={{ fontSize: 8.5, color: COLOR.amber, letterSpacing: '0.2em' }}
                >
                  WINDOW ELAPSED · NO DECISION RECORDED — STILL AWAITING OPERATOR
                </span>
              )}

              {pending ? (
                <div className="flex items-stretch gap-3">
                  <button
                    type="button"
                    onClick={() => decide('granted')}
                    aria-label="Approve response and dispatch the proposed unit"
                    className="flex flex-[1.7] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-5 py-3 transition-[filter] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                    style={{
                      background: `linear-gradient(180deg, ${withAlpha(COLOR.green, 0.34)}, ${withAlpha(COLOR.green, 0.1)})`,
                      border: `1px solid ${withAlpha(COLOR.green, 0.75)}`,
                      boxShadow: `0 0 28px ${withAlpha(COLOR.green, 0.3)}, inset 0 1px 0 ${withAlpha(COLOR.green, 0.35)}`,
                    }}
                  >
                    <span
                      className="aura-mono"
                      style={{
                        fontSize: 13.5,
                        letterSpacing: '0.18em',
                        color: COLOR.text,
                        textShadow: `0 0 12px ${withAlpha(COLOR.green, 0.85)}`,
                      }}
                    >
                      APPROVE RESPONSE
                    </span>
                    <span className="aura-label" style={{ fontSize: 8 }}>
                      ENTER · A
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => decide('rejected')}
                    aria-label="Reject this dispatch proposal"
                    className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-4 py-3 transition-[filter] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red"
                    style={{
                      background: withAlpha(COLOR.red, 0.07),
                      border: `1px solid ${withAlpha(COLOR.red, 0.55)}`,
                    }}
                  >
                    <span
                      className="aura-mono"
                      style={{
                        fontSize: 13.5,
                        letterSpacing: '0.18em',
                        color: COLOR.red,
                      }}
                    >
                      REJECT
                    </span>
                    <span className="aura-label" style={{ fontSize: 8 }}>
                      ESC · R
                    </span>
                  </button>
                </div>
              ) : (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg px-4 py-3"
                  style={{
                    border: `1px solid ${withAlpha(decisionColor, 0.55)}`,
                    background: withAlpha(decisionColor, 0.1),
                  }}
                >
                  <span
                    className="aura-mono"
                    style={{
                      fontSize: 15,
                      letterSpacing: '0.22em',
                      color: decisionColor,
                      textShadow: `0 0 14px ${withAlpha(decisionColor, 0.7)}`,
                    }}
                  >
                    {granted ? 'APPROVED' : 'REJECTED'}
                  </span>
                  <span
                    className="aura-label truncate"
                    style={{ fontSize: 8.5, color: withAlpha(decisionColor, 0.85) }}
                  >
                    {(rejected && approval.reason) || approval.by || 'operator'}
                  </span>
                </div>
              )}

              <SegmentRow lit={lit} color={decisionColor} reverse />
            </div>
          </div>

          {flare && !still && (
            <motion.span
              className="pointer-events-none absolute -inset-2 rounded-[22px]"
              style={{ border: `1px solid ${accent}` }}
              initial={{ opacity: 0.75, scale: 0.98 }}
              animate={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.9, ease: EASE.out }}
              aria-hidden
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
