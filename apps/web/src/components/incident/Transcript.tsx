"use client";

// The hero of the incident column. Radio log / court transcript — never chat bubbles.
// Caller sits flush left in cyan; AURA is indented behind a violet rule. Partials update in
// place with a live cursor; an interrupted AURA line must read as cut off (demo beat 7).
import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { useReducedMotion } from "motion/react";
import { SectionHeader, cx } from "@/components/ui";
import { useAura, type TranscriptLine } from "@/state/auraStore";
import { clock } from "@/state/selectors";

const UNCERTAIN = 0.75;
const STICK_PX = 56;

export default function Transcript({ lines, className }: { lines: TranscriptLine[]; className?: string }) {
  const low = useAura((s) => s.quality === "low");
  const reduced = useReducedMotion();
  const still = low || reduced === true;

  const box = useRef<HTMLDivElement | null>(null);
  // Only follow the newest line if the reader is already at the bottom — never yank them back.
  const stick = useRef(true);

  const onScroll = useCallback(() => {
    const el = box.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section className={cx("flex min-h-0 flex-col", className)} aria-label="Transcript">
      <SectionHeader label="Transcript" />
      <div
        ref={box}
        onScroll={onScroll}
        className="scroll-quiet pointer-events-auto min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-3 pr-1"
      >
        {lines.length === 0 ? (
          <p className="text-[14px] text-ink-3">No speech yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {lines.map((line) => (
              <Line key={line.id} line={line} still={still} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Line({ line, still }: { line: TranscriptLine; still: boolean }) {
  const caller = line.speaker === "caller";
  const color = caller ? "var(--color-listen)" : "var(--color-reason)";
  const conf = line.confidence;
  const uncertain = line.final && conf !== null && conf < UNCERTAIN;

  const textStyle: CSSProperties | undefined = uncertain
    ? {
        textDecorationLine: "underline",
        textDecorationStyle: "dotted",
        textDecorationColor: "var(--color-ink-3)",
        textUnderlineOffset: "4px",
      }
    : undefined;

  return (
    <li
      className={cx("flex flex-col gap-1", !caller && "border-l pl-3")}
      style={!caller ? { borderColor: "color-mix(in srgb, var(--color-reason) 30%, transparent)" } : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="label-mono" style={{ color }}>
          {caller ? "Caller" : "AURA"}
        </span>
        <span className="data-mono text-[10px] text-ink-3">{clock(line.at)}</span>
        {line.interrupted && (
          <span className="label-mono" style={{ color: "var(--color-listen)" }}>
            Interrupted
          </span>
        )}
        {conf !== null && conf < UNCERTAIN && line.final && (
          <span className="data-mono ml-auto text-[10px] text-ink-3">heard {conf.toFixed(2)}</span>
        )}
      </div>

      <p className="text-[15px] leading-[1.45] break-words">
        <span
          className={cx(
            line.interrupted ? "text-ink-3 line-through" : line.final ? "text-ink" : "text-ink-2",
          )}
          style={line.interrupted ? undefined : textStyle}
        >
          {line.text}
        </span>
        {line.interrupted && (
          <span
            aria-hidden
            className="ml-1.5 inline-block h-[0.9em] w-[2px] translate-y-[2px]"
            style={{ background: "var(--color-listen)" }}
          />
        )}
        {!line.final && (
          <span
            aria-hidden
            className={cx("ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[2px]", !still && "animate-blink")}
            style={{ background: color }}
          />
        )}
      </p>
    </li>
  );
}
