'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';

import { ConfidenceRing } from '@/components/ui/ConfidenceRing';
import { Elapsed } from '@/components/ui/Elapsed';
import { FactChip } from '@/components/ui/FactChip';
import { Panel } from '@/components/ui/Panel';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { useSignalPulse } from '@/hooks/useSignal';
import {
  COLOR,
  DURATION,
  EASE,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  withAlpha,
} from '@/lib/tokens';
import {
  useAuraStore,
  useConfirmedFacts,
  type TranscriptLine,
} from '@/state/auraStore';
import { priorityRank } from '@/types/events';

/** Either flag collapses motion to a still, still-readable state. */
function useStill(): boolean {
  return useAuraStore((s) => s.reducedMotion || s.degraded);
}

/** Sawtooth used as the cut edge on an interrupted AURA line. */
const TORN_EDGE = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 16; i++) pts.push(`${i % 2 === 0 ? 0 : 100}% ${(i / 16) * 100}%`);
  return `polygon(${pts.join(', ')})`;
})();

export function IncidentPanel() {
  const still = useStill();
  const priority = useAuraStore((s) => s.incident?.priority ?? 'unknown');
  // Primitives only: the active call object is rewritten at 20Hz by audio.level.
  const startedAtMs = useAuraStore((s) =>
    s.activeCallId ? (s.calls[s.activeCallId]?.startedAtMs ?? null) : null,
  );
  const ended = useAuraStore((s) =>
    s.activeCallId ? s.calls[s.activeCallId]?.status === 'ended' : false,
  );

  return (
    <MotionConfig reducedMotion={still ? 'always' : 'user'}>
      <Panel
        label="Incident"
        accent={PRIORITY_COLOR[priority]}
        className="h-full min-h-0"
        scanlines
        trailing={
          startedAtMs === null ? (
            <span className="aura-label">standby</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="aura-label">{ended ? 'ended' : 'on call'}</span>
              <Elapsed
                since={startedAtMs}
                frozen={ended}
                style={{ fontSize: 11, color: ended ? COLOR.muted : COLOR.text }}
              />
            </span>
          )
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 pt-2.5 pb-3">
          <IncidentHeader />
          <LocationBlock />
          <FactsBlock />
          <TranscriptBlock />
        </div>
      </Panel>
    </MotionConfig>
  );
}

/* ------------------------------------------------------------------ */
/* 1 — header: priority, id, reason                                    */
/* ------------------------------------------------------------------ */

function IncidentHeader() {
  const still = useStill();
  const classified = useAuraStore((s) => s.incident !== null);
  const id = useAuraStore((s) => s.incident?.id ?? '');
  const category = useAuraStore((s) => s.incident?.category ?? 'unknown');
  const priority = useAuraStore((s) => s.incident?.priority ?? 'unknown');
  const previous = useAuraStore((s) => s.incident?.previousPriority ?? null);
  const reason = useAuraStore((s) => s.incident?.reason ?? '');
  const flare = useSignalPulse('critical', 900);

  const color = PRIORITY_COLOR[priority];
  const escalated = previous !== null && priorityRank(priority) > priorityRank(previous);

  return (
    <motion.header
      className="relative shrink-0 overflow-hidden rounded-xl px-3 py-2.5"
      style={{ borderWidth: 1, borderStyle: classified ? 'solid' : 'dashed' }}
      animate={{
        borderColor: withAlpha(color, classified ? 0.36 : 0.2),
        backgroundColor: withAlpha(color, classified ? 0.06 : 0.02),
        boxShadow: `inset 0 0 26px ${withAlpha(color, classified ? 0.12 : 0.03)}`,
      }}
      transition={{ duration: still ? 0 : DURATION.slow, ease: EASE.out }}
    >
      <AnimatePresence>
        {flare && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : DURATION.fast, ease: EASE.snap }}
            style={{
              background: `radial-gradient(120% 150% at 50% 0%, ${withAlpha(COLOR.red, 0.5)} 0%, ${withAlpha(COLOR.red, 0.12)} 45%, transparent 75%)`,
              mixBlendMode: 'screen',
            }}
          />
        )}
      </AnimatePresence>

      <div className="relative flex h-[26px] items-center">
        <AnimatePresence initial={false}>
          <motion.span
            key={`${priority}:${category}`}
            className="absolute inset-y-0 left-0 flex items-center"
            initial={{ opacity: 0, y: -5, filter: 'blur(5px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 5, filter: 'blur(5px)' }}
            transition={{ duration: still ? 0 : DURATION.base, ease: EASE.out }}
          >
            <PriorityBadge
              priority={priority}
              category={category}
              pulse={priority === 'critical' && !still}
            />
          </motion.span>
        </AnimatePresence>

        {escalated && previous && (
          <motion.span
            className="ml-auto flex items-center gap-1"
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: still ? 0 : DURATION.base, ease: EASE.out, delay: still ? 0 : 0.12 }}
          >
            <span className="aura-label" style={{ color: withAlpha(color, 0.75) }}>
              re-ranked
            </span>
            <span
              className="aura-label"
              style={{
                color: withAlpha(PRIORITY_COLOR[previous], 0.55),
                textDecoration: 'line-through',
              }}
            >
              {PRIORITY_LABEL[previous]}
            </span>
          </motion.span>
        )}
      </div>

      <div className="relative mt-1.5 flex items-baseline gap-2">
        <span
          className="aura-mono shrink-0"
          style={{ fontSize: 11.5, color: classified ? COLOR.text : withAlpha(COLOR.muted, 0.7) }}
        >
          {classified ? id : '— — — —'}
        </span>
        <span className="aura-rule flex-1" style={{ opacity: 0.5 }} />
      </div>

      <p
        className="relative mt-1 text-[11.5px] leading-snug"
        style={{ color: classified ? withAlpha(COLOR.text, 0.72) : withAlpha(COLOR.muted, 0.7) }}
      >
        {classified ? reason || 'No reason given' : 'Awaiting classification'}
      </p>
    </motion.header>
  );
}

