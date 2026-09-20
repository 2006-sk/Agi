import type { CSSProperties, ReactNode } from "react";

interface PanelProps {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  critical?: boolean;
  style?: CSSProperties;
}

export function Panel({ title, right, children, className = "", bodyClassName = "p-3", critical = false, style }: PanelProps) {
  return (
    <section className={`glass ${critical ? "glass-critical" : ""} flex flex-col min-h-0 pointer-events-auto ${className}`} style={style}>
      {title !== undefined && (
        <header className="flex items-center justify-between px-3 h-8 border-b hairline shrink-0">
          <span className="label">{title}</span>
          {right}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

interface ChipProps {
  children: ReactNode;
  color?: string;
  dim?: boolean;
  className?: string;
  title?: string;
}

export function Chip({ children, color = "#9ca3af", dim = false, className = "", title }: ChipProps) {
  return (
    <span
      title={title}
      className={`mono inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-[2px] text-[10px] tracking-[0.08em] whitespace-nowrap ${className}`}
      style={{
        color: dim ? `${color}99` : color,
        borderColor: dim ? `${color}33` : `${color}66`,
        background: dim ? "transparent" : `${color}14`,
      }}
    >
      {children}
    </span>
  );
}

interface DotProps {
  color: string;
  pulse?: boolean;
  size?: number;
}

export function Dot({ color, pulse = false, size = 8 }: DotProps) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {pulse && <span className="absolute inset-0 rounded-full animate-ping opacity-60" style={{ background: color }} />}
      <span className="relative rounded-full w-full h-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
    </span>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  className?: string;
}

export function Stat({ label, value, className = "" }: StatProps) {
  return (
    <div className={`flex flex-col gap-0.5 min-w-0 ${className}`}>
      <span className="label">{label}</span>
      <span className="mono text-[12px] text-white/90 truncate">{value}</span>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

interface ArcProps {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}

export function Arc({ value, size = 56, stroke = 4, color = "#22d3ee", children }: ArcProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, value)));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1), stroke 400ms", filter: `drop-shadow(0 0 6px ${color}88)` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
