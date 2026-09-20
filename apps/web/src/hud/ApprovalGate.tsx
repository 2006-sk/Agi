import { AnimatePresence, motion } from "framer-motion";
import { useController } from "../hooks/useDemoController.ts";
import { useNow } from "../hooks/useNow.ts";
import { serviceColor } from "../lib/colors.ts";
import { selectFocus, useAuraStore } from "../store/useAuraStore.ts";
import { Arc, Chip, Dot, Kbd } from "./ui.tsx";

const RESOLVED_VISIBLE_MS = 7000;

export function ApprovalGate() {
  const controller = useController();
  const now = useNow(250);
  const focus = useAuraStore(selectFocus);
  const reviewer = useAuraStore((s) => s.settings.reviewer);
  const approval = focus?.approval ?? null;
  const cadId = focus?.state?.response_plan?.cad_id ?? null;

  const visible = approval && (!approval.resolved || (approval.resolvedAt !== null && now - approval.resolvedAt < RESOLVED_VISIBLE_MS));
  const payload = approval?.payload;
  const remaining = payload ? Math.max(0, payload.timeout_s - (now - (approval?.requestedAt ?? now)) / 1000) : 0;
  const primary = payload?.units[0];
  const riskColor = payload?.risk === "critical" ? "#ef4444" : payload?.risk === "high" ? "#fb923c" : "#fbbf24";

  return (
    <AnimatePresence>
      {visible && payload && approval && (
        <motion.div
          key={payload.action_id}
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className={`glass ${approval.resolved ? "" : "glass-critical"} pointer-events-auto w-[600px] overflow-hidden`}
        >
          <div className="flex items-center justify-between px-4 h-10 border-b hairline" style={{ background: approval.resolved ? undefined : "rgba(239,68,68,0.08)" }}>
            <div className="flex items-center gap-2.5">
              <Dot color={approval.resolved ? (approval.resolved.approved ? "#34d399" : "#ef4444") : "#ef4444"} pulse={!approval.resolved} size={9} />
              <span className="font-display font-semibold tracking-[0.22em] text-[12px] uppercase">
                {approval.resolved ? (approval.resolved.approved ? "dispatch approved" : "dispatch rejected") : "human approval required"}
              </span>
              <Chip color={riskColor}>{payload.risk} risk</Chip>
            </div>
            {!approval.resolved ? (
              <Arc value={remaining / payload.timeout_s} size={30} stroke={3} color={remaining < 20 ? "#ef4444" : "#fbbf24"}>
                <span className="mono text-[9px] text-white/80">{Math.ceil(remaining)}</span>
              </Arc>
            ) : (
              <span className="mono text-[10.5px] text-white/60">
                by {approval.resolved.reviewer} {cadId && approval.resolved.approved ? `/ ${cadId}` : ""}
              </span>
            )}
          </div>

          <div className="px-4 py-3 flex flex-col gap-3">
            <div className="text-[13.5px] text-white/95 leading-snug">{payload.summary}</div>

            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div className="flex flex-col gap-1.5">
                {payload.units.map((u, i) => (
                  <div
                    key={u.unit_id}
                    className={`flex items-center gap-3 rounded-md border px-2.5 py-1.5 ${i === 0 ? "border-white/20 bg-white/[0.05]" : "border-white/[0.06] opacity-60"}`}
                  >
                    <span className="mono text-[13px] font-semibold" style={{ color: serviceColor(u.service) }}>
                      {u.unit_id}
                    </span>
                    <span className="text-[11.5px] text-white/80">{u.type}</span>
                    <span className="mono text-[10px] text-white/45 truncate">{u.station}</span>
                    <span className="mono text-[11px] text-white/85 ml-auto whitespace-nowrap">
                      ETA {u.eta_minutes} min <span className="text-white/40">/ {u.distance_km} km</span>
                    </span>
                    {i === 0 && <Chip color="#34d399" className="!text-[9px]">primary</Chip>}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1.5 min-w-[170px]">
                <span className="label">on approval, AURA runs</span>
                {payload.proposed_tools.map((t) => (
                  <div key={t.name} className="rounded-md border border-white/[0.08] px-2 py-1.5" title={t.reason}>
                    <div className="mono text-[11px] text-emerald-300">{t.name}</div>
                    {typeof t.arguments.type === "string" && <div className="mono text-[9.5px] text-white/45">{t.arguments.type}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div className="mono text-[10.5px] text-white/50 leading-relaxed">
              <span className="text-white/30">why </span>
              {payload.reason}
              {primary && payload.route && (
                <>
                  {" "}
                  <span className="text-white/30">route </span>
                  {payload.route.distance_km} km / {payload.route.polyline.length} waypoints
                </>
              )}
            </div>

            {!approval.resolved ? (
              <div className="flex items-center gap-2 pt-1">
                <button type="button" className="btn btn-approve flex-1 !py-2.5 flex items-center justify-center gap-2" onClick={() => void controller.approve()}>
                  approve dispatch <Kbd>Enter</Kbd>
                </button>
                <button type="button" className="btn btn-reject !py-2.5 flex items-center gap-2" onClick={() => void controller.reject()}>
                  reject <Kbd>R</Kbd>
                </button>
                <span className="mono text-[10px] text-white/40 ml-1">reviewer {reviewer}</span>
              </div>
            ) : (
              <div className={`mono text-[11px] ${approval.resolved.approved ? "text-emerald-300" : "text-red-300"}`}>
                {approval.resolved.approved ? "CAD draft created. Units notified. AURA is coaching the caller until arrival." : "Held. Incident remains awaiting approval; nothing was dispatched."}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
