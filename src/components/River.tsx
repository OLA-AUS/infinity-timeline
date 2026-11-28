// The 3D river of time (React Three Fiber).
//
// What's drawn:
//   • Lanes      — one coloured line per field, following the river's meander
//   • Events     — one glowing bubble per event; ringed ones have debates you can dive into.
//                  On desktop, bubbles under the cursor swell up (a magnifier).
//   • Faint dots — events not important enough for the full river (src/lib/importance.ts),
//                  and everything outside an expanded window
//   • Spans      — glowing ranges for uncertain and disputed dates (RiverSpans.tsx)
//   • Entities   — small diamonds where people and organisations were born or founded
//   • Personal lanes — each visible personal space (Family, Work…) gets its own lane on the
//                  river's right bank (src/lib/personal.ts). Its events are ordinary events, so
//                  they cluster, fan out, expand and follow the scale bar like any other.
//
// Time scale (src/lib/timeScale.ts, src/lib/viewStack.ts): the scale bar in the header
// picks Full river · Period · Years · Months · Weeks · Days. Any level other than the full
// river shows a *window* of time stretched evenly along the river. Inside the window the
// river is brighter and wider, with ticks; outside it everything is faded, unlabelled and
// squeezed. Each edge has an end cap with "Continue" (slide the window along by its own
// length) and "Collapse" (go back a step).
//
// Clicking a bubble selects it (a small menu opens its claim map). Clicking where several
// bubbles overlap dims the scene and fans them out in a ring, in date order clockwise from
// the top, with a floating "Expand these N events" button: that expands exactly their span
// into a period (and periods can be expanded again inside each other).
//
// Every change animates for about half a second with no jumps (src/lib/cameraAnchor.ts).
// The big date in the header always shows the time at the camera.
//
// Travel: scroll, drag, swipe or the arrow keys. + / − step the scale bar.
//
// While a claim map is open, the main river is hidden and the canvas shows a single topic
// river instead (TopicRiver.tsx), with only the events related to the map's subject.
import { Html, Line, Stars } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { Dataset, SpaceTag, TimelineEvent } from '../types';
import { FIELDS } from '../types';
import { colorOf, FIELD_COLOR, laneOffset, laneX, PERSONAL_LANE_GAP, personalLaneOffset, riverX } from '../lib/time';
import { formatShort, formatYear } from '../lib/dates';
import { resolveEventDate, type ResolvedDate } from '../lib/dateDispute';
import { importanceMap, LOD_THRESHOLD } from '../lib/importance';
import { FAN_ROW, fanPositions, fanRadius, overlapping, planKey, planScreen, type RiverPlan, type ScreenItem } from '../lib/cluster';
import { anchorMoments, cameraFrame, cameraTime, easeOut, EXPAND_MS, meander, RIG, transitionPose, type CameraPose } from '../lib/cameraAnchor';
import { blendScales, formatAtUnit, makeScale, windowTicks, type ScaleLevel, type TimeScale, type TimeWindow } from '../lib/timeScale';
import { currentWindow, type ViewChange } from '../lib/viewStack';
import { place, spanVisible, UncertaintySpan } from './RiverSpans';
import { HitArea, MIN_TAP_RADIUS } from './HitArea';
import { TopicScene, type TopicProps } from './TopicRiver';

/**
 * A request to change what the river shows (from App.tsx). `seq` goes up by one each time,
 * so the river animates even when asked for the same thing twice.
 */
export interface ViewRequest {
  change: ViewChange;
  seq: number;
}

interface Props {
  data: Dataset;
  view: ViewRequest;
  level: ScaleLevel;
  targetS: number;
  setTargetS: (s: number | ((s: number) => number)) => void;
  /** The time at the camera, for the big date readout. */
  onCameraTime: (y: number) => void;
  onOpenEvent: (id: string) => void;
  onOpenEntity: (id: string) => void;
  highlightId?: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mobile: boolean;
  showImported: boolean;
  /** "Expand these N events": expand exactly their span into a period. */
  onExpandCluster: (eventIds: string[]) => void;
  /** End caps: slide the window along (+1 forwards, −1 back), or go back a step. */
  onContinue: (dir: 1 | -1) => void;
  onCollapse: () => void;
  /** + / − keys: one step along the scale bar. */
  onStep: (dir: 1 | -1) => void;
  /** When set, show this topic river instead of the main river (a claim map is open). */
  topic?: TopicProps;
  /** Visible personal spaces, in lane order — each is drawn as its own lane. */
  spaces: SpaceTag[];
  /** Slide the camera sideways to this offset (e.g. a personal lane on a phone); null = automatic. */
  sideFocus: number | null;
}

