'use client';

import { memo } from 'react';

import { ToolRail } from '@/components/actions/ToolRail';
import { ApprovalGate } from '@/components/approval/ApprovalGate';
import { CallStack } from '@/components/calls/CallStack';
import { IncidentPanel } from '@/components/incident/IncidentPanel';
import { ProtocolFlow } from '@/components/protocol/ProtocolFlow';
import { CriticalFlash } from '@/components/shell/CriticalFlash';
import { DemoControls } from '@/components/shell/DemoControls';
import { SceneCanvas } from '@/components/shell/SceneCanvas';
import { TopBar } from '@/components/shell/TopBar';
import { useAuraFeed } from '@/hooks/useAuraFeed';

/**
 * Every panel is store-driven and takes no props, so memoising them here means the
 * feed's transport clock re-renders nothing but the transport itself.
 */
const Scene = memo(SceneCanvas);
const Header = memo(TopBar);
const Calls = memo(CallStack);
const Incident = memo(IncidentPanel);
const Protocol = memo(ProtocolFlow);
const Rail = memo(ToolRail);
const Gate = memo(ApprovalGate);
const Flash = memo(CriticalFlash);

/**
 * The deck.
 *
 * The city is the composition, not a widget: it fills the viewport and the panels
 * are instruments hung in front of it, with the middle left orbitable. Nothing
 * scrolls the page — panels scroll inside themselves — until the viewport is too
 * narrow to hold three columns, at which point the deck becomes one scrolling
 * column over the city.
 */
export function CommandDeck() {
  const feed = useAuraFeed();

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <Scene />

      {/* atmosphere — panels sit in fog rather than on a hard edge */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-28"
        style={{
          background:
            'linear-gradient(180deg, rgba(2,4,10,0.78) 0%, rgba(2,4,10,0.3) 45%, transparent 100%)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-56"
        style={{
          background:
            'linear-gradient(0deg, rgba(2,4,10,0.92) 0%, rgba(2,4,10,0.44) 46%, transparent 100%)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{
          background:
            'radial-gradient(122% 84% at 50% 44%, transparent 38%, rgba(2,4,10,0.6) 100%)',
        }}
        aria-hidden
      />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <div className="pointer-events-auto shrink-0">
          <Header />
        </div>

        <div className="aura-scroll flex min-h-0 flex-1 gap-[var(--aura-gutter)] p-[var(--aura-gutter)] max-[820px]:pointer-events-auto max-[820px]:flex-col max-[820px]:overflow-y-auto max-[820px]:pb-[104px]">
          {/* left: the call stack, clearing the transport dock below it */}
          <aside className="flex min-h-0 w-[var(--aura-panel-w)] shrink-0 flex-col pb-[104px] max-[1100px]:w-[248px] max-[820px]:w-full max-[820px]:pb-0">
            <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden max-[820px]:min-h-[320px]">
              <Calls />
            </div>
          </aside>

          {/* centre: the city stays open; only the rail is docked into it */}
          <div className="flex min-h-0 flex-1 flex-col justify-end max-[820px]:order-last max-[820px]:flex-none">
            <div className="pointer-events-auto h-[var(--aura-rail-h)] min-h-0 shrink-0 overflow-hidden">
              <Rail />
            </div>
          </div>

          <aside className="flex min-h-0 w-[var(--aura-panel-w)] shrink-0 flex-col gap-[var(--aura-gutter)] max-[1100px]:w-[248px] max-[820px]:w-full">
            <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden max-[820px]:min-h-[300px]">
              <Incident />
            </div>
            <div className="pointer-events-auto flex max-h-[38%] min-h-0 shrink-0 flex-col overflow-hidden max-[820px]:max-h-none max-[820px]:min-h-[220px]">
              <Protocol />
            </div>
          </aside>
        </div>
      </div>

      {/* the gate outranks everything, but an absent gate blocks nothing */}
      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-6 [&>*]:pointer-events-auto">
        <Gate />
      </div>

      <Flash />
      <DemoControls feed={feed} />
    </div>
  );
}
