'use client';

import { AnimatePresence, MotionConfig, motion } from 'framer-motion';

import { VoiceOrb } from '@/components/calls/VoiceOrb';
import { Elapsed } from '@/components/ui/Elapsed';
import { Panel } from '@/components/ui/Panel';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { Waveform } from '@/components/ui/Waveform';
import { useSignalPulse } from '@/hooks/useSignal';
import {
  COLOR,
  DURATION,
  EASE,
  PRIORITY_LABEL,
  SPEAKER_COLOR,
  withAlpha,
} from '@/lib/tokens';
import { useAuraStore, useOrderedCallIds } from '@/state/auraStore';

/** Stable empty reference so a missing call never returns a fresh array. */
const NO_LEVELS: number[] = [];

const CARD_TRANSITION =
  'border-color 240ms linear, box-shadow 240ms linear, background 240ms linear, opacity 240ms linear';

export function CallStack() {
  const ids = useOrderedCallIds();
  const still = useAuraStore((s) => s.reducedMotion || s.degraded);

  const liveCount = useAuraStore((s) =>
    s.callIds.reduce((n, id) => n + (s.calls[id]?.status === 'live' ? 1 : 0), 0),
  );
  const anyCritical = useAuraStore((s) =>
    s.callIds.some((id) => {
      const c = s.calls[id];
      return !!c && c.status === 'live' && c.priority === 'critical';
    }),
  );

  // Watched here rather than in the card: a card that mounts on arrival was not
  // around to see its own counter advance, but the stack was.
  const arriving = useSignalPulse('callArrived', 620);
  const newestId = useAuraStore((s) => s.callIds[s.callIds.length - 1] ?? null);

  const accent = anyCritical ? COLOR.red : COLOR.cyan;

  return (
    <Panel
      label="LIVE CALLS"
      accent={accent}
      className="h-full min-h-0"
      trailing={
        <span className="flex items-center gap-1.5">
          <span
            className={`size-[5px] rounded-full ${still || liveCount === 0 ? '' : 'aura-breathe'}`}
            style={{
              background: liveCount > 0 ? accent : COLOR.inert,
              boxShadow: liveCount > 0 ? `0 0 8px ${accent}` : 'none',
            }}
            aria-hidden
          />
          <span
            className="aura-mono"
            style={{
              fontSize: 9.5,
              letterSpacing: '0.18em',
              color: liveCount > 0 ? accent : COLOR.muted,
            }}
          >
            {liveCount} LIVE
          </span>
        </span>
      }
    >
      {ids.length === 0 ? (
        <IdleState still={still} />
      ) : (
        <MotionConfig reducedMotion={still ? 'always' : 'never'}>
          <motion.ul
            layoutScroll
            className="aura-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2.5 py-2.5"
          >
            <AnimatePresence>
              {ids.map((id) => (
                <CallCard
                  key={id}
                  id={id}
                  still={still}
                  landing={!still && arriving && id === newestId}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        </MotionConfig>
      )}
    </Panel>
  );
}

function CallCard({
  id,
  still,
  landing,
}: {
  id: string;
  still: boolean;
  landing: boolean;
}) {
  const number = useAuraStore((s) => s.calls[id]?.number ?? '');
  const hint = useAuraStore((s) => s.calls[id]?.locationHint ?? '');
  const startedAtMs = useAuraStore((s) => s.calls[id]?.startedAtMs ?? 0);
  const priority = useAuraStore((s) => s.calls[id]?.priority ?? 'unknown');
  const category = useAuraStore((s) => s.calls[id]?.category ?? 'unknown');
  const speaker = useAuraStore((s) => s.calls[id]?.speaker ?? 'caller');
  const ended = useAuraStore((s) => s.calls[id]?.status === 'ended');
  // The store replaces `waveform` wholesale, so the reference is stable between events.
  const waveform = useAuraStore((s) => s.calls[id]?.waveform ?? NO_LEVELS);
  const isActive = useAuraStore((s) => s.activeCallId === id);
  const focusCall = useAuraStore((s) => s.focusCall);

  // `critical` fires for the call that owns the incident panel — only that card shocks.
  const criticalPulse = useSignalPulse('critical', 640);
  const ownsIncident = useAuraStore((s) => s.incident?.callId === id);
  const shock = !still && criticalPulse && ownsIncident && priority === 'critical';

  const speakerColor = SPEAKER_COLOR[speaker];
  const railColor = priority === 'critical' ? COLOR.red : speakerColor;

  return (
    <motion.li
      layout
      className="relative mb-2 list-none overflow-hidden last:mb-0"
      initial={{ opacity: 0, x: -26 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{
        opacity: 0,
        height: 0,
        marginBottom: 0,
        transition: { duration: DURATION.base, ease: EASE.snap },
      }}
      transition={{
        duration: DURATION.base,
        ease: EASE.out,
        layout: { duration: 0.42, ease: EASE.out },
      }}
    >
      {/* Critical shockwave, behind the card. Gone inside ~640ms. */}
      {shock && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 rounded-[13px]"
          initial={{ opacity: 0.95, scale: 0.7 }}
          animate={{ opacity: 0, scale: 1.1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{
            border: `1.5px solid ${COLOR.red}`,
            background: `radial-gradient(55% 130% at 12% 50%, ${withAlpha(COLOR.red, 0.45)}, transparent 72%)`,
            boxShadow: `0 0 30px ${withAlpha(COLOR.red, 0.6)}`,
          }}
        />
      )}

      <button
        type="button"
        onClick={() => focusCall(id)}
        aria-pressed={isActive}
        aria-label={`Call ${number || 'unknown number'}${hint ? `, ${hint}` : ''}, ${PRIORITY_LABEL[priority]}${ended ? ', ended' : ''}`}
        className="relative z-10 flex w-full items-start gap-2.5 rounded-[13px] py-2.5 pr-2.5 pl-3.5 text-left outline-none focus-visible:[outline:2px_solid_var(--aura-cyan)] focus-visible:[outline-offset:3px]"
        style={{
          border: isActive
            ? `1px solid ${withAlpha(railColor, 0.55)}`
            : `1px solid ${withAlpha(COLOR.cyan, 0.1)}`,
          boxShadow: isActive
            ? `0 0 24px ${withAlpha(railColor, 0.2)}, inset 0 0 30px ${withAlpha(railColor, 0.08)}`
            : 'none',
          background: `linear-gradient(118deg, ${withAlpha(railColor, isActive ? 0.13 : 0)} 0%, rgba(3, 8, 20, ${isActive ? 0.74 : 0.5}) 62%)`,
          filter: ended ? 'grayscale(1)' : undefined,
          opacity: ended ? 0.46 : 1,
          transition: CARD_TRANSITION,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full"
          style={{
            background: `linear-gradient(180deg, transparent, ${railColor} 16%, ${railColor} 84%, transparent)`,
            boxShadow: isActive
              ? `0 0 10px ${railColor}, 0 0 22px ${withAlpha(railColor, 0.55)}`
              : 'none',
            opacity: ended ? 0.22 : isActive ? 1 : priority === 'critical' ? 0.8 : 0.26,
          }}
        />

        <VoiceOrb callId={id} size={40} className="mt-[3px]" />

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span
              className="aura-mono truncate"
              style={{ fontSize: 12.5, color: ended ? COLOR.muted : COLOR.text }}
            >
              {number || 'UNKNOWN'}
            </span>
            <Elapsed
              since={startedAtMs}
              frozen={ended}
              className="ml-auto shrink-0"
              style={{
                fontSize: 10.5,
                color: ended ? COLOR.muted : withAlpha(railColor, 0.92),
              }}
            />
          </span>

          <span
            className="truncate leading-tight"
            style={{
              fontSize: 10.5,
              color: 'var(--aura-text-dim)',
              opacity: hint ? 0.7 : 0.42,
            }}
          >
            {hint || 'location unresolved'}
          </span>

          <Waveform
            levels={waveform}
            color={speakerColor}
            width={148}
            height={18}
            bars={26}
            active={!ended}
          />

          <span className="flex items-center gap-2 pt-px">
            <PriorityBadge
              priority={priority}
              category={category}
              size="sm"
              pulse={!still && !ended && priority === 'critical'}
            />
            {ended && (
              <span className="aura-label" style={{ fontSize: 8 }}>
                ended
              </span>
            )}
          </span>
        </span>
      </button>

      {/* Hard red border flare — instant, not transitioned, so the reclassification
          registers as a snap rather than a fade. */}
      {shock && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 rounded-[13px]"
          style={{
            border: `1.5px solid ${COLOR.red}`,
            boxShadow: `0 0 0 1px ${withAlpha(COLOR.red, 0.75)}, 0 0 32px ${withAlpha(COLOR.red, 0.5)}, inset 0 0 28px ${withAlpha(COLOR.red, 0.2)}`,
          }}
        />
      )}

      {/* Landing flare — one sweep as a newly arrived call settles into the stack. */}
      {landing && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 rounded-[13px]"
          initial={{ opacity: 0.8 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: EASE.out }}
          style={{
            background: `linear-gradient(90deg, ${withAlpha(railColor, 0.34)}, transparent 64%)`,
            boxShadow: `inset 0 0 24px ${withAlpha(railColor, 0.4)}`,
          }}
        />
      )}
    </motion.li>
  );
}

function IdleState({ still }: { still: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-10">
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${still ? '' : 'aura-breathe'}`}
        style={{ background: COLOR.cyan, boxShadow: `0 0 12px ${COLOR.cyan}` }}
      />
      <span
        className={`aura-label ${still ? '' : 'aura-breathe'}`}
        style={{ letterSpacing: '0.34em', fontSize: 10 }}
      >
        Standing by
      </span>
      <span className="aura-rule w-24 shrink-0" aria-hidden />
    </div>
  );
}
