'use client';

import { motion } from 'framer-motion';
import { useMemo } from 'react';

import {
  BLOCK,
  BUILDINGS,
  HALF,
  LANDMARKS,
  METRES_PER_UNIT,
  STREET_LINES,
  pathLength,
  pointAt,
  type Landmark,
} from '@/lib/cityLayout';
import { COLOR, PRIORITY_COLOR, withAlpha } from '@/lib/tokens';
import { useAuraStore, useResponderMayMove, useRouteVisible } from '@/state/auraStore';
import type { Vec2 } from '@/types/events';

/* The tallest buildings carry the skyline; drawing every lot would be mud. */
const SKYLINE = [...BUILDINGS].sort((a, b) => b.h - a.h).slice(0, 180);
const TALLEST = SKYLINE.length > 0 ? SKYLINE[0].h : 1;

const LANDMARK_COLOR: Record<Landmark['kind'], string> = {
  hospital: COLOR.cyan,
  fire_station: COLOR.amber,
  police: COLOR.violet,
  ems_post: COLOR.cyan,
};

function polyline(points: Vec2[]): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(' ');
}

/** The prefix of `path` already covered at normalized progress `t`. */
function travelled(path: Vec2[], t: number): Vec2[] {
  if (path.length < 2 || t <= 0) return [];
  const total = pathLength(path);
  if (total === 0) return [];
  const target = total * Math.min(1, t);
  const out: Vec2[] = [path[0]];
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (walked + seg >= target) {
      out.push(pointAt(path, t));
      return out;
    }
    walked += seg;
    out.push(path[i]);
  }
  return out;
}

function LandmarkMark({ mark }: { mark: Landmark }) {
  const color = LANDMARK_COLOR[mark.kind];
  return (
    <g transform={`translate(${mark.x} ${mark.z})`}>
      {mark.kind === 'hospital' && (
        <g fill={color}>
          <rect x={-1.6} y={-0.45} width={3.2} height={0.9} />
          <rect x={-0.45} y={-1.6} width={0.9} height={3.2} />
        </g>
      )}
      {mark.kind === 'fire_station' && <path d="M0,-1.8 L1.7,1.3 L-1.7,1.3 Z" fill={color} />}
      {mark.kind === 'police' && <path d="M0,-1.8 L1.8,0 L0,1.8 L-1.8,0 Z" fill={color} />}
      {mark.kind === 'ems_post' && (
        <circle r={1.5} fill="none" stroke={color} strokeWidth={0.7} />
      )}
      <text
        x={0}
        y={4.2}
        fontSize={2.1}
        textAnchor="middle"
        fill={withAlpha(color, 0.72)}
        style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}
      >
        {mark.label}
      </text>
    </g>
  );
}

/**
 * The 2D city.
 *
 * Not an apology screen: the same geometry the 3D scene uses, drawn top-down, with
 * the live incident, its confidence radius, the proposed route and — only once a
 * human has approved — the moving responder. World XZ maps straight onto SVG x/y.
 */
