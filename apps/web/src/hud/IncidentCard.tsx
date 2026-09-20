import { AnimatePresence, motion } from "framer-motion";
import { CATEGORY_LABEL, priorityColor, serviceColor } from "../lib/colors.ts";
import { humanize, pct } from "../lib/format.ts";
import { selectFocus, useAuraStore } from "../store/useAuraStore.ts";
import { Arc, Chip, Panel, Stat } from "./ui.tsx";

function assessmentColor(value: string): string {
  switch (value) {
    case "yes":
    case "normal":
      return "#34d399";
    case "labored":
      return "#fbbf24";
    case "no":
      return "#ef4444";
    default:
      return "#64748b";
  }
}

export function IncidentCard() {
  const focus = useAuraStore(selectFocus);
  const state = focus?.state ?? null;

  if (!focus || !state) {
    return (
      <Panel title="incident" className="flex-1">
        <div className="h-full flex items-center justify-center mono text-[11px] text-white/35">Waiting for a call.</div>
      </Panel>
    );
  }

  const color = priorityColor(state.priority);
  const critical = state.priority === "critical";
  const statusColor = state.status === "dispatched" ? "#34d399" : state.status === "awaiting_approval" ? "#ef4444" : "#9ca3af";

  return (
    <Panel
      title={`incident / ${state.session_id}`}
      right={
        <Chip color={statusColor}>
          {state.status === "awaiting_approval" ? "awaiting human approval" : humanize(state.status)}
        </Chip>
      }
      className="flex-1"
      bodyClassName="p-3 overflow-y-auto scroll-thin flex flex-col gap-3"
      critical={critical && state.status !== "dispatched"}
    >
      <div className="flex items-stretch gap-3">
        <div className="flex-1 min-w-0">
          <div className="label mb-1">priority</div>
          <div className="relative h-[46px]">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={state.priority}
                initial={{ rotateX: -90, opacity: 0, y: 8 }}
                animate={{ rotateX: 0, opacity: 1, y: 0 }}
                exit={{ rotateX: 90, opacity: 0, y: -8 }}
                transition={{ type: "spring", stiffness: 380, damping: 26 }}
                className={`absolute inset-0 flex items-center px-3 rounded-md border font-display font-semibold tracking-[0.2em] text-[20px] uppercase ${
                  critical ? "animate-pulse-fast" : ""
                }`}
                style={{
                  color,
                  borderColor: `${color}88`,
                  background: `linear-gradient(90deg, ${color}26, transparent)`,
                  boxShadow: critical ? `0 0 30px ${color}55, inset 0 0 20px ${color}22` : `inset 0 0 20px ${color}11`,
                }}
              >
                {state.priority === "unknown" ? "assessing" : state.priority}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <Arc value={state.confidence} color={color} size={60}>
          <div className="text-center leading-none">
            <div className="mono text-[13px] text-white/90">{pct(state.confidence)}</div>
            <div className="label !text-[8px] mt-0.5">conf</div>
          </div>
        </Arc>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="category" value={<span style={{ color: state.category === "unknown" ? undefined : color }}>{CATEGORY_LABEL[state.category]}</span>} />
        <Stat label="people at risk" value={state.people_at_risk ?? "--"} />
        <Stat label="protocol" value={state.protocol.id ?? "--"} />
      </div>

      <div className="border-t hairline pt-2">
        <div className="flex items-center justify-between">
          <span className="label">location</span>
          {state.location.verified ? (
            <Chip color="#34d399">verified {pct(state.location.confidence)}</Chip>
          ) : state.location.raw ? (
            <Chip color="#fbbf24">unverified</Chip>
          ) : (
            <Chip color="#64748b" dim>
              unknown
            </Chip>
          )}
        </div>
        <AnimatePresence initial={false}>
          {state.location.raw && (
            <motion.div key="raw" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mono text-[11px] text-white/40 italic mt-1 truncate">
              "{state.location.raw}"
            </motion.div>
          )}
          {state.location.normalized && (
            <motion.div key="norm" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-[13px] text-white/95 mt-0.5 leading-snug">
              {state.location.normalized}
            </motion.div>
          )}
          {state.location.latitude !== null && (
            <motion.div key="coords" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mono text-[10px] text-aura/80 mt-0.5">
              {state.location.latitude.toFixed(4)}, {state.location.longitude?.toFixed(4)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="border-t hairline pt-2 grid grid-cols-2 gap-2">
        <div>
          <div className="label mb-1">conscious</div>
          <Chip color={assessmentColor(state.assessment.conscious)} className="!text-[11px] !px-2 !py-1">
            {state.assessment.conscious.toUpperCase()}
          </Chip>
        </div>
        <div>
          <div className="label mb-1">breathing</div>
          <Chip
            color={assessmentColor(state.assessment.breathing)}
            className={`!text-[11px] !px-2 !py-1 ${state.assessment.breathing === "no" ? "animate-pulse-fast" : ""}`}
          >
            {state.assessment.breathing === "no" ? "NOT BREATHING" : state.assessment.breathing.toUpperCase()}
          </Chip>
        </div>
        {state.assessment.chief_complaint && (
          <div className="col-span-2 mono text-[11px] text-white/70">
            <span className="text-white/35">chief complaint </span>
            {state.assessment.chief_complaint}
          </div>
        )}
      </div>

      <div className="border-t hairline pt-2">
        <div className="label mb-1.5">facts</div>
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {state.facts.map((f) => (
              <motion.span key={`f-${f}`} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <Chip color={f.includes("not breathing") || f.includes("unresponsive") ? "#ef4444" : "#e5e7eb"} className="!text-[11px]">
                  {f}
                </Chip>
              </motion.span>
            ))}
            {state.unverified_facts.map((f) => (
              <motion.span key={`u-${f}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Chip color="#9ca3af" dim className="!text-[11px] italic" title="model-only, awaiting corroboration">
                  {f}?
                </Chip>
              </motion.span>
            ))}
            {state.hazards.map((h) => (
              <motion.span key={`h-${h}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Chip color="#f97316" className="!text-[11px]">
                  hazard: {h}
                </Chip>
              </motion.span>
            ))}
          </AnimatePresence>
          {state.facts.length + state.unverified_facts.length === 0 && <span className="mono text-[11px] text-white/30">none yet</span>}
        </div>
      </div>

      <div className="border-t hairline pt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label mb-1.5">still needed</div>
          <div className="flex flex-wrap gap-1.5">
            {state.missing_fields.length === 0 ? (
              <span className="mono text-[11px] text-emerald-300/80">nothing blocking</span>
            ) : (
              state.missing_fields.map((m) => (
                <Chip key={m} color="#fbbf24" dim className="!text-[11px]">
                  {humanize(m)}
                </Chip>
              ))
            )}
          </div>
        </div>
        <div className="shrink-0">
          <div className="label mb-1.5 text-right">services</div>
          <div className="flex gap-1.5 justify-end">
            {state.recommended_services.length === 0 ? (
              <span className="mono text-[11px] text-white/30">--</span>
            ) : (
              state.recommended_services.map((svc) => (
                <Chip key={svc} color={serviceColor(svc)} className="!text-[11px] font-semibold">
                  {svc}
                </Chip>
              ))
            )}
          </div>
        </div>
      </div>

      {state.response_plan && (
        <div className="border-t hairline pt-2">
          <div className="label mb-1">response plan {state.response_plan.cad_id ? `/ ${state.response_plan.cad_id}` : "/ prepared, not sent"}</div>
          <div className="mono text-[11px] text-white/80 leading-relaxed">
            {state.response_plan.units.map((u, i) => (
              <div key={u.unit_id} className={i === 0 ? "text-white/95" : "text-white/45"}>
                <span style={{ color: serviceColor(u.service) }}>{u.unit_id}</span> {u.type} / {u.station.replace(/^Station \d+ - /, "")} / ETA {u.eta_minutes} min ({u.distance_km} km)
              </div>
            ))}
          </div>
        </div>
      )}

      {state.summary && <div className="mono text-[10.5px] text-white/45 leading-relaxed border-t hairline pt-2">{state.summary}</div>}
    </Panel>
  );
}
