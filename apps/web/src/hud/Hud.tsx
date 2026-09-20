import { ApprovalGate } from "./ApprovalGate.tsx";
import { AudioDeck } from "./AudioDeck.tsx";
import { CallRoster } from "./CallRoster.tsx";
import { EventTicker } from "./EventTicker.tsx";
import { IncidentCard } from "./IncidentCard.tsx";
import { ProtocolTree } from "./ProtocolTree.tsx";
import { ToolLog } from "./ToolLog.tsx";
import { TopBar } from "./TopBar.tsx";
import { TranscriptFeed } from "./TranscriptFeed.tsx";

export function Hud() {
  return (
    <div className="absolute inset-0 pointer-events-none grid" style={{ gridTemplateColumns: "384px minmax(0, 1fr) 412px", gridTemplateRows: "56px minmax(0, 1fr) 150px" }}>
      <div className="col-span-3 pointer-events-auto">
        <TopBar />
      </div>

      <div className="row-span-2 flex flex-col gap-2 p-2 min-h-0">
        <CallRoster />
        <IncidentCard />
        <ProtocolTree />
      </div>

      <div className="relative min-h-0">
        <EventTicker />
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <ApprovalGate />
        </div>
      </div>

      <div className="row-span-2 flex flex-col gap-2 p-2 min-h-0">
        <TranscriptFeed />
        <ToolLog />
      </div>

      <div className="flex items-end justify-center pb-3">
        <AudioDeck />
      </div>
    </div>
  );
}
