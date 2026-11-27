// The 3D river of time (React Three Fiber).
//
// What's drawn:
//   • Lanes      — one coloured line per field, following the river's meander
//   • Events     — one glowing bubble per event; ringed ones have debates you can dive into.
//                  On desktop, bubbles under the cursor swell up (a magnifier) so crowded
//                  spots are easier to read.
//   • Faint dots — events not important enough for the normal view (src/lib/importance.ts).
//                  Expand time around them and they become bubbles.
//   • Spans      — glowing ranges for uncertain and disputed dates (RiverSpans.tsx)
//   • Entities   — small diamonds where people and organisations were born or founded
//
// Clicking a bubble selects it and opens a small menu: open its claim map, or expand time
// around it. Clicking where several bubbles overlap fans them out in a labelled ring first
// (like overlapping map pins), so you can pick any one; clicking elsewhere closes the ring.
//
// Expand in place (src/lib/timeScale.ts + src/lib/cameraAnchor.ts): double-click (or
// double-tap) the river, or use a bubble's menu, to expand time around that moment:
// normal → months → days. The expanded period becomes a brighter, wider stretch of river
// with month or day ticks. The change animates over half a second, and the moment you
// chose stays exactly where it was on screen the whole time — the camera is recalculated
// every frame so nothing scrolls away or jolts.
//
// Travel: scroll, drag, swipe or the arrow keys. + / − expand and collapse around the
// moment in the middle of the screen.
//
// While a claim map is open, the main river is hidden and the canvas shows a single topic
// river instead (TopicRiver.tsx), with only the events related to the map's subject.
import { Html, Line, Stars } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { Dataset, TimelineEvent } from '../types';
import { FIELDS } from '../types';
import { FIELD_COLOR, laneOffset, riverX } from '../lib/time';
import { formatShort, formatYear } from '../lib/dates';
import { resolveEventDate, type ResolvedDate } from '../lib/dateDispute';
import { importanceMap, LOD_THRESHOLD } from '../lib/importance';
import { FAN_MAX, fanPositions, fanRadius, planKey, planScreen, type RiverPlan, type ScreenItem } from '../lib/cluster';
import { anchorPose, cameraFrame, easeOut, EXPAND_MS, LATERAL_FADE, meander, RIG, type CameraPose } from '../lib/cameraAnchor';
import {
  blendScales,
  deeper,
  makeScale,
  windowLabel,
  windowTicks,
  type ExpandLevel,
  type TimeScale,
  type TimeWindow,
} from '../lib/timeScale';
import { place, spanVisible, UncertaintySpan } from './RiverSpans';
import { HitArea, MIN_TAP_RADIUS } from './HitArea';
import { TopicScene, type TopicProps } from './TopicRiver';

/**
 * A request to change how far time is expanded. `seq` goes up by one for every request, so
 * the river knows to animate even when asked for the same period twice. `anchor` is the
 * moment that must stay still on screen; `flyTo` (optional) is where to travel afterwards.
 */
export interface Expansion {
  window: TimeWindow | null;
  anchor: number;
  flyTo?: number;
  seq: number;
}

interface Props {
  data: Dataset;
  expansion: Expansion;
  level: ExpandLevel;
  targetS: number;
  setTargetS: (s: number | ((s: number) => number)) => void;
  onYear: (y: number) => void;
  onOpenEvent: (id: string) => void;
  onOpenEntity: (id: string) => void;
  highlightId?: string;
  mobile: boolean;
  showImported: boolean;
  /** Expand time to `level` around `anchorYear` (keeping that moment still on screen). */
  onExpand: (level: ExpandLevel, anchorYear: number) => void;
  /** + / − keys: expand one level further, or collapse one level, around the middle of the screen. */
  onExpandStep: (dir: 1 | -1) => void;
  /** When set, show this topic river instead of the main river (a claim map is open). */
  topic?: TopicProps;
}

/** Years that get a big faint label beside the river (outside any expanded period). */
const TICKS = [-3000, -2000, -1000, 0, 500, 1000, 1500, 1700, 1800, 1900, 1950, 1980, 2000, 2010, 2020, 2025];

/**
 * The "focus": how far ahead of the camera the moment you're looking at sits. The HUD date,
 * expanding with + / − and "fly to" all use this point, so what's in the middle of the screen
 * is the date shown. The phone camera looks down more steeply and its footer covers the bottom
 * of the screen, so its focus is further ahead.
 */
