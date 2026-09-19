"use client";

// Incident intelligence — the densest column in the console (DESIGN.md §5).
// Order: priority + protocol → location ring → facts → protocol reasoning → transcript (hero).
// Nothing here may cover the transcript or the priority.
import FactGrid from "@/components/incident/FactGrid";
import LocationRing from "@/components/incident/LocationRing";
import Transcript from "@/components/incident/Transcript";
import ProtocolFlow from "@/components/protocol/ProtocolFlow";
import { Glyph, PriorityTag, SectionHeader } from "@/components/ui";
import { priorityColor } from "@/lib/palette";
import { humanize, useActiveCall } from "@/state/selectors";

export default function IncidentPanel() {
  const call = useActiveCall();

  if (!call) {
    return (
      <div className="flex h-full flex-col">
        <SectionHeader label="Incident" />
        <p className="pt-3 text-[14px] text-ink-3">No call on this console.</p>
      </div>
    );
  }

  const incident = call.incident;
  const protocol = incident?.protocol ?? null;
  const step = protocol && protocol.step ? humanize(protocol.step) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 1 — the one loud display moment in the product */}
      <header className="hairline-b shrink-0 pb-2.5">
        <PriorityTag priority={call.priority} size="lg" />
        <div className="mt-1.5 flex items-center gap-2">
          <Glyph name={call.category} size={13} className="shrink-0 text-ink-3" />
          <span className="data-mono shrink-0 text-ink">{protocol ? protocol.id : "No protocol"}</span>
          {step && (
            <>
              <span className="data-mono shrink-0 text-ink-3">·</span>
              <span className="data-mono min-w-0 truncate text-ink-3">{step}</span>
            </>
          )}
        </div>
      </header>

      {/* 2 — location confidence as a ring, and the address it resolved to */}
      <LocationRing location={incident?.location ?? null} />

      {/* 3 — what is known, what is hazardous, what is still missing */}
      <FactGrid incident={incident} />

      {/* 4 — which protocol step we are on and why it changed */}
      <ProtocolFlow
        history={call.protocolHistory}
        protocol={protocol}
        tone={priorityColor[call.priority]}
        live={call.status === "active"}
      />

      {/* 5 — the hero: takes the remaining height and scrolls */}
      <Transcript lines={call.transcript} className="flex-1" />
    </div>
  );
}