/* ------------------------------------------------------------------ */
/* 2 — location: confidence as a ring, lock-in as a drawn bracket      */
/* ------------------------------------------------------------------ */

function LocationBlock() {
  const still = useStill();
  const has = useAuraStore((s) => s.location !== null);
  const address = useAuraStore((s) => s.location?.address ?? '');
  const confidence = useAuraStore((s) => s.location?.confidence ?? 0);
  const verified = useAuraStore((s) => s.location?.verified ?? false);
  const locked = useSignalPulse('locationLocked', 1100);

  if (!has) {
    return (
      <section
        className="flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5"
        style={{
          border: `1px dashed ${withAlpha(COLOR.muted, 0.26)}`,
          background: 'rgba(3, 8, 20, 0.45)',
        }}
      >
        <span
          className="size-[46px] shrink-0 rounded-full"
          style={{ border: `1px dashed ${withAlpha(COLOR.muted, 0.32)}` }}
          aria-hidden
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="aura-label">location</span>
          <span className="aura-mono" style={{ fontSize: 12, color: withAlpha(COLOR.muted, 0.7) }}>
            NO FIX
          </span>
        </span>
      </section>
    );
  }

  const color = verified ? COLOR.green : COLOR.cyan;

  return (
    <motion.section
      className="relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5"
      style={{ borderWidth: 1, borderStyle: verified ? 'solid' : 'dashed' }}
      animate={{
        borderColor: withAlpha(color, verified ? 0.34 : 0.22),
        backgroundColor: withAlpha(color, verified ? 0.05 : 0.02),
      }}
      transition={{ duration: still ? 0 : DURATION.base, ease: EASE.out }}
    >
      <AnimatePresence>
        {locked && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.9, ease: EASE.out }}
            style={{
              background: `linear-gradient(90deg, ${withAlpha(COLOR.green, 0.28)}, transparent 70%)`,
              mixBlendMode: 'screen',
            }}
          />
        )}
      </AnimatePresence>

      <div className="relative shrink-0">
        {/* Remount on lock so the arc snaps to its final value instead of easing. */}
        <ConfidenceRing
          key={verified ? 'verified' : 'provisional'}
          value={confidence}
          color={color}
          label="conf"
          pulse={!verified && !still}
        />
        {verified && (
          <svg
            className="pointer-events-none absolute"
            width={62}
            height={62}
            viewBox="0 0 62 62"
            style={{ left: -8, top: -8 }}
            aria-hidden
          >
            {['M6 18 V6 H18', 'M44 56 H56 V44'].map((d, i) => (
              <motion.path
                key={d}
                d={d}
                fill="none"
                stroke={COLOR.green}
                strokeWidth={1.4}
                strokeLinecap="square"
                initial={{ pathLength: still ? 1 : 0, opacity: still ? 1 : 0 }}
                animate={{ pathLength: 1, opacity: 0.9 }}
                transition={{ duration: still ? 0 : 0.34, ease: EASE.out, delay: still ? 0 : i * 0.06 }}
              />
            ))}
            <motion.path
              d="M50 8.5 l2.6 2.8 l5.2 -6"
              fill="none"
              stroke={COLOR.green}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: still ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: still ? 0 : 0.3, ease: EASE.out, delay: still ? 0 : 0.18 }}
              style={{ filter: `drop-shadow(0 0 5px ${COLOR.green})` }}
            />
          </svg>
        )}
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="aura-label">location</span>
          <span
            className={`aura-label ${verified || still ? '' : 'aura-breathe'}`}
            style={{ color: withAlpha(color, 0.9) }}
          >
            {verified ? 'verified' : 'locating'}
          </span>
        </span>
        <span
          className="aura-mono truncate"
          style={{ fontSize: 12.5, color: verified ? COLOR.text : withAlpha(COLOR.text, 0.72) }}
          title={address}
        >
          {address || 'Unresolved'}
        </span>
        {!verified && (
          <span className="aura-label" style={{ color: withAlpha(COLOR.muted, 0.85) }}>
            provisional fix
          </span>
        )}
      </div>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* 3 — structured facts                                                */