/** Years that get a big faint label beside the full river. */
const TICKS = [-3000, -2000, -1000, 0, 500, 1000, 1500, 1700, 1800, 1900, 1950, 1980, 2000, 2010, 2020, 2025];
/** How far ahead you can see (matches the fog). Events further away aren't planned. */
const VIEW_DISTANCE = 95;
/** Bubbles within this many pixels of the cursor swell up (desktop only). */
const MAGNIFY_RADIUS = 90;

/** The cursor's position over the canvas in pixels (null when it's not over it). Shared, not state. */
type Cursor = MutableRefObject<{ x: number; y: number } | null>;

/** A fanned-out cluster: its events (sorted by date) and where in 3D the ring is centred. */
type FanState = { ids: string[]; at: [number, number, number] } | null;

/** Is a moment inside the window (or is there no window)? */
const inside = (w: TimeWindow | null, t: number) => !w || (t >= w.start && t < w.end);

/**
 * The water and one coloured line per field lane. Inside a window: a brighter, wider stretch.
 * Outside it: a dark veil over the water and lanes, so the squeezed rest of history fades back.
 */
function Lanes({ scale, spaces }: { scale: TimeScale; spaces: SpaceTag[] }) {
  const from = scale.sMin - 10;
  const to = scale.sMax + 30;
  const { lanes, water, bright, veils, personalWater } = useMemo(() => {
    const xAt = (s: number) => meander(scale.toYear(s)); // sideways position comes from the year
    const line = (offset: number) => {
      const pts: [number, number, number][] = [];
      for (let s = from; s <= to; s += 2) pts.push([xAt(s) + offset, 0, -s]);
      return pts;
    };
    const lanes = [
      ...FIELDS.map((f) => ({ key: f, color: FIELD_COLOR[f], pts: line(laneOffset(f)), personal: false })),
      ...spaces.map((sp) => ({ key: sp.id, color: sp.color, pts: line(personalLaneOffset(sp.lane)), personal: true })),
    ];
    // A ribbon of water from `left` to `right` of the river's centre line (half-width if one number).
    const ribbon = (s0: number, s1: number, half: number, y: number, step: number, right = half) => {
      const verts: number[] = [];
      const idx: number[] = [];
      let i = 0;
      for (let s = s0; s <= s1 + 1e-6; s += step, i++) {
        const x = xAt(s);
        verts.push(x - half, y, -s, x + right, y, -s);
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
    const a = w ? scale.toS(w.start) : 0;
    const b = w ? scale.toS(w.end) : 0;
    // Personal lanes sit on their own strip of water beside the main river, with a gap.
    const edge = spaces.length ? personalLaneOffset(spaces.length - 1) + PERSONAL_LANE_GAP / 2 : 0;
    const far = Math.max(9, edge + 0.5);
    return {
      lanes,
      water: ribbon(from, to, 8, -0.4, 1),
      personalWater: spaces.length ? ribbon(from, to, -(personalLaneOffset(0) - PERSONAL_LANE_GAP / 2), -0.4, 1, edge) : null,
      bright: w ? ribbon(a, b, 10.5, -0.38, 0.5, Math.max(10.5, edge + 0.5)) : null,
      veils: w ? [ribbon(from, a, 9, 0.05, 1, far), ribbon(b, to, 9, 0.05, 1, far)] : [],
    };
  }, [scale, from, to, spaces]);
  useEffect(() => () => { water.dispose(); personalWater?.dispose(); bright?.dispose(); veils.forEach((v) => v.dispose()); }, [water, personalWater, bright, veils]);
  return (
    <group>
      <mesh geometry={water}>
        <meshBasicMaterial color="#123063" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      {personalWater && (
        <mesh geometry={personalWater}>
          <meshBasicMaterial color="#2a2448" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
      {bright && (
        <mesh geometry={bright}>
          <meshBasicMaterial color="#2f6bff" transparent opacity={0.32} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {lanes.map(({ key, color, pts, personal }) => (
        <Line key={key} points={pts} color={color} lineWidth={personal ? 2.2 : 1.5} transparent opacity={personal ? 0.75 : 0.55} />
      ))}
      <LaneNames scale={scale} spaces={spaces} />
      {veils.map((v, i) => (
        <mesh key={i} geometry={v} renderOrder={2}>
          <meshBasicMaterial color="#05070f" transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Each personal lane's name ("Family"), floating on the lane a little ahead of the camera so
 * it's always in view as you travel. Moved every frame, not re-rendered.
 */
function LaneNames({ scale, spaces }: { scale: TimeScale; spaces: SpaceTag[] }) {
  const { camera } = useThree();
  const groups = useRef<(THREE.Group | null)[]>([]);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    spaces.forEach((sp, i) => {
      // The nearest point ahead on the lane that's on screen (where the river bends, the
      // stretch just ahead of the camera can be off to the side).
      let at: [number, number, number] | null = null;
      for (const ahead of [9, 14, 20, 28, 38, 50]) {
        const s = Math.min(scale.sMax + 20, -camera.position.z + ahead);
        const year = scale.toYear(s);
        at = [meander(year) + personalLaneOffset(sp.lane), 0.15, -s];
        v.set(...at).project(camera);
        if (v.z < 1 && Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8) break;
      }
      if (at) groups.current[i]?.position.set(...at);
    });
  });
  return (
    <>
      {spaces.map((sp, i) => (
        <group key={sp.id} ref={(g) => { groups.current[i] = g; }}>
          <Html center distanceFactor={16} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
            <div className="lane-name" style={{ borderColor: sp.color, color: sp.color }}>{sp.name}</div>
          </Html>
        </group>
      ))}
    </>
  );
}

/** Drifting specks of light, for a sense of flow. Purely decorative, so they ignore the scale. */
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

/** Year labels beside the full river, or the window's ticks (years / months / weeks / days) across it. */
function Ticks({ scale }: { scale: TimeScale }) {
  const w = scale.window;
  const at = (year: number) => ({ s: scale.toS(year), x: meander(year) });
  if (!w) {
    return (
      <group>
        {TICKS.map((y) => {
          const { s, x } = at(y);
          return (
            <Html key={y} position={[x - 9, 0, -s]} center distanceFactor={18} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <div className="tick">{formatYear(y)}</div>
            </Html>
          );
        })}
      </group>
    );
  }
  return (
    <group>
      {windowTicks(w).map((t) => {
        const { s, x } = at(t.year);
        return (
          <group key={`in-${t.year}`}>
            {/* A line across the river for major ticks; a short notch for minor ones. */}
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
    </group>
  );
}

/**
 * An end cap at each edge of the window: a bright line across the river and a small panel
 * "End of period · Jun 1943" with Continue (slide the window along by its own length) and
 * Collapse (go back a step).
 */
function EndCaps({ scale, mobile, onContinue, onCollapse }: { scale: TimeScale; mobile: boolean; onContinue: (dir: 1 | -1) => void; onCollapse: () => void }) {
  const w = scale.window;
  if (!w) return null;
  const unit = w.tick === 'years' ? 'months' : 'days';
  return (
    <group>
      {([['start', w.start, -1], ['end', w.end, 1]] as const).map(([edge, year, dir]) => {
        const s = scale.toS(year);
        const x = meander(year);
        const when = formatAtUnit(edge === 'end' ? year - 1e-6 : year, unit);
        return (
          <group key={edge}>
            <Line points={[[x - 10.5, 0.03, -s], [x + 10.5, 0.03, -s]]} color="#7aa2ff" lineWidth={3} transparent opacity={0.95} />
            {/* Beside the river on desktop; in the middle of it on phones, where the river is wider than the screen. Fixed size, so it stays readable from afar. */}
            <Html position={[x + (mobile ? 0 : 13.5), 0.4, -s]} center zIndexRange={[8, 7]}>
              <div className={`end-cap ${edge}`}>
                <div className="ec-title">{edge === 'start' ? 'Start of period' : 'End of period'} · <b>{when}</b></div>
                <div className="ec-buttons">
                  <button onClick={() => onContinue(dir)}>{dir < 0 ? '← Continue' : 'Continue →'}</button>
                  <button onClick={onCollapse}>Collapse</button>
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

/**
 * One event as its own bubble. On desktop it swells as the cursor comes near, and shows its
 * label then too. Outside the expanded window it's drawn faded, with no label.
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
  const pos = place(scale, resolved.date.best, laneX(ev), 0.6);

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
          <meshStandardMaterial color={colorOf(ev)} emissive={highlighted || selected ? '#ffe066' : colorOf(ev)} emissiveIntensity={highlighted || selected ? 2 : hasMap ? 1.6 : 0.8} />
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
          <div className={`ev-label ${hasMap ? 'has-map' : ''} ${highlighted || selected ? 'highlighted' : ''} ${imported ? 'imported' : ''} ${ev.space ? 'personal' : ''}`} style={ev.space ? { borderColor: ev.space.color } : undefined}>
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
 * Small dots, all in one batch (one draw call for hundreds): events not important enough
 * for a bubble at this level, and — darker, with no hover label — everything outside the
 * expanded window. Other events are shrunk to nothing. The small sideways/up offset only
 * stops dots on the same day sitting on top of each other. On phones the dots aren't
 * tappable (far below 44px); choose a finer level and they become proper bubbles.
 */
function FaintDots({ events, faint, outside, resolved, scale, mobile, onSelect }: {
  events: TimelineEvent[];
  faint: Set<string>;
  outside: Set<string>;
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
        const [x, , z] = place(scale, resolved.get(ev.id)!.date.best, laneX(ev), 0);
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
      const out = outside.has(ev.id);
      const sc = out ? 0.7 : faint.has(ev.id) ? 1 : 0;
      mesh.setMatrixAt(i, m.makeScale(sc, sc, sc).setPosition(points[i]));
      mesh.setColorAt(i, color.set(colorOf(ev)).multiplyScalar(out ? 0.3 : 1));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); // needed so hover finds the instances
  }, [events, points, faint, outside]);

  if (events.length === 0) return null;
  const hoverable = (i: number | null) => i !== null && faint.has(events[i]?.id) && !outside.has(events[i]?.id);
  const hovered = hoverable(hover) ? events[hover!] : undefined;
  return (
    <group>
      <instancedMesh
        key={`${events.length}-${mobile}` /* instance count is fixed at creation; mobile changes hit-testing */}
        ref={ref}
        args={[undefined, undefined, events.length]}
        {...(mobile ? { raycast: () => null } : {})}
        onPointerMove={(e) => { e.stopPropagation(); setHover(e.instanceId ?? null); document.body.style.cursor = hoverable(e.instanceId ?? null) ? 'pointer' : 'auto'; }}
        onPointerOut={() => { setHover(null); document.body.style.cursor = 'auto'; }}
        onClick={(e) => { e.stopPropagation(); if (e.instanceId !== undefined && hoverable(e.instanceId)) onSelect(events[e.instanceId].id); }}
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

/** A person or organisation, at the date they were born or founded. Faded outside the window. */
function EntityNode({ en, scale, onOpen, highlighted, mobile, outside: out }: {
  en: Dataset['entities'][number];
  scale: TimeScale;
  onOpen: () => void;
  highlighted: boolean;
  mobile: boolean;
  outside: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <group position={place(scale, en.founded.best, laneX(en), -0.1)}>
      <mesh scale={highlighted ? 2.2 : hover ? 1.5 : 1}>
        <octahedronGeometry args={[0.22]} />
        <meshStandardMaterial color={en.space?.color ?? '#ffffff'} emissive={highlighted ? '#ffe066' : en.space?.color ?? '#8899aa'} emissiveIntensity={highlighted ? 2 : 0.6} transparent opacity={out ? 0.2 : 1} />
      </mesh>
      {!out && <HitArea radius={0.3} minPx={mobile ? MIN_TAP_RADIUS.mobile : MIN_TAP_RADIUS.desktop} onClick={onOpen} onOver={() => setHover(true)} onOut={() => setHover(false)} />}
      {!out && (hover || highlighted) && (
        <Html position={[0, 0.7, 0]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="en-label">{en.name} <span>· {en.space ? 'born' : 'founded'} {formatShort(en.founded)}</span></div>
        </Html>
      )}
    </group>
  );
}

/**
 * Overlapping bubbles fanned out in a ring around where you clicked, in date order clockwise
 * from the top, each labelled with its date and title. Above the ring floats a button to
 * expand exactly their span. Picking one opens its menu.
 */
function FanRing({ events, resolved, at, onPick, onExpand }: {
  events: TimelineEvent[]; // already sorted by date
  resolved: Map<string, ResolvedDate>;
  at: [number, number, number];
  onPick: (id: string) => void;
  onExpand: () => void;
}) {
  const { camera, size } = useThree();
  const n = events.length;
  const R = fanRadius(n);
  const sp = new THREE.Vector3(...at).project(camera);
  const sx = ((sp.x + 1) / 2) * size.width;
  const sy = ((1 - sp.y) / 2) * size.height;
  const LABEL = size.width < 760 ? 175 : 225; // how far a button reaches from its dot
  // A narrow screen has no room for labels on both sides: put them all on the roomier side.
  const only = size.width < (R + LABEL) * 2 + 40 ? (sx < size.width / 2 ? 'right' : 'left') : undefined;
  // Tighter rows when there are lots (still ≥ 44px on phones).
  const row = size.width < 760 ? FAN_ROW : n > 16 ? 38 : FAN_ROW;
  const pos = fanPositions(n, R, only, row);
  const half = Math.max(R, ...pos.map((p) => Math.abs(p.y))) + 30;
  const box = half * 2;
  // Keep the buttons on screen: slide them (not the hub) sideways / up / down near an edge.
  const left = Math.min(...pos.map((p) => p.x - (p.side === 'left' ? LABEL : 13)));
  const right = Math.max(...pos.map((p) => p.x + (p.side === 'right' ? LABEL : 13)));
  const dx = Math.max(0, 8 - (sx + left)) - Math.max(0, sx + right - (size.width - 8));
  const topY = -half - 50; // the expand button sits above the ring
  const dy = Math.max(0, 8 - (sy + topY)) - Math.max(0, sy + half - (size.height - 8));
  const years = events.map((e) => resolved.get(e.id)!.date);
  const first = events[0];
  const last = events[n - 1];
  // The expand button sits over the middle of the labels (not the hub, which may be near an
  // edge), slid inwards so its whole width stays on screen. Width is estimated from its text.
  const expandText = `Expand these ${n} events · ${formatShort(years[0])} – ${formatShort(years[n - 1])}`;
  const btnHalf = Math.min(size.width - 32, size.width < 760 ? 320 : 9999, expandText.length * 7.4 + 34) / 2;
  const centre = sx + dx + (left + right) / 2;
  const btnX = Math.min(Math.max(centre, btnHalf + 8), size.width - btnHalf - 8) - sx + half;

  return (
    <Html position={at} center zIndexRange={[1000, 999]} style={{ pointerEvents: 'none' }}>
      <div className="fan" style={{ width: box, height: box }} role="menu" aria-label={`${n} overlapping events`}>
        <svg className="fan-lines" width={box} height={box} aria-hidden>
          {pos.map((p, i) => <line key={i} x1={half} y1={half} x2={half + p.x + dx} y2={half + p.y + dy} />)}
        </svg>
        <div className="fan-hub" style={{ left: half, top: half }}>{n}</div>
        <button className="fan-expand" style={{ left: btnX, top: half + topY + dy, maxWidth: btnHalf * 2 }} onClick={onExpand}>
          {expandText}
        </button>
        {events.map((ev, i) => {
          const p = pos[i];
          return (
            <button
              key={ev.id}
              role="menuitem"
              className={`fan-item ${p.side}` /* labels point away from the centre */}
              style={{ left: half + p.x + dx, top: half + p.y + dy }}
              onClick={() => onPick(ev.id)}
              title={ev === first ? 'Earliest' : ev === last ? 'Latest' : undefined}
            >
              <i style={{ background: colorOf(ev) }} />
              <span><small>{formatShort(resolved.get(ev.id)!.date)}</small> {ev.title}</span>
            </button>
          );
        })}
      </div>
    </Html>
  );
}

/**
 * Phones: the overlapping events as a scrollable list down the left, joined to a spine, with
 * a tall "Expand" button down the right that's always in reach. A phone has no room for a
 * full ring, and a ring taller than the screen cut off events and the expand button.
 * The river stays locked while this is open; ✕, a tap on empty space, picking an event or
 * expanding closes it.
 */
function FanSheet({ data, ids, onClose, onPick, onExpand }: {
  data: Dataset;
  ids: string[]; // already sorted by date
  onClose: () => void;
  onPick: (id: string) => void;
  onExpand: () => void;
}) {
  const events = ids.map((id) => data.events.find((e) => e.id === id)).filter((e): e is TimelineEvent => !!e);
  const dates = events.map((e) => resolveEventDate(e, data).date);
  if (!events.length) return null;
  const from = formatShort(dates[0]);
  const to = formatShort(dates[dates.length - 1]);
  return (
    <div className="fan-sheet" role="dialog" aria-label={`${events.length} overlapping events`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fs-list" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="fs-head"><b>{events.length} events here</b> · {from} – {to}</div>
        <ol>
          {events.map((ev, i) => (
            <li key={ev.id}>
              <button className="fan-item" onClick={() => onPick(ev.id)}>
                <i style={{ background: colorOf(ev) }} />
                <span><small>{formatShort(dates[i])}</small> {ev.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="fs-side">
        <button className="fs-close" onClick={onClose} aria-label="Close this list">✕</button>
        <button className="fs-expand" onClick={onExpand}>
          <span aria-hidden>⤢</span>
          <b>Expand</b>
          <span>{events.length} events</span>
          <small>{from}</small>
          <small>–</small>
          <small>{to}</small>
        </button>
      </div>
    </div>
  );
}

/** The menu for a selected bubble. The scale bar then expands time around it. */
function BubbleMenu({ ev, resolved, at, onOpen, onClose }: {
  ev: TimelineEvent;
  resolved: ResolvedDate;
  at: [number, number, number];
  onOpen: () => void;
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
        <small className="bm-hint">Pick Years, Months, Weeks or Days on the scale bar to expand time around this event.</small>
      </div>
    </Html>
  );
}

/** Everything inside the 3D canvas: camera, animations, level-of-detail planner and the river. */
function Scene(props: Props & { fan: FanState; setFan: (f: FanState) => void }) {
  const { fan, setFan } = props;
  const { data, view, level, highlightId, selectedId, onSelect, mobile, showImported, onOpenEvent, onOpenEntity } = props;
  const { camera, size, gl } = useThree();
  const rig = mobile ? RIG.mobile : RIG.desktop;

  // ---- The scale being drawn, and the animation between scales ----
  const target = useMemo(() => makeScale(currentWindow(view.change.stack)), [view.change.stack]);
  const [display, setDisplay] = useState<TimeScale>(target); // what's on screen right now
  const displayRef = useRef(display);
  const pose = useRef<CameraPose>({ s: props.targetS, latC: 0, latL: 0 });
  const trans = useRef<{ from: TimeScale; to: TimeScale; start: CameraPose; aFrom: number; aTo: number; t0: number } | null>(null);
  const lastSeq = useRef(view.seq);
  const lastReported = useRef(Number.NaN);
  const sideways = useRef(0);
  const targetRef = useRef(props.targetS);
  targetRef.current = props.targetS;

  // A new request starts an animation from whatever is on screen now (even mid-animation).
  useLayoutEffect(() => {
    if (view.seq === lastSeq.current) return;
    lastSeq.current = view.seq;
    const { aFrom, aTo } = anchorMoments(view.change.anchor, pose.current, displayRef.current);
    trans.current = { from: displayRef.current, to: target, start: { ...pose.current }, aFrom, aTo, t0: performance.now() };
  }, [view.seq, view.change.anchor, target]);

  // Slide the camera towards the highlighted item's lane: most of the way on phones, a little on desktop.
  const byId = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events]);
  // A personal lane is beyond a phone's screen, so on phones the camera goes all the way to it.
  // `sideFocus` (a lane chosen in the legend) wins over the highlighted item.
  const focusItem = highlightId ? (byId.get(highlightId) ?? data.entities.find((e) => e.id === highlightId)) : undefined;
  const autoSide = focusItem ? laneX(focusItem) * (mobile ? (focusItem.space ? 1 : 0.8) : 0.3) : 0;
  const sidewaysTarget = props.sideFocus ?? autoSide;

  /** Put the camera where `pose` says, for the scale currently drawn, and report the time there. */
  const applyCamera = () => {
    const f = cameraFrame(pose.current, displayRef.current, rig, sideways.current);
    camera.position.set(...f.position);
    camera.lookAt(...f.look);
    camera.updateMatrixWorld(); // so labels placed this frame use the new camera too
    const s = pose.current.s;
    if (!(Math.abs(s - lastReported.current) < 0.02)) {
      lastReported.current = s;
      props.onCameraTime(cameraTime(pose.current, displayRef.current));
    }
  };

  // During an animation each new scale is drawn by React a moment after we choose it. The
  // matching camera pose waits here (`pending`) and is applied in the same update that moves
  // the bubbles, so the camera and the river never get out of step (that would jitter).
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
      const u = (performance.now() - t.t0) / EXPAND_MS;
      const e = easeOut(u);
      const scaleNow = u >= 1 ? t.to : blendScales(t.from, t.to, e);
      const poseNow = transitionPose(t.start, t.from, scaleNow, t.aFrom, t.aTo, u >= 1 ? 1 : e, rig);
      pending.current = { scale: scaleNow, pose: poseNow };
      setDisplay(scaleNow); // the camera follows in the layout effect, together with the bubbles
      if (u >= 1) {
        trans.current = null;
        props.setTargetS(poseNow.s); // stay exactly here afterwards
        targetRef.current = poseNow.s;
      }
      return;
    }
    // Normal travel: ease towards the target.
    pose.current.s += (targetRef.current - pose.current.s) * Math.min(1, dt * 3);
    applyCamera();
  });

  // ---- Dates, importance and which events are drawn ----
  const resolved = useMemo(() => new Map(data.events.map((e) => [e.id, resolveEventDate(e, data)])), [data]);
  const importance = useMemo(() => importanceMap(data), [data]);
  const events = useMemo(() => (showImported ? data.events : data.events.filter((e) => e.provenance?.importedFrom !== 'wikidata')), [data.events, showImported]);
  const win = display.window;
  const outside = useMemo(() => new Set(events.filter((e) => !inside(win, resolved.get(e.id)!.date.best)).map((e) => e.id)), [events, resolved, win]);

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
      if (outside.has(ev.id)) continue; // drawn as dim dots, never bubbles
      tmp.set(...place(scale, resolved.get(ev.id)!.date.best, laneX(ev), 0.6));
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

  // ---- Fan-out rings and the bubble menu ----
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const posOf = (id: string) => place(display, resolved.get(id)!.date.best, laneX(byId.get(id)!), 0.6);

  const bubbleClick = (id: string) => {
    const stack = overlapping(planRef.current, id);
    onSelect(null);
    if (stack.length) {
      // Overlapping: fan them out, earliest first (they go round clockwise from the top).
      const sorted = [...stack].sort((a, b) => resolved.get(a)!.date.best - resolved.get(b)!.date.best);
      setFan({ ids: sorted, at: posOf(id) });
    } else {
      setFan(null);
      onSelect(id);
    }
  };

  // The menu closes on a click elsewhere, Escape, or scrolling. The ring does NOT close on a
  // scroll: while it's open the river is locked (see River below), so scrolling never loses it.
  // Only its dim backdrop, its ✕, Escape or picking something closes it.
  useEffect(() => {
    if (!selectedId && !fan) return;
    const outsideClick = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest('.fan, .fan-sheet, .bubble-menu, .scene-dim')) onSelect(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFan(null); onSelect(null); } };
    window.addEventListener('pointerdown', outsideClick, true);
    window.addEventListener('wheel', outsideClick, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', outsideClick, true);
      window.removeEventListener('wheel', outsideClick, true);
      window.removeEventListener('keydown', esc);
    };
  }, [selectedId, fan, onSelect, setFan]);
  useEffect(() => { setFan(null); }, [view.seq, setFan]);

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

  const faint = useMemo(() => new Set(plan.faint), [plan]);
  const selectedEv = selectedId ? byId.get(selectedId) : undefined;
  const fanEvents = fan ? fan.ids.map((id) => byId.get(id)!).filter(Boolean) : [];

  return (
    <>
      <color attach="background" args={['#05070f']} />
      <fog attach="fog" args={['#05070f', 20, 90]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 10, 0]} intensity={1} />
      <Stars radius={150} depth={60} count={3000} factor={4} fade speed={0.5} />
      <Lanes scale={display} spaces={props.spaces} />
      <Particles />
      <Ticks scale={display} />
      <EndCaps scale={display} mobile={mobile} onContinue={props.onContinue} onCollapse={props.onCollapse} />

      {plan.bubbles.map(({ id, showLabel }) => {
        const ev = byId.get(id);
        if (!ev || outside.has(id)) return null;
        const r = resolved.get(id)!;
        return (
          <group key={id}>
            <EventNode ev={ev} resolved={r} scale={display} onClick={() => bubbleClick(id)} highlighted={highlightId === id} selected={selectedId === id} showLabel={showLabel} mobile={mobile} cursor={cursor} />
            {spanVisible(r.date, display) && <UncertaintySpan resolved={r} lane={laneX(ev)} color={colorOf(ev)} y={0.6} scale={display} dim={!!ev.provenance} />}
          </group>
        );
      })}

      <FaintDots events={events} faint={faint} outside={outside} resolved={resolved} scale={display} mobile={mobile} onSelect={(id) => { setFan(null); onSelect(id); }} />

      {data.entities.filter((en) => !en.space?.undated /* no birth date: nowhere to draw them */).map((en) => (
        <EntityNode key={en.id} en={en} scale={display} onOpen={() => onOpenEntity(en.id)} highlighted={highlightId === en.id} mobile={mobile} outside={!inside(win, en.founded.best)} />
      ))}

      {fan && !mobile && (
        <FanRing
          events={fanEvents}
          resolved={resolved}
          at={fan.at}
          onPick={(id) => { setFan(null); onSelect(id); }}
          onExpand={() => { setFan(null); props.onExpandCluster(fan.ids); }}
        />
      )}
      {selectedEv && !fan && (
        <BubbleMenu
          ev={selectedEv}
          resolved={resolved.get(selectedEv.id)!}
          at={posOf(selectedEv.id)}
          onOpen={() => { onSelect(null); onOpenEvent(selectedEv.id); }}
          onClose={() => onSelect(null)}
        />
      )}
    </>
  );
}

export function River(props: Props) {
  const { setTargetS, mobile, view, onStep } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const topicOpen = useRef(false);
  topicOpen.current = !!props.topic;
  const scale = useMemo(() => makeScale(currentWindow(view.change.stack)), [view.change.stack]);
  // The fanned-out cluster lives here (not in the 3D scene) so the page-level dim layer can see it.
  const [fan, setFan] = useState<FanState>(null);
  const fanOpen = useRef(false);
  fanOpen.current = !!fan;

  // Scroll / drag / swipe / arrow keys travel through time; + / − step the scale bar.
  // While a cluster is fanned out, the river is locked: scrolling or swiping moves the list
  // of events instead, so you can reach every one (and the expand button) without losing it.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const clamp = (s: number) => Math.max(scale.sMin, Math.min(scale.sMax, s));
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const onWheel = (e: WheelEvent) => {
      if (fanOpen.current) return; // let the event list scroll instead
      e.preventDefault();
      setTargetS((s) => clamp(s + e.deltaY * 0.015));
    };
    let lastY: number | null = null;
    const down = (e: PointerEvent) => { lastY = fanOpen.current ? null : e.clientY; };
    const move = (e: PointerEvent) => {
      if (lastY === null) return;
      const d = lastY - e.clientY;
      lastY = e.clientY;
      setTargetS((s) => clamp(s + d * (mobile ? 0.25 : 0.15)));
    };
    const up = () => { lastY = null; };
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || topicOpen.current || fanOpen.current) return; // not while typing, or while a map or event list is open
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
        {props.topic ? <TopicScene {...props.topic} /> : <Scene {...props} fan={fan} setFan={setFan} />}
      </Canvas>
      {/* While a cluster is fanned out, dim everything else; a click on the dim closes the ring. */}
      {fan && !props.topic && <div className="scene-dim" onPointerDown={() => setFan(null)} />}
      {fan && !props.topic && mobile && (
        <FanSheet
          data={props.data}
          ids={fan.ids}
          onClose={() => setFan(null)}
          onPick={(id) => { setFan(null); props.onSelect(id); }}
          onExpand={() => { setFan(null); props.onExpandCluster(fan.ids); }}
        />
      )}
    </div>
  );
}