export const FOCUS_AHEAD = { desktop: 2, mobile: 15 };

/** How far ahead you can see (matches the fog). Events further away aren't planned. */
const VIEW_DISTANCE = 95;
/** Bubbles within this many pixels of the cursor swell up (desktop only). */
const MAGNIFY_RADIUS = 90;
/** Two clicks on the water within this long (ms) and this close (px) count as a double-click. */
const DOUBLE_TAP = { ms: 350, px: 30 };

/** The cursor's position over the canvas in pixels (null when it's not over it). Shared, not state. */
type Cursor = MutableRefObject<{ x: number; y: number } | null>;

/** The water and one coloured line per field lane. The expanded period gets a brighter, wider stretch. */
function Lanes({ scale, onWaterClick }: { scale: TimeScale; onWaterClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const from = scale.sMin - 10;
  const to = scale.sMax + 30;
  // Points along the river, sideways position from the year (so expanding never shifts it).
  const { lanes, water, bright } = useMemo(() => {
    const xAt = (s: number) => meander(scale.toYear(s));
    const lanes = FIELDS.map((f) => {
      const pts: [number, number, number][] = [];
      for (let s = from; s <= to; s += 2) pts.push([xAt(s) + laneOffset(f), 0, -s]);
      return { f, pts };
    });
    const ribbon = (s0: number, s1: number, half: number, y: number, step: number) => {
      const verts: number[] = [];
      const idx: number[] = [];
      let i = 0;
      for (let s = s0; s <= s1 + 1e-6; s += step, i++) {
        const x = xAt(s);
        verts.push(x - half, y, -s, x + half, y, -s);
        if (i > 0) {
          const a = (i - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx);
      return g;
    };
    const w = scale.window;
    return {
      lanes,
      water: ribbon(from, to, 8, -0.4, 1),
      bright: w ? ribbon(scale.toS(w.start), scale.toS(w.end), 10.5, -0.38, 0.5) : null,
    };
  }, [scale, from, to]);
  useEffect(() => () => { water.dispose(); bright?.dispose(); }, [water, bright]);
  return (
    <group>
      <mesh geometry={water} onClick={onWaterClick}>
        <meshBasicMaterial color="#123063" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      {bright && (
        <mesh geometry={bright} onClick={onWaterClick}>
          <meshBasicMaterial color="#2f6bff" transparent opacity={0.32} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {lanes.map(({ f, pts }) => (
        <Line key={f} points={pts} color={FIELD_COLOR[f]} lineWidth={1.5} transparent opacity={0.55} />
      ))}
    </group>
  );
}

/** Drifting specks of light, for a sense of flow. Purely decorative, so they ignore expansion. */
function Particles() {
  const ref = useRef<THREE.Points>(null);
  const count = 1500;
  const positions = useMemo(() => {
    const base = makeScale(null);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const s = base.sMin + Math.random() * (base.sMax - base.sMin + 30);
      arr[i * 3] = riverX(s) + (Math.random() - 0.5) * 16;
      arr[i * 3 + 1] = (Math.random() - 0.3) * 3;
      arr[i * 3 + 2] = -s;
    }
    return arr;
  }, []);
  useFrame((_, dt) => {
    if (ref.current) ref.current.position.z -= dt * 0.6;
    if (ref.current && ref.current.position.z < -20) ref.current.position.z = 0;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.08} color="#9fd3ff" transparent opacity={0.6} />
    </points>
  );
}

/** Year labels beside the river; in an expanded period, month or day ticks across it and glowing edges. */
function Ticks({ scale }: { scale: TimeScale }) {
  const w = scale.window;
  const outside = TICKS.filter((y) => !w || y < w.start || y > w.end);
  const inside = windowTicks(w);
  const at = (year: number) => ({ s: scale.toS(year), x: meander(year) });
  return (
    <group>
      {outside.map((y) => {
        const { s, x } = at(y);
        return (
          <Html key={y} position={[x - 9, 0, -s]} center distanceFactor={18} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div className="tick">{formatYear(y)}</div>
          </Html>
        );
      })}
      {inside.map((t) => {
        const { s, x } = at(t.year);
        return (
          <group key={`in-${t.year}`}>
            {/* A line across the river: full width for months / every 5th day, short for other days. */}
            <Line
              points={t.major ? [[x - 9, 0.01, -s], [x + 9, 0.01, -s]] : [[x - 9, 0.01, -s], [x - 6.8, 0.01, -s]]}
              color={t.major ? '#7aa2ff' : '#4d5875'}
              lineWidth={t.major ? 1.2 : 1}
              transparent
              opacity={t.major ? 0.45 : 0.8}
            />
            <Html position={[x - 10, 0, -s]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <div className={`tick small ${t.major ? '' : 'minor'}`}>{t.label}</div>
            </Html>
          </group>
        );
      })}
      {w && [w.start, w.end].map((year, i) => {
        const { s, x } = at(year);
        return (
          <group key={`edge-${i}`}>
            <Line points={[[x - 10.5, 0.02, -s], [x + 10.5, 0.02, -s]]} color="#7aa2ff" lineWidth={2.5} transparent opacity={0.9} />
            <Html position={[x + 12, 0.2, -s]} center distanceFactor={18} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <div className="gate-label">{i === 0 ? `▶ ${windowLabel(w)}` : `${windowLabel(w)} ◀`}</div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

/**
 * One event as its own bubble. On desktop it swells as the cursor comes near, and shows
 * its label then too. Clicking it goes to the scene, which decides between fanning out a
 * stack or opening the bubble's menu.
 */
function EventNode({ ev, resolved, scale, onClick, highlighted, selected, showLabel, mobile, cursor }: {
  ev: TimelineEvent;
  resolved: ResolvedDate;
  scale: TimeScale;
  onClick: () => void;
  highlighted: boolean;
  selected: boolean;
  showLabel: boolean;
  mobile: boolean;
  cursor: Cursor;
}) {
  const [near, setNear] = useState(false);
  const group = useRef<THREE.Group>(null);
  const sphere = useRef<THREE.Mesh>(null);
  const mag = useRef(1);
  const wp = useMemo(() => new THREE.Vector3(), []);
  const debates = ev.topicIds.length;
  const hasMap = debates > 0;
  const imported = ev.provenance?.importedFrom === 'wikidata';
  const radius = hasMap ? 0.5 : imported ? 0.26 : 0.32;
  const pos = place(scale, resolved.date.best, ev.field, 0.6);

  useFrame(({ camera, size, clock }, dt) => {
    // Magnifier: bigger the closer the cursor is (screen distance), eased so it feels smooth.
    let target = 1;
    let d = Infinity;
    const c = cursor.current;
    if (c && !mobile) {
      wp.set(...pos).project(camera);
      d = Math.hypot(((wp.x + 1) / 2) * size.width - c.x, ((1 - wp.y) / 2) * size.height - c.y);
      target = 1 + 0.9 * Math.max(0, 1 - d / MAGNIFY_RADIUS);
    }
    mag.current += (target - mag.current) * Math.min(1, dt * 10);
    group.current?.scale.setScalar(mag.current);
    const isNear = d < 30;
    if (isNear !== near) setNear(isNear);
    // Gentle breathing; bigger when selected or just jumped to.
    if (sphere.current) sphere.current.scale.setScalar((highlighted || selected ? 1.4 : 1) + Math.sin(clock.elapsedTime * 2 + resolved.date.best) * 0.06);
  });

  return (
    <group position={pos}>
      <group ref={group}>
        <mesh ref={sphere}>
          <sphereGeometry args={[radius, 24, 24]} />
          <meshStandardMaterial color={FIELD_COLOR[ev.field]} emissive={highlighted || selected ? '#ffe066' : FIELD_COLOR[ev.field]} emissiveIntensity={highlighted || selected ? 2 : hasMap ? 1.6 : 0.8} />
        </mesh>
        {hasMap && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.85, 0.03, 8, 48]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
          </mesh>
        )}
        <HitArea radius={radius * 1.2} minPx={mobile ? MIN_TAP_RADIUS.mobile : MIN_TAP_RADIUS.desktop} onClick={onClick} />
      </group>
      {(showLabel || near || highlighted || selected) && (
        <Html position={[0, radius * mag.current + 0.6, 0]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`ev-label ${hasMap ? 'has-map' : ''} ${highlighted || selected ? 'highlighted' : ''} ${imported ? 'imported' : ''}`}>
            <span>{formatShort(resolved.date)}</span> {ev.title}
            {resolved.disputed && <em className="disputed"> · date disputed</em>}
            {hasMap && <em> · {debates} debate{debates > 1 ? 's' : ''}</em>}
          </div>
        </Html>
      )}
    </group>
  );
}

/** Stable pseudo-random number in [0, 1) from a string, so dots don't jump between renders. */
function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Every event that isn't important enough for this level, as one batch of small dots
 * (one draw call for hundreds). Dots not in the faint set are shrunk to nothing. The small
 * sideways/up offset only stops dots on the same day sitting on top of each other.
 * Hover shows a label on desktop. On phones the dots aren't tappable (they're far below
 * the 44px minimum) — expand time around them and they become proper bubbles.
 */
function FaintDots({ events, faint, resolved, scale, mobile, onSelect }: {
  events: TimelineEvent[];
  faint: Set<string>;
  resolved: Map<string, ResolvedDate>;
  scale: TimeScale;
  mobile: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(
    () =>
      events.map((ev) => {
        const [x, , z] = place(scale, resolved.get(ev.id)!.date.best, ev.field, 0);
        return new THREE.Vector3(x + (hash01(ev.id) - 0.5) * 1.2, 0.15 + hash01(ev.id, 7) * 1.1, z);
      }),
    [events, resolved, scale],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    events.forEach((ev, i) => {
      const sc = faint.has(ev.id) ? 1 : 0;
      mesh.setMatrixAt(i, m.makeScale(sc, sc, sc).setPosition(points[i]));
      mesh.setColorAt(i, color.set(FIELD_COLOR[ev.field]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); // needed so hover finds the instances
  }, [events, points, faint]);

  if (events.length === 0) return null;
  const hovered = hover !== null && faint.has(events[hover]?.id) ? events[hover] : undefined;
  return (
    <group>
      <instancedMesh
        key={`${events.length}-${mobile}` /* instance count is fixed at creation; mobile changes hit-testing */}
        ref={ref}
        args={[undefined, undefined, events.length]}
        {...(mobile ? { raycast: () => null } : {})}
        onPointerMove={(e) => { e.stopPropagation(); setHover(e.instanceId ?? null); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(null); document.body.style.cursor = 'auto'; }}
        onClick={(e) => { e.stopPropagation(); if (e.instanceId !== undefined && faint.has(events[e.instanceId].id)) onSelect(events[e.instanceId].id); }}
      >
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshBasicMaterial transparent opacity={0.45} />
      </instancedMesh>
      {hovered && (
        <Html position={points[hover!].toArray()} center distanceFactor={10} zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
          <div className="ev-label imported">
            <span>{formatShort(resolved.get(hovered.id)!.date)}</span> {hovered.title}
          </div>
        </Html>
      )}
    </group>
  );
}

/** A person or organisation, at the date they were born or founded. */
function EntityNode({ en, scale, onOpen, highlighted, mobile }: {
  en: Dataset['entities'][number];
  scale: TimeScale;
  onOpen: () => void;
  highlighted: boolean;
  mobile: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <group position={place(scale, en.founded.best, en.field, -0.1)}>
      <mesh scale={highlighted ? 2.2 : hover ? 1.5 : 1}>
        <octahedronGeometry args={[0.22]} />
        <meshStandardMaterial color="#ffffff" emissive={highlighted ? '#ffe066' : '#8899aa'} emissiveIntensity={highlighted ? 2 : 0.6} />
      </mesh>
      <HitArea radius={0.3} minPx={mobile ? MIN_TAP_RADIUS.mobile : MIN_TAP_RADIUS.desktop} onClick={onOpen} onOver={() => setHover(true)} onOut={() => setHover(false)} />
      {(hover || highlighted) && (
        <Html position={[0, 0.7, 0]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="en-label">{en.name} <span>· founded {formatShort(en.founded)}</span></div>
        </Html>
      )}
    </group>
  );
}

/**
 * Overlapping bubbles fanned out in a ring around where you clicked, each with its date and
 * title, like spreading out overlapping map pins. Pick one to open its menu. If there are
 * too many to fit, the last slot offers to expand time around them instead.
 */
function FanRing({ events, resolved, at, canExpand, onPick, onExpand }: {
  events: TimelineEvent[];
  resolved: Map<string, ResolvedDate>;
  at: [number, number, number];
  canExpand: boolean;
  onPick: (id: string) => void;
  onExpand: () => void;
}) {
  const overflow = events.length > FAN_MAX;
  const shown = overflow ? events.slice(0, FAN_MAX - 1) : events;
  const slots = shown.length + (overflow ? 1 : 0);
  const R = fanRadius(slots);
  const { camera, size } = useThree();
  const sx = ((new THREE.Vector3(...at).project(camera).x + 1) / 2) * size.width;
  const reach = R + 200; // ring radius plus a label
  // A narrow screen has no room for labels on both sides: put them all on the roomier side.
  const only = size.width < reach * 2 + 40 ? (sx < size.width / 2 ? 'right' : 'left') : undefined;
  const pos = fanPositions(slots, R, only);
  const box = Math.max(R, ...pos.map((p) => Math.abs(p.y))) * 2 + 60;
  // Near a screen edge, slide the buttons (not the hub) sideways so their labels stay on screen.
  // Each button reaches about LABEL px from its dot, away from the hub.
  const LABEL = size.width < 760 ? 175 : 225;
  const left = Math.min(...pos.map((p) => p.x - (p.side === 'left' ? LABEL : 13)));
  const right = Math.max(...pos.map((p) => p.x + (p.side === 'right' ? LABEL : 13)));
  const dx = Math.max(0, 8 - (sx + left)) - Math.max(0, sx + right - (size.width - 8));
  return (
    <Html position={at} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
      <div className="fan" style={{ width: box, height: box }} role="menu" aria-label={`${events.length} overlapping events`}>
        <svg className="fan-lines" width={box} height={box} aria-hidden>
          {pos.map((p, i) => <line key={i} x1={box / 2} y1={box / 2} x2={box / 2 + p.x + dx} y2={box / 2 + p.y} />)}
        </svg>
        <div className="fan-hub" style={{ left: box / 2, top: box / 2 }}>{events.length}</div>
        {shown.map((ev, i) => {
          const p = pos[i];
          return (
            <button
              key={ev.id}
              role="menuitem"
              className={`fan-item ${p.side}`} /* labels point away from the centre */
              style={{ left: box / 2 + p.x + dx, top: box / 2 + p.y }}
              onClick={() => onPick(ev.id)}
            >
              <i style={{ background: FIELD_COLOR[ev.field] }} />
              <span><small>{formatShort(resolved.get(ev.id)!.date)}</small> {ev.title}</span>
            </button>
          );
        })}
        {overflow && (
          <button
            role="menuitem"
            className={`fan-item more ${pos[slots - 1].side}`}
            style={{ left: box / 2 + pos[slots - 1].x + dx, top: box / 2 + pos[slots - 1].y }}
            onClick={onExpand}
            disabled={!canExpand}
          >
            <i />
            <span>+{events.length - shown.length} more{canExpand ? ' · expand time' : ''}</span>
          </button>
        )}
      </div>
    </Html>
  );
}

/** The menu for a selected bubble: open it, or expand time around it. */
function BubbleMenu({ ev, resolved, at, level, onOpen, onExpand, onClose }: {
  ev: TimelineEvent;
  resolved: ResolvedDate;
  at: [number, number, number];
  level: ExpandLevel;
  onOpen: () => void;
  onExpand: (level: ExpandLevel) => void;
  onClose: () => void;
}) {
  // Keep the menu on screen when its bubble is near an edge.
  const { camera, size } = useThree();
  const sx = ((new THREE.Vector3(...at).project(camera).x + 1) / 2) * size.width;
  const half = (size.width < 760 ? 250 : 230) / 2 + 12;
  const dx = Math.max(0, half - sx) - Math.max(0, sx + half - size.width);
  return (
    <Html position={[at[0], at[1] + 1.4, at[2]]} center zIndexRange={[31, 0]}>
      <div className="bubble-menu" role="dialog" aria-label={ev.title} style={{ transform: `translateX(${dx}px)` }}>
        <div className="bm-head">
          <span><small>{formatShort(resolved.date)}</small><b>{ev.title}</b></span>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <button className="primary" onClick={onOpen}>{ev.topicIds.length ? `Open debates (${ev.topicIds.length})` : 'Open details & links'}</button>
        {level === 'normal' && <button onClick={() => onExpand('months')}>Expand to months</button>}
        {level !== 'days' && <button onClick={() => onExpand('days')}>Expand to days</button>}
      </div>
    </Html>
  );
}

/** Everything inside the 3D canvas: camera, expand animation, level-of-detail planner and the river. */
function Scene(props: Props) {
  const { data, expansion, level, highlightId, mobile, showImported, onOpenEvent, onOpenEntity, onExpand } = props;
  const { camera, size, gl } = useThree();
  const rig = mobile ? RIG.mobile : RIG.desktop;
  const ahead = mobile ? FOCUS_AHEAD.mobile : FOCUS_AHEAD.desktop;

  // ---- The scale being drawn, and the expand / collapse animation ----
  const target = useMemo(() => makeScale(expansion.window), [expansion.window]);
  const [display, setDisplay] = useState<TimeScale>(target); // what's on screen right now
  const displayRef = useRef(display);
  const pose = useRef<CameraPose>({ s: props.targetS, latC: 0, latL: 0 });
  const trans = useRef<{ from: TimeScale; to: TimeScale; start: CameraPose; anchor: number; flyTo?: number; t0: number } | null>(null);
  const lastSeq = useRef(expansion.seq);
  const lastReported = useRef(Number.NaN);
  const sideways = useRef(0);
  const targetRef = useRef(props.targetS);
  targetRef.current = props.targetS;

  // A new expansion request starts an animation from whatever is on screen now (even if
  // another animation is half-way), anchored on the requested moment.
  useLayoutEffect(() => {
    if (expansion.seq === lastSeq.current) return;
    lastSeq.current = expansion.seq;
    trans.current = { from: displayRef.current, to: target, start: { ...pose.current }, anchor: expansion.anchor, flyTo: expansion.flyTo, t0: performance.now() };
  }, [expansion.seq, expansion.anchor, expansion.flyTo, target]);

  // Slide the camera towards the highlighted item's lane: most of the way on phones, a little on desktop.
  const byId = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events]);
  const focusField = highlightId ? (byId.get(highlightId)?.field ?? data.entities.find((e) => e.id === highlightId)?.field) : undefined;
  const sidewaysTarget = focusField ? laneOffset(focusField) * (mobile ? 0.8 : 0.3) : 0;

  /** Put the camera where `pose` says, for the scale currently drawn. */
  const applyCamera = () => {
    const f = cameraFrame(pose.current, displayRef.current, rig, sideways.current);
    camera.position.set(...f.position);
    camera.lookAt(...f.look);
    camera.updateMatrixWorld(); // so labels placed this frame use the new camera too
    const s = pose.current.s;
    if (!(Math.abs(s - lastReported.current) < 0.05)) {
      lastReported.current = s;
      props.onYear(displayRef.current.toYear(s + ahead));
    }
  };

  // During an animation each new scale is drawn by React a moment after we choose it. The
  // matching camera pose waits here (`pending`) and is applied in the same update that moves
  // the bubbles (the layout effect below). If the camera moved first, everything would be
  // drawn one frame out of step — a visible jitter.
  const pending = useRef<{ scale: TimeScale; pose: CameraPose } | null>(null);
  useLayoutEffect(() => {
    if (pending.current?.scale === display) {
      pose.current = pending.current.pose;
      pending.current = null;
    }
    displayRef.current = display;
    applyCamera();
  }, [display]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    sideways.current += (sidewaysTarget - sideways.current) * Math.min(1, dt * 2);
    const t = trans.current;
    if (t) {
      // Animating: a blended scale, and the camera pose that keeps the anchor exactly still.
      const u = (performance.now() - t.t0) / EXPAND_MS;
      const scaleNow = u >= 1 ? t.to : blendScales(t.from, t.to, easeOut(u));
      const poseNow = anchorPose(t.start, t.from, scaleNow, t.anchor, rig);
      pending.current = { scale: scaleNow, pose: poseNow };
      setDisplay(scaleNow); // the camera follows in the layout effect, together with the bubbles
      if (u >= 1) {
        trans.current = null;
        const end = t.flyTo !== undefined ? Math.max(t.to.sMin, Math.min(t.to.sMax, t.to.toS(t.flyTo) - ahead)) : poseNow.s;
        props.setTargetS(end); // stay exactly here (or travel on, for "fly to")
        targetRef.current = end;
      }
      return;
    }
    // Normal travel: ease towards the target, and let any sideways correction fade as you move.
    const before = pose.current.s;
    pose.current.s += (targetRef.current - before) * Math.min(1, dt * 3);
    const moved = Math.abs(pose.current.s - before);
    if (moved > 1e-6) {
      const fade = Math.exp(-moved / LATERAL_FADE);
      pose.current.latC *= fade;
      pose.current.latL *= fade;
    }
    applyCamera();
  });

  // ---- Dates, importance and which events are drawn ----
  const resolved = useMemo(() => new Map(data.events.map((e) => [e.id, resolveEventDate(e, data)])), [data]);
  const importance = useMemo(() => importanceMap(data), [data]);
  const events = useMemo(() => (showImported ? data.events : data.events.filter((e) => e.provenance?.importedFrom !== 'wikidata')), [data.events, showImported]);

  // ---- Level of detail: a few times a second, project events to the screen and plan them. ----
  const [plan, setPlan] = useState<RiverPlan>({ bubbles: [], faint: [], stacks: [] });
  const planRef = useRef(plan);
  planRef.current = plan;
  const lastKey = useRef('');
  const sinceLast = useRef(1);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => { sinceLast.current = 1; }, [display, level, highlightId, events, mobile]); // re-plan right away

  useFrame((_, dt) => {
    sinceLast.current += dt;
    if (sinceLast.current < 0.2) return;
    sinceLast.current = 0;
    const fovTan = Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360);
    const scale = displayRef.current;
    const items: ScreenItem[] = [];
    const offscreen: string[] = [];
    for (const ev of events) {
      tmp.set(...place(scale, resolved.get(ev.id)!.date.best, ev.field, 0.6));
      up.copy(tmp).setY(tmp.y + 1);
      const dist = camera.position.distanceTo(tmp);
      tmp.project(camera);
      up.project(camera);
      if (dist > VIEW_DISTANCE || tmp.z > 1 || Math.abs(tmp.x) > 1.15 || Math.abs(tmp.y) > 1.15) {
        offscreen.push(ev.id);
        continue;
      }
      const pxPerUnit = size.height / (2 * dist * fovTan);
      const upPx = Math.abs(up.y - tmp.y) * (size.height / 2); // screen pixels per unit straight up here
      const labelScale = 14 / (2 * fovTan * dist); // how drei's <Html distanceFactor={14}> scales a label here
      const score = importance.get(ev.id)!.score;
      const radius = ev.topicIds.length ? 0.5 : ev.provenance?.importedFrom === 'wikidata' ? 0.26 : 0.32;
      items.push({
        id: ev.id,
        x: ((tmp.x + 1) / 2) * size.width,
        y: ((1 - tmp.y) / 2) * size.height,
        r: radius * pxPerUnit,
        importance: score,
        major: score >= LOD_THRESHOLD[level],
        pinned: ev.id === highlightId,
        // These mirror where EventNode draws its label, so the planner can tell which collide.
        labelW: ((ev.title.length + 10) * 6.8 + 18) * labelScale,
        labelH: 24 * labelScale,
        labelLift: (radius + 0.6) * upPx,
      });
    }
    const p = planScreen(items, { minRadius: mobile ? MIN_TAP_RADIUS.mobile : MIN_TAP_RADIUS.desktop, gap: 0 });
    p.faint.push(...offscreen);
    const key = planKey(p);
    if (key !== lastKey.current) {
      lastKey.current = key;
      setPlan(p);
    }
  });

  // ---- Selection, fan-out rings and the bubble menu ----
  const [selected, setSelected] = useState<string | null>(null);
  const [fan, setFan] = useState<{ ids: string[]; at: [number, number, number] } | null>(null);
  const cursor = useRef<{ x: number; y: number } | null>(null);

  const posOf = (id: string) => {
    const ev = byId.get(id)!;
    return place(display, resolved.get(id)!.date.best, ev.field, 0.6);
  };
  const bubbleClick = (id: string) => {
    const stack = planRef.current.stacks.find((s) => s.includes(id));
    setSelected(null);
    if (stack && !fan) setFan({ ids: stack, at: posOf(id) }); // overlapping: fan them out first
    else {
      setFan(null);
      setSelected(id);
    }
  };

  // Clicking anywhere outside the ring or menu closes them; so does Escape, travelling, or a new level.
  useEffect(() => {
    if (!fan && !selected) return;
    const outside = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest('.fan, .bubble-menu')) {
        setFan(null);
        setSelected(null);
      }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFan(null); setSelected(null); } };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('wheel', outside, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('wheel', outside, true);
      window.removeEventListener('keydown', esc);
    };
  }, [fan, selected]);
  useEffect(() => { setFan(null); }, [expansion.seq]);

  // The cursor, for the hover magnifier (desktop only).
  useEffect(() => {
    if (mobile) return;
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      cursor.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const leave = () => { cursor.current = null; };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [gl, mobile]);

  // Double-click (or double-tap) the water: expand one level around that moment.
  const lastWaterTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const next = deeper(level);
  const onWaterClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return; // that was a drag
    const now = performance.now();
    const prev = lastWaterTap.current;
    const { clientX: x, clientY: y } = e.nativeEvent;
    if (prev && now - prev.t < DOUBLE_TAP.ms && Math.hypot(prev.x - x, prev.y - y) < DOUBLE_TAP.px) {
      lastWaterTap.current = null;
      if (next) onExpand(next, displayRef.current.toYear(-e.point.z));
    } else {
      lastWaterTap.current = { t: now, x, y };
    }
  };

  const faint = useMemo(() => new Set(plan.faint), [plan]);
  const selectedEv = selected ? byId.get(selected) : undefined;
  const fanEvents = fan ? fan.ids.map((id) => byId.get(id)!).filter(Boolean) : [];
  const fanMid = fanEvents.length ? fanEvents.map((e) => resolved.get(e.id)!.date.best).sort((a, b) => a - b)[Math.floor(fanEvents.length / 2)] : 0;

  return (
    <>
      <color attach="background" args={['#05070f']} />
      <fog attach="fog" args={['#05070f', 20, 90]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 10, 0]} intensity={1} />
      <Stars radius={150} depth={60} count={3000} factor={4} fade speed={0.5} />
      <Lanes scale={display} onWaterClick={onWaterClick} />
      <Particles />
      <Ticks scale={display} />

      {plan.bubbles.map(({ id, showLabel }) => {
        const ev = byId.get(id);
        if (!ev) return null;
        const r = resolved.get(id)!;
        return (
          <group key={id}>
            <EventNode ev={ev} resolved={r} scale={display} onClick={() => bubbleClick(id)} highlighted={highlightId === id} selected={selected === id} showLabel={showLabel} mobile={mobile} cursor={cursor} />
            {spanVisible(r.date, display) && <UncertaintySpan resolved={r} field={ev.field} y={0.6} scale={display} dim={!!ev.provenance} />}
          </group>
        );
      })}

      <FaintDots events={events} faint={faint} resolved={resolved} scale={display} mobile={mobile} onSelect={(id) => { setFan(null); setSelected(id); }} />

      {data.entities.map((en) => (
        <EntityNode key={en.id} en={en} scale={display} onOpen={() => onOpenEntity(en.id)} highlighted={highlightId === en.id} mobile={mobile} />
      ))}

      {fan && (
        <FanRing
          events={fanEvents}
          resolved={resolved}
          at={fan.at}
          canExpand={!!next}
          onPick={(id) => { setFan(null); setSelected(id); }}
          onExpand={() => { setFan(null); if (next) onExpand(next, fanMid); }}
        />
      )}
      {selectedEv && (
        <BubbleMenu
          ev={selectedEv}
          resolved={resolved.get(selectedEv.id)!}
          at={posOf(selectedEv.id)}
          level={level}
          onOpen={() => { setSelected(null); onOpenEvent(selectedEv.id); }}
          onExpand={(l) => { setSelected(null); onExpand(l, resolved.get(selectedEv.id)!.date.best); }}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

export function River(props: Props) {
  const { setTargetS, mobile, expansion, onExpandStep } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const stepRef = useRef(onExpandStep);
  stepRef.current = onExpandStep;
  const topicOpen = useRef(false);
  topicOpen.current = !!props.topic;
  const scale = useMemo(() => makeScale(expansion.window), [expansion.window]);

  // Scroll / drag / swipe / arrow keys travel through time; + / − expand and collapse.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const clamp = (s: number) => Math.max(scale.sMin, Math.min(scale.sMax, s));
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTargetS((s) => clamp(s + e.deltaY * 0.015));
    };
    let lastY: number | null = null;
    const down = (e: PointerEvent) => { lastY = e.clientY; };
    const move = (e: PointerEvent) => {
      if (lastY === null) return;
      const d = lastY - e.clientY;
      lastY = e.clientY;
      setTargetS((s) => clamp(s + d * (mobile ? 0.25 : 0.15)));
    };
    const up = () => { lastY = null; };
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || topicOpen.current) return; // not while typing, or while a claim map is open
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setTargetS((s) => clamp(s + 5));
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setTargetS((s) => clamp(s - 5));
      if (e.key === '+' || e.key === '=') stepRef.current(1);
      if (e.key === '-' || e.key === '_') stepRef.current(-1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
    };
  }, [setTargetS, mobile, scale]);

  return (
    <div ref={wrap} className="river" style={{ touchAction: 'none' }}>
      <Canvas camera={{ fov: mobile ? 70 : 60, near: 0.1, far: 400 }} dpr={[1, 2]}>
        {props.topic ? <TopicScene {...props.topic} /> : <Scene {...props} />}
      </Canvas>
    </div>
  );
}