/* ------------------------------------------------------------------ */

function FactsBlock() {
  const still = useStill();
  const facts = useConfirmedFacts();
  const critical = facts.filter((f) => f.critical);
  const confirmed = critical.filter((f) => f.state === 'confirmed').length;
  const complete = critical.length > 0 && confirmed === critical.length;

  return (
    <section className="flex shrink-0 flex-col">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="aura-label">facts</span>
        {critical.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="flex items-center gap-[3px]" aria-hidden>
              {critical.map((f) => {
                const lit = f.state === 'confirmed';
                return (
                  <motion.span
                    key={f.key}
                    className="h-[3px] w-[9px] rounded-full"
                    animate={{
                      backgroundColor: lit ? COLOR.cyan : COLOR.inert,
                      boxShadow: `0 0 7px ${withAlpha(COLOR.cyan, lit ? 0.75 : 0)}`,
                    }}
                    transition={{ duration: still ? 0 : DURATION.base, ease: EASE.out }}
                  />
                );
              })}
            </span>
            <span
              className="aura-label"
              style={{ color: complete ? COLOR.cyan : COLOR.muted }}
            >
              {confirmed} of {critical.length} critical
            </span>
          </span>
        )}
      </div>

      {facts.length === 0 ? (
        <div
          className="flex items-center rounded-lg px-2.5 py-2"
          style={{
            border: `1px dashed ${withAlpha(COLOR.muted, 0.24)}`,
            background: 'rgba(3, 8, 20, 0.45)',
          }}
        >
          <span className="aura-label">no facts extracted</span>
        </div>
      ) : (
        <div className="aura-scroll flex max-h-[124px] flex-wrap content-start gap-1.5 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {facts.map((fact) => (
              <FactChip key={fact.key} fact={fact} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4 — live transcript                                                 */
/* ------------------------------------------------------------------ */

function TranscriptBlock() {
  const still = useStill();
  const transcript = useAuraStore((s) => s.transcript);

  const [interrupted, setInterrupted] = useState<string[]>([]);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // The AURA line that was mid-flight when the caller cut in stays marked. Read
  // through a subscription so the mark is taken at the instant the signal lands.
  useEffect(() => {
    let seen = useAuraStore.getState().signals.interrupt;
    return useAuraStore.subscribe((s) => {
      const count = s.signals.interrupt;
      if (count === seen) return;
      seen = count;
      if (count === 0) {
        setInterrupted((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      for (let i = s.transcript.length - 1; i >= 0; i--) {
        if (s.transcript[i].speaker !== 'aura') continue;
        const id = s.transcript[i].id;
        setInterrupted((prev) => (prev.includes(id) ? prev : [...prev, id]));
        return;
      }
    });
  }, []);

  // Follow the newest line only while the operator is already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    atBottom.current = bottom;
    setShowJump((v) => (v === !bottom ? v : !bottom));
  }, []);

  const jumpToLive = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: still ? 'auto' : 'smooth' });
  }, [still]);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex shrink-0 items-center justify-between">
        <span className="aura-label">transcript</span>
        <span className="flex items-center gap-1.5">
          <span
            className={`size-[5px] rounded-full ${still ? '' : 'aura-breathe'}`}
            style={{ background: COLOR.cyan, boxShadow: `0 0 7px ${COLOR.cyan}` }}
            aria-hidden
          />
          <span className="aura-label" style={{ color: withAlpha(COLOR.cyan, 0.7) }}>
            live
          </span>
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Live call transcript"
        className="aura-scroll min-h-0 flex-1 overflow-y-auto pr-1.5"
      >
        {transcript.length === 0 ? (
          <div
            className="flex items-center rounded-lg px-2.5 py-2"
            style={{ border: `1px dashed ${withAlpha(COLOR.muted, 0.22)}` }}
          >
            <span className="aura-label">no audio yet</span>
          </div>
        ) : (
          <ol className="flex flex-col gap-2 pb-1">
            {transcript.map((line) => (
              <TranscriptRow
                key={line.id}
                line={line}
                cut={interrupted.includes(line.id)}
                still={still}
              />
            ))}
          </ol>
        )}
      </div>

      <AnimatePresence>
        {showJump && (
          <motion.button
            type="button"
            onClick={jumpToLive}
            className="aura-label absolute bottom-1 left-1/2 rounded-full px-2.5 py-1"
            style={{
              x: '-50%',
              color: COLOR.cyan,
              border: `1px solid ${withAlpha(COLOR.cyan, 0.4)}`,
              background: 'rgba(3, 8, 20, 0.92)',
              boxShadow: `0 0 16px ${withAlpha(COLOR.cyan, 0.22)}`,
            }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: still ? 0 : DURATION.fast, ease: EASE.out }}
          >
            jump to live ↓
          </motion.button>
        )}
      </AnimatePresence>
    </section>
  );
}

