"use client";

// The human-approval gate. This is the thesis of the product: AURA prepares, a person decides,
// and nothing moves until they do. It never resolves itself — not on timeout, not ever.
// DESIGN.md §4 allows this one element a solid abyss/92% plate because it has to win over the city.

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Glyph, Kbd } from "@/components/ui";
import { sendApproval } from "@/lib/auraClient";
import { normalizePriority } from "@/lib/contracts";
import { dur, easeOut } from "@/lib/motion";
import { cssVar, priorityColor } from "@/lib/palette";
import { useAura } from "@/state/auraStore";
import { etaLabel, useActiveCall } from "@/state/selectors";

/** motion wants a mutable bezier tuple; lib/motion exports a readonly one. */
const EASE: [number, number, number, number] = [...easeOut];

const PLATE = "rgb(7 11 18 / 0.92)"; // abyss @ 92%
const HOLD_MS = 2400; // the confirmation must not linger over the city

function Fact({ label, value, color }: { label: string; value: string | null; color?: string }) {
  return (
    <div className="flex-1 border-l border-rule pl-3 first:border-l-0 first:pl-0">
      <dt className="label-mono">{label}</dt>
      <dd
        className="data-mono mt-1 text-[13px]"
        style={{ color: value ? (color ?? "var(--color-ink)") : "var(--color-ink-3)" }}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

export default function ApprovalGate() {
  const call = useActiveCall();
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion();
  const still = reduced === true || quality === "low";

  const approval = call?.approval ?? null;
  const status = approval?.status ?? "idle";
  const requestedAt = approval?.requestedAt ?? null;
  const resolvedAt = approval?.resolvedAt ?? null;
  const timeoutS = approval?.timeoutS ?? null;
  const reviewer = approval?.reviewer ?? null;

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const secondsRef = useRef<HTMLSpanElement | null>(null);

  const [pending, setPending] = useState<boolean | null>(null);
  const [expired, setExpired] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const open = status === "requested";
  const approved = status === "approved";
  const resolved = (approved || status === "rejected") && showResolved;

  // A fresh request resets the panel, and a decision puts the confirmation up. Both are adjustments
  // to a changing input, so they happen during render (React's documented pattern) rather than in an
  // effect — the panel never paints a stale frame between the change and the reset.
  const [seenRequestedAt, setSeenRequestedAt] = useState(requestedAt);
  if (seenRequestedAt !== requestedAt) {
    setSeenRequestedAt(requestedAt);
    setPending(null);
    setExpired(false);
  }

  const [seenResolvedAt, setSeenResolvedAt] = useState(resolvedAt);
  if (seenResolvedAt !== resolvedAt) {
    setSeenResolvedAt(resolvedAt);
    setShowResolved(resolvedAt !== null);
  }

  // Confirm the decision, then get out of the way.
  useEffect(() => {
    if (resolvedAt === null) return;
    const t = window.setTimeout(() => setShowResolved(false), HOLD_MS);
    return () => window.clearTimeout(t);
  }, [resolvedAt]);

  // Focus the panel itself, never a button: REJECT must never be pre-focused.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open, requestedAt]);

  // Countdown: wall-clock rAF writing straight to the DOM — no per-frame React state.
  // Running out does NOT approve anything. It escalates the look and keeps waiting.
  useEffect(() => {
    if (!open || requestedAt === null || timeoutS === null || timeoutS <= 0) return;
    const total = timeoutS * 1000;
    let raf = 0;
    let shown = -1;
    const tick = () => {
      const left = Math.max(0, total - (Date.now() - requestedAt));
      if (barRef.current) barRef.current.style.transform = `scaleX(${left / total})`;
      const s = Math.ceil(left / 1000);
      if (s !== shown) {
        shown = s;
        if (secondsRef.current) secondsRef.current.textContent = `${s}S`;
      }
      if (left <= 0) {
        setExpired(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, requestedAt, timeoutS]);

  const decide = (yes: boolean) => {
    if (pending !== null) return;
    setPending(yes);
    // The gateway answers with approval.resolved; we never write the outcome ourselves.
    void sendApproval(yes);
  };

  const dispatch = call?.dispatch ?? null;
  const unit = dispatch?.units.find((u) => u.selected) ?? null;
  const eta = etaLabel(unit?.eta_seconds ?? dispatch?.route?.eta_seconds ?? null);
  const protocol = call?.incident?.protocol ?? null;
  const humanRequired = call?.incident?.human_required === true;
  const risk = approval?.risk ?? null;
  const riskColor = risk ? cssVar(priorityColor[normalizePriority(risk)]) : undefined;

  const resultLine = approved
    ? [reviewer ? `Approved by ${reviewer}` : "Approved", unit ? `${unit.callsign} en route` : null, eta]
        .filter(Boolean)
        .join(" · ")
    : [reviewer ? `Rejected by ${reviewer}` : "Rejected", "Handing this call to a human dispatcher"]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4">
      <AnimatePresence mode="wait" initial={false}>
        {open && (
          <motion.div
            key="decide"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            className="pointer-events-auto w-[min(560px,100%)] rounded-xs border"
            style={{
              background: PLATE,
              borderColor: expired
                ? "color-mix(in srgb, var(--color-critical) 65%, transparent)"
                : "var(--color-rule-strong)",
            }}
            initial={still ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: still ? 0.08 : dur.base, ease: EASE }}
          >
            {/* decision window — a fuse, not a deadline: it never decides for you */}
            {timeoutS !== null && (
              <div className="h-0.5 w-full overflow-hidden" style={{ background: "var(--color-rule)" }}>
                <div
                  ref={barRef}
                  className="h-full w-full origin-left"
                  style={{
                    background: expired ? "var(--color-critical)" : "var(--state)",
                    transform: "scaleX(1)",
                  }}
                />
              </div>
            )}

            <div className="hairline-b flex items-center justify-between gap-3 px-5 py-2.5">
              <span className="label-mono inline-flex items-center gap-2" style={{ color: "var(--state)" }}>
                <Glyph name="lock" size={12} />
                Human approval required
              </span>
              <span className="data-mono text-ink-3">
                {timeoutS === null ? (
                  "No decision window"
                ) : (
                  <>
                    Decision window{" "}
                    <span
                      ref={secondsRef}
                      style={{ color: expired ? "var(--color-critical)" : "var(--color-ink)" }}
                    >{`${timeoutS}S`}</span>
                  </>
                )}
              </span>
            </div>

            <div className="px-5 pt-4 pb-4">
              <h2 id={titleId} className="display text-[28px] text-ink">
                {approval?.action ?? "Human approval required"}
              </h2>

              <dl className="mt-4 flex items-stretch">
                <Fact label="Unit" value={unit?.callsign ?? null} />
                <Fact label="ETA" value={eta} />
                <Fact label="Risk" value={risk ? risk.toUpperCase() : null} color={riskColor} />
              </dl>

              <div className="mt-4">
                <span className="label-mono">AURA prepared</span>
                <p
                  className="mt-1 max-w-[56ch] text-[14px] leading-[1.45]"
                  style={{ color: dispatch?.reason ? "var(--color-ink)" : "var(--color-ink-3)" }}
                >
                  {dispatch?.reason ?? "No reason was recorded for this proposal."}
                </p>
              </div>

              <div className="hairline-t mt-4 pt-2.5">
                <div className="data-mono text-ink-3">
                  {protocol ? (
                    <>
                      <span className="text-ink-2">{protocol.id}</span> · {protocol.step}
                    </>
                  ) : (
                    "No protocol step recorded"
                  )}
                </div>
                {humanRequired && (
                  <div className="mt-1 text-[13px] text-ink-2">
                    This protocol step may not be executed without a human decision.
                  </div>
                )}
              </div>

              {expired && (
                <div
                  className="data-mono mt-3 flex items-center gap-2"
                  style={{ color: "var(--color-critical)" }}
                  role="status"
                >
                  <Glyph name="other" size={12} />
                  Decision window elapsed. Still awaiting a human — nothing has been dispatched.
                </div>
              )}
            </div>

            <div className="hairline-t flex items-stretch gap-3 px-5 py-4">
              <button
                type="button"
                onClick={() => decide(true)}
                disabled={pending !== null}
                className="display flex h-[52px] flex-[2] items-center justify-center rounded-xs px-4 text-[26px] disabled:opacity-45"
                style={{
                  color: "var(--color-void)",
                  background: "var(--color-approved)",
                  boxShadow: still ? undefined : "0 0 30px color-mix(in srgb, var(--color-approved) 35%, transparent)",
                }}
              >
                Approve response
              </button>
              <button
                type="button"
                onClick={() => decide(false)}
                disabled={pending !== null}
                className="display h-[52px] flex-1 rounded-xs border border-rule-strong px-4 text-[26px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-45"
              >
                Reject
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 px-5 pb-4">
              <span className="data-mono flex items-center gap-1.5 text-ink-3">
                <Kbd>A</Kbd> approve
                <span aria-hidden className="px-1">
                  ·
                </span>
                <Kbd>R</Kbd> reject
              </span>
              <span className="data-mono text-ink-3">
                {pending === null ? "Nothing moves until you decide" : "Decision sent · awaiting confirmation"}
              </span>
            </div>
          </motion.div>
        )}

        {!open && resolved && (
          <motion.div
            key="result"
            role="status"
            className="pointer-events-auto w-[min(560px,100%)] rounded-xs border px-5 py-5"
            style={{
              background: PLATE,
              borderColor: approved
                ? "color-mix(in srgb, var(--color-approved) 55%, transparent)"
                : "var(--color-rule-strong)",
            }}
            initial={still ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: still ? 0.08 : dur.base, ease: EASE }}
          >
            <div
              className="flex items-center gap-3"
              style={{ color: approved ? "var(--color-approved)" : "var(--color-ink)" }}
            >
              <Glyph name={approved ? "check" : "cross"} size={18} />
              <span className="display text-[34px]">{approved ? "Response approved" : "Response rejected"}</span>
            </div>
            <p className="data-mono mt-2 text-ink-2">{resultLine}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