export function CityFallback() {
  // Both flags are honoured. `degraded` is raised by this component's own mount
  // path and by the perf governor, and the looping ping is the one thing that
  // yields: the crosshair, ring and uncertainty disc still mark the incident.
  const reduced = useAuraStore((s) => s.reducedMotion || s.degraded);

  const priority = useAuraStore((s) => s.incident?.priority ?? 'unknown');
  const address = useAuraStore((s) => s.location?.address ?? '');
  const confidence = useAuraStore((s) => s.location?.confidence ?? 0);
  const verified = useAuraStore((s) => s.location?.verified ?? false);
  const incidentPoint = useAuraStore((s) => {
    if (s.location) return s.location.coords;
    const call = s.activeCallId ? s.calls[s.activeCallId] : null;
    return call?.coords ?? null;
  });

  const routePath = useAuraStore((s) => s.route?.path ?? null);
  const progress = useAuraStore((s) => s.dispatchProgress);
  const units = useAuraStore((s) => s.units);

  const routeVisible = useRouteVisible();
  // The one gate: approved is the only state in which anything here may move or go green.
  const mayMove = useResponderMayMove();

  const accent = PRIORITY_COLOR[priority];
  const routeColor = mayMove ? COLOR.green : COLOR.violet;

  const done = useMemo(
    () => (routePath && mayMove ? travelled(routePath, progress) : []),
    [routePath, mayMove, progress],
  );
  const responder = useMemo(
    () => (routePath && mayMove ? pointAt(routePath, progress) : null),
    [routePath, mayMove, progress],
  );

  // Low confidence reads as a wide uncertainty disc; a verified address collapses it.
  const uncertainty = 2.4 + (1 - Math.max(0, Math.min(1, confidence))) * 16;

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox="-65 -65 130 130"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label={`Top-down city grid${address ? `, incident at ${address}` : ''}`}
      >
        <defs>
          <radialGradient id="aura-fallback-ground" cx="50%" cy="46%" r="62%">
            <stop offset="0%" stopColor="#0a1830" stopOpacity="0.95" />
            <stop offset="62%" stopColor="#050b1a" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#02040a" stopOpacity="1" />
          </radialGradient>
        </defs>

        <rect x={-65} y={-65} width={130} height={130} fill="url(#aura-fallback-ground)" />

        {/* street grid */}
        <g stroke={withAlpha(COLOR.edge, 0.7)} strokeWidth={0.32}>
          {STREET_LINES.map((v) => (
            <line key={`ns-${v}`} x1={v} y1={-HALF} x2={v} y2={HALF} />
          ))}
          {STREET_LINES.map((v) => (
            <line key={`ew-${v}`} x1={-HALF} y1={v} x2={HALF} y2={v} />
          ))}
        </g>

        {/* skyline footprints, dimmed by height */}
        <g>
          {SKYLINE.map((b, i) => (
            <rect
              key={i}
              x={b.x - b.w / 2}
              y={b.z - b.d / 2}
              width={b.w}
              height={b.d}
              fill={withAlpha(COLOR.edge, 0.2 + (b.h / TALLEST) * 0.5)}
            />
          ))}
        </g>

        {LANDMARKS.map((m) => (
          <LandmarkMark key={m.id} mark={m} />
        ))}

        {/* idle units — context for who could be sent */}
        {units.map((u) =>
          u.selected ? null : (
            <rect
              key={u.id}
              x={u.coords.x - 1}
              y={u.coords.z - 1}
              width={2}
              height={2}
              fill="none"
              stroke={withAlpha(COLOR.muted, 0.75)}
              strokeWidth={0.4}
            />
          ),
        )}

        {/* proposed route — drawn at 'proposed', but nothing on it moves yet */}
        {routeVisible && routePath && (
          <polyline
            points={polyline(routePath)}
            fill="none"
            stroke={withAlpha(routeColor, 0.75)}
            strokeWidth={0.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={mayMove ? undefined : '2.6 2.2'}
          />
        )}

        {/* covered ground — only ever non-empty once approval has been granted */}
        {done.length > 1 && (
          <polyline
            points={polyline(done)}
            fill="none"
            stroke={COLOR.green}
            strokeWidth={1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {incidentPoint && (
          <g transform={`translate(${incidentPoint.x} ${incidentPoint.z})`}>
            <circle
              r={uncertainty}
              fill={withAlpha(accent, 0.05)}
              stroke={withAlpha(accent, verified ? 0.5 : 0.3)}
              strokeWidth={0.35}
              strokeDasharray={verified ? undefined : '1.4 1.6'}
            />
            {!reduced && (
              <motion.circle
                r={2}
                fill="none"
                stroke={accent}
                strokeWidth={0.5}
                initial={{ scale: 0.6, opacity: 0.8 }}
                animate={{ scale: [0.6, 3.6], opacity: [0.8, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              />
            )}
            <circle r={3} fill="none" stroke={withAlpha(accent, 0.85)} strokeWidth={0.5} />
            <circle r={1.1} fill={accent} />
            <g stroke={withAlpha(accent, 0.9)} strokeWidth={0.4}>
              <line x1={-5} y1={0} x2={-3.6} y2={0} />
              <line x1={3.6} y1={0} x2={5} y2={0} />
              <line x1={0} y1={-5} x2={0} y2={-3.6} />
              <line x1={0} y1={3.6} x2={0} y2={5} />
            </g>
          </g>
        )}

        {mayMove && responder && (
          <g transform={`translate(${responder.x} ${responder.z})`}>
            <circle r={2.8} fill={withAlpha(COLOR.green, 0.16)} />
            <circle r={2} fill="none" stroke={COLOR.green} strokeWidth={0.45} />
            <circle r={0.9} fill={COLOR.green} />
          </g>
        )}

        {/* Scale and orientation. Parked top-centre: the SVG is letterboxed to the
            viewport height, so the corners of the viewBox sit behind the side panels
            and the bottom rail — only this band is reliably open. */}
        <g transform={`translate(0 ${-HALF + 26})`} stroke={withAlpha(COLOR.muted, 0.8)}>
          <line x1={-BLOCK / 2} y1={0} x2={BLOCK / 2} y2={0} strokeWidth={0.4} />
          <line x1={-BLOCK / 2} y1={-1.2} x2={-BLOCK / 2} y2={1.2} strokeWidth={0.4} />
          <line x1={BLOCK / 2} y1={-1.2} x2={BLOCK / 2} y2={1.2} strokeWidth={0.4} />
          <text
            x={0}
            y={-2.2}
            fontSize={2.1}
            textAnchor="middle"
            stroke="none"
            fill={withAlpha(COLOR.muted, 0.95)}
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {BLOCK * METRES_PER_UNIT} m
          </text>
          <g transform="translate(24 0)" stroke="none">
            <path d="M0,-3.4 L1.4,0.6 L0,-0.3 L-1.4,0.6 Z" fill={withAlpha(COLOR.muted, 0.9)} />
            <text
              x={0}
              y={3.6}
              fontSize={2.3}
              textAnchor="middle"
              fill={withAlpha(COLOR.muted, 0.95)}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              N
            </text>
          </g>
        </g>
      </svg>

      {/* Crisp DOM text rather than scaled SVG glyphs, shadowed so it holds over the
          grid as well as over the fog. */}
      <div className="pointer-events-none absolute left-1/2 top-[70px] -translate-x-1/2 text-center">
        <div
          className="aura-label"
          style={{ color: withAlpha(COLOR.text, 0.7), textShadow: '0 1px 6px rgba(2,4,10,0.95)' }}
        >
          Grid view · 2D geometry
        </div>
        {address && (
          <div
            className="aura-mono mt-1"
            style={{
              fontSize: 11,
              color: withAlpha(accent, 0.95),
              textShadow: '0 1px 6px rgba(2,4,10,0.95)',
            }}
          >
            {address}
          </div>
        )}
      </div>
    </div>
  );
}