function TranscriptRow({
  line,
  cut,
  still,
}: {
  line: TranscriptLine;
  cut: boolean;
  still: boolean;
}) {
  const aura = line.speaker === 'aura';
  const rail = aura ? COLOR.violet : COLOR.cyan;

  return (
    <motion.li
      className={`relative ${aura ? 'ml-6 pr-2.5 pl-2.5' : 'pl-2.5'}`}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: still ? 0 : DURATION.base, ease: EASE.out }}
      style={
        aura
          ? {
              background: `linear-gradient(90deg, ${withAlpha(COLOR.violet, 0.09)}, transparent 72%)`,
              borderRadius: 6,
            }
          : undefined
      }
    >
      <span
        aria-hidden
        className="absolute top-[2px] bottom-[2px] left-0 w-[2px] rounded-full"
        style={{
          background: `linear-gradient(180deg, ${withAlpha(rail, 0.95)}, ${withAlpha(rail, 0.12)})`,
          boxShadow: `0 0 8px ${withAlpha(rail, 0.55)}`,
        }}
      />
      {cut && (
        <span
          aria-hidden
          className="absolute top-0 right-0 bottom-0 w-[3px]"
          style={{
            background: COLOR.amber,
            clipPath: TORN_EDGE,
            boxShadow: `0 0 12px ${withAlpha(COLOR.amber, 0.7)}`,
          }}
        />
      )}
      <p
        className="text-[12.5px] leading-[1.45]"
        style={{
          color: aura
            ? `color-mix(in srgb, ${COLOR.violet} 34%, ${COLOR.text})`
            : `color-mix(in srgb, ${COLOR.cyan} 34%, ${COLOR.text})`,
          fontWeight: aura ? 300 : 400,
          opacity: line.final ? 1 : 0.6,
          letterSpacing: aura ? '0.005em' : undefined,
        }}
      >
        {aura && (
          <span
            aria-hidden
            className="mr-1.5 align-[1.5px] text-[9px]"
            style={{ color: COLOR.violet, textShadow: `0 0 8px ${withAlpha(COLOR.violet, 0.8)}` }}
          >
            ◈
          </span>
        )}
        {line.text}
        <Caret visible={!line.final} color={rail} still={still} />
        {cut && (
          <span className="ml-1.5 inline-flex items-center gap-1 align-[1px]">
            <span
              className="aura-mono text-[11px]"
              style={{ color: COLOR.amber, textDecoration: 'line-through' }}
            >
              ⌁
            </span>
            <span className="aura-label" style={{ color: withAlpha(COLOR.amber, 0.85) }}>
              interrupted
            </span>
          </span>
        )}
      </p>
    </motion.li>
  );
}

/** Always mounted so a partial becoming final never shifts the last word. */
function Caret({
  visible,
  color,
  still,
}: {
  visible: boolean;
  color: string;
  still: boolean;
}) {
  return (
    <motion.span
      aria-hidden
      className="ml-[3px] inline-block h-[10px] w-[5px] translate-y-[1px] rounded-[1px]"
      style={{ background: color, boxShadow: `0 0 8px ${withAlpha(color, 0.8)}` }}
      animate={
        still || !visible
          ? { opacity: visible ? 0.85 : 0 }
          : { opacity: [0.9, 0.9, 0.06, 0.06, 0.9] }
      }
      transition={
        still || !visible
          ? { duration: 0 }
          : { duration: 1.05, repeat: Infinity, ease: 'linear', times: [0, 0.42, 0.5, 0.92, 1] }
      }
    />
  );
}
