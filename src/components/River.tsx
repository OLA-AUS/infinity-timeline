// The 3D river of time (React Three Fiber).
//
// What's drawn:
//   • Lanes     — one coloured line per field, following the river's meander
//   • Events    — glowing bubbles; ringed ones have debates you can dive into
//   • Clusters  — when bubbles would overlap on screen they merge into one bubble showing
//                 how many events it holds and a ring coloured by their fields. Click to
//                 zoom into the period they cover.
//   • Faint dots — events not important enough for the current zoom (src/lib/importance.ts).
//                 Zoom in and they become bubbles.
//   • Spans     — glowing ranges for uncertain and disputed dates (RiverSpans.tsx)
//   • Entities  — small diamonds where people and organisations were born or founded
//
// Time zoom (src/lib/timeScale.ts): pinch, Ctrl + scroll or the +/− keys zoom the timescale
// in and out a level (all time → century → decade → year → month → day). Clicking the
// water offers "Zoom into this period". The zoomed window is a straight stretch of river;
// time outside it is still there, squeezed.
//
// Travel: scroll, drag, swipe or the arrow keys.
import { Html, Line, Stars } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Dataset, TimelineEvent } from '../types';
import { FIELDS } from '../types';
import { FIELD_COLOR, laneOffset, riverX } from '../lib/time';
import { formatShort, formatYear } from '../lib/dates';
import { resolveEventDate, type ResolvedDate } from '../lib/dateDispute';
import { importanceMap, LOD_THRESHOLD } from '../lib/importance';
import { planKey, planScreen, type RiverPlan, type ScreenItem } from '../lib/cluster';
import {
  deeper,
  formatForLevel,
  windowFor,
  windowLabel,
  windowTicks,
  zoomForSpan,
  type TimeScale,
  type TimeWindow,
  type ZoomLevel,
} from '../lib/timeScale';
import { place, spanVisible, UncertaintySpan } from './RiverSpans';

interface Props {
  data: Dataset;
  scale: TimeScale;
  level: ZoomLevel;
  targetS: number;
  setTargetS: (s: number | ((s: number) => number)) => void;
  onYear: (y: number) => void;
  onOpenEvent: (id: string) => void;
  onOpenEntity: (id: string) => void;
  highlightId?: string;
  mobile: boolean;
  showImported: boolean;
  /** Zoom one level in (+1) or out (−1) around the year in view. */
  onZoomStep: (dir: 1 | -1) => void;
  /** Zoom to a particular window (null = all time), keeping `focusYear` in view. */
  onZoomTo: (w: TimeWindow | null, focusYear: number) => void;
}

/** Years that get a big faint label beside the river (when they're outside the zoom window). */
const TICKS = [-3000, -2000, -1000, 0, 500, 1000, 1500, 1700, 1800, 1900, 1950, 1980, 2000, 2010, 2020, 2025];

/**
 * The "focus": how far ahead of the camera the moment you're looking at sits. The HUD date,
 * zooming and "fly to" all use this point, so what you see in the middle of the screen is
 * the date shown. The phone camera looks down more steeply and its footer covers the bottom
 * of the screen, so its focus is further ahead.
 */
export const FOCUS_AHEAD = { desktop: 2, mobile: 15 };

/** How far ahead you can see (matches the fog). Events further away aren't planned. */
const VIEW_DISTANCE = 95;
/** Minimum tap-target radius in screen pixels: 22px radius = the 44px minimum on phones. */
const MIN_TAP_RADIUS = { mobile: 22, desktop: 9 };

/**
 * Moves the camera smoothly towards the target point in time, and reports the current year.
 * `sideways` slides the camera across towards one lane (used to bring a highlighted event
 * into view — on a narrow phone screen the outer lanes are near the edges).
 */
function CameraRig({ targetS, onYear, mobile, scale, sideways }: { targetS: number; onYear: (y: number) => void; mobile: boolean; scale: TimeScale; sideways: number }) {
  const { camera } = useThree();
  const s = useRef(targetS);
  const x = useRef(0);
  const look = useMemo(() => new THREE.Vector3(), []);
  const lastS = useRef(Number.NaN);
  const prevScale = useRef(scale);

  useFrame((_, dt) => {
    // When the zoom changes, every year moves along the river. Move the camera with it so
    // it stays at the same moment in time instead of flying somewhere else.
    if (prevScale.current !== scale) {
      s.current = scale.toS(prevScale.current.toYear(s.current));
      prevScale.current = scale;
      lastS.current = Number.NaN;
    }
    s.current += (targetS - s.current) * Math.min(1, dt * 3); // ease towards the target
    x.current += (sideways - x.current) * Math.min(1, dt * 2);
    const cur = s.current;
    // Desktop: fly low along the river. Mobile "dive": higher and steeper, looking down the current.
    const back = mobile ? 6 : 14;
    const height = mobile ? 16 : 5;
    camera.position.set(riverX(cur - back) + x.current, height, -(cur - back));
    look.set(riverX(cur + 12) + x.current, 0, -(cur + 12));
    camera.lookAt(look);
    if (!(Math.abs(cur - lastS.current) < 0.1)) {
      lastS.current = cur;
      onYear(scale.toYear(cur + (mobile ? FOCUS_AHEAD.mobile : FOCUS_AHEAD.desktop)));
    }
  });
  return null;
}

/** The translucent "water" plus one coloured line per field lane. Clicking the water offers to zoom. */
function Lanes({ scale, onWaterClick }: { scale: TimeScale; onWaterClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const from = scale.sMin - 10;
  const to = scale.sMax + 30;
  const lanes = useMemo(
    () =>
      FIELDS.map((f) => {
        const pts: [number, number, number][] = [];
        for (let s = from; s <= to; s += 2) pts.push([riverX(s) + laneOffset(f), 0, -s]);
        return { f, pts };
      }),
    [from, to],
  );
  // A wide translucent ribbon for the "water", following the meander.
  const water = useMemo(() => {
    const verts: number[] = [];
    const idx: number[] = [];
    const half = 8;
    let i = 0;
    for (let s = from; s <= to; s += 1, i++) {
      verts.push(riverX(s) - half, -0.4, -s, riverX(s) + half, -0.4, -s);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    return g;
  }, [from, to]);
  useEffect(() => () => water.dispose(), [water]);
  return (
    <group>
      <mesh geometry={water} onClick={onWaterClick}>
        <meshBasicMaterial color="#123063" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      {lanes.map(({ f, pts }) => (
        <Line key={f} points={pts} color={FIELD_COLOR[f]} lineWidth={1.5} transparent opacity={0.55} />
      ))}
    </group>
  );
}

/** Drifting specks of light, for a sense of flow. Purely decorative. */
function Particles({ scale }: { scale: TimeScale }) {
  const ref = useRef<THREE.Points>(null);
  const count = 1500;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const s = scale.sMin + Math.random() * (scale.sMax - scale.sMin + 30);
      arr[i * 3] = riverX(s) + (Math.random() - 0.5) * 16;
      arr[i * 3 + 1] = (Math.random() - 0.3) * 3;
      arr[i * 3 + 2] = -s;
    }
    return arr;
  }, [scale]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.position.z -= dt * 0.6;
    if (ref.current && ref.current.position.z < -20) ref.current.position.z = 0;
  });
  return (
    <points ref={ref} key={scale.sMin /* new buffer when the range changes */}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.08} color="#9fd3ff" transparent opacity={0.6} />
    </points>
  );
}

/** Year labels beside the river, plus finer ticks and "gates" marking the zoom window's edges. */
function Ticks({ scale }: { scale: TimeScale }) {
  const w = scale.window;
  const outside = TICKS.filter((y) => !w || y < w.start || y > w.end);
  const inside = windowTicks(w);
  const gate = (year: number, text: string) => {
    const s = scale.toS(year);
    return (
      <group key={`gate-${year}`}>
        <Line points={[[riverX(s) - 8, 0.02, -s], [riverX(s) + 8, 0.02, -s]]} color="#7aa2ff" lineWidth={2} transparent opacity={0.8} />
        <Html position={[riverX(s) + 9.5, 0.2, -s]} center distanceFactor={18} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="gate-label">{text}</div>
        </Html>
      </group>
    );
  };
  return (
    <group>
      {outside.map((y) => {
        const s = scale.toS(y);
        return (
          <Html key={y} position={[riverX(s) - 9, 0, -s]} center distanceFactor={18} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div className="tick">{formatYear(y)}</div>
          </Html>
        );
      })}
      {inside.map((t) => {
        const s = scale.toS(t.year);
        return (
          <group key={`in-${t.year}`}>
            <Line points={[[riverX(s) - 7.5, 0.01, -s], [riverX(s) - 6.5, 0.01, -s]]} color="#4d5875" lineWidth={1} />
            <Html position={[riverX(s) - 9, 0, -s]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <div className="tick small">{t.label}</div>
            </Html>
          </group>
        );
      })}
      {w && gate(w.start, `▶ ${windowLabel(w)}`)}
      {w && gate(w.end, `${windowLabel(w)} ◀`)}
    </group>
  );
}

/**
 * An invisible sphere that grows when the object is far away, so it's always at least
 * `minPx` pixels (radius) on screen — easy to tap even when the visible bubble is tiny.
 */
function HitArea({ radius, minPx, onClick, onOver, onOut }: {
  radius: number;
  minPx: number;
  onClick: () => void;
  onOver?: () => void;
  onOut?: () => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const { camera, size } = useThree();
  const wp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    m.getWorldPosition(wp);
    const dist = camera.position.distanceTo(wp);
    const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
    const worldPerPx = (2 * dist * Math.tan(fov / 2)) / size.height;
    m.scale.setScalar(Math.max(radius, minPx * worldPerPx));
  });
  return (
    <mesh
      ref={ref}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onOver?.(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { onOut?.(); document.body.style.cursor = 'auto'; }}
    >
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** One event as its own bubble. The label shows if there's room (or on hover / when highlighted). */
function EventNode({ ev, resolved, scale, onOpen, highlighted, showLabel, mobile }: {
  ev: TimelineEvent;
  resolved: ResolvedDate;
  scale: TimeScale;
  onOpen: () => void;
  highlighted: boolean;
  showLabel: boolean;
  mobile: boolean;
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef<THREE.Mesh>(null);
  const debates = ev.topicIds.length;
  const hasMap = debates > 0;
  const imported = ev.provenance?.importedFrom === 'wikidata';
  const radius = hasMap ? 0.5 : imported ? 0.26 : 0.32;
  useFrame(({ clock }) => {
    // Gentle breathing; bigger when hovered or just jumped to.
    if (ref.current) ref.current.scale.setScalar((hover || highlighted ? 1.5 : 1) + Math.sin(clock.elapsedTime * 2 + resolved.date.best) * 0.08);
  });
  return (
    <group position={place(scale, resolved.date.best, ev.field, 0.6)}>
      <mesh ref={ref}>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshStandardMaterial color={FIELD_COLOR[ev.field]} emissive={highlighted ? '#ffe066' : FIELD_COLOR[ev.field]} emissiveIntensity={highlighted ? 2 : hasMap ? 1.6 : 0.8} />
      </mesh>
      <HitArea radius={radius * 1.2} minPx={mobile ? MIN_TAP_RADIUS.mobile : MIN_TAP_RADIUS.desktop} onClick={onOpen} onOver={() => setHover(true)} onOut={() => setHover(false)} />
      {hasMap && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.85, 0.03, 8, 48]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
        </mesh>
      )}
      {(showLabel || hover || highlighted) && (
        <Html position={[0, radius + 0.6, 0]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`ev-label ${hasMap ? 'has-map' : ''} ${highlighted ? 'highlighted' : ''} ${imported ? 'imported' : ''}`}>
            <span>{formatShort(resolved.date)}</span> {ev.title}
            {resolved.disputed && <em className="disputed"> · date disputed</em>}
            {hasMap && <em> · {debates} debate{debates > 1 ? 's' : ''}</em>}
          </div>
        </Html>
      )}
    </group>
  );
}

/**
 * Several events whose bubbles would overlap, shown as one bubble with a count and a ring
 * split by field colours. Clicking zooms to the period they cover; at the deepest zoom
 * (one day) it lists them instead.
 */
function ClusterNode({ members, anchor, resolved, scale, level, mobile, showLabel, onZoomTo, onOpenEvent }: {
  members: TimelineEvent[];
  showLabel: boolean;
  anchor: TimelineEvent;
  resolved: Map<string, ResolvedDate>;
  scale: TimeScale;
  level: ZoomLevel;
  mobile: boolean;
  onZoomTo: (w: TimeWindow | null, focusYear: number) => void;
  onOpenEvent: (id: string) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const n = members.length;
  const radius = Math.min(0.75, 0.45 + 0.06 * Math.log2(n)); // grows a little with size, capped
  const years = members.map((m) => resolved.get(m.id)!.date.best);
  const from = Math.min(...years);
  const to = Math.max(...years);
  // How many members are in each field, for the coloured ring and the label's bar.
  const mix = FIELDS.map((f) => ({ f, count: members.filter((m) => m.field === f).length })).filter((x) => x.count > 0);
  let angle = Math.PI / 2;

  const open = () => {
    const target = zoomForSpan(from, to, level);
    if (target === undefined) setListOpen((o) => !o);
    else onZoomTo(target, (from + to) / 2);
  };

  return (
    <group position={place(scale, resolved.get(anchor.id)!.date.best, anchor.field, 0.6)}>
      <mesh>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshStandardMaterial color="#1c2744" emissive="#7aa2ff" emissiveIntensity={0.5} transparent opacity={0.9} />
      </mesh>
      {mix.map(({ f, count }) => {
        const arc = (count / n) * Math.PI * 2;
        const start = angle;
        angle += arc;
        return (
          <mesh key={f} rotation={[0, 0, start]}>
            <torusGeometry args={[radius + 0.12, 0.07, 6, 48, arc]} />
            <meshBasicMaterial color={FIELD_COLOR[f]} />
          </mesh>
        );
      })}
      <HitArea radius={radius * 1.2} minPx={mobile ? MIN_TAP_RADIUS.mobile : MIN_TAP_RADIUS.desktop} onClick={open} />
      {/* The count is always shown on the bubble; the fuller label only where there's room. */}
      <Html center distanceFactor={14} zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
        <div className="cluster-count">{n}</div>
      </Html>
      {(showLabel || listOpen) && (
        <Html position={[0, radius + 0.7, 0]} center distanceFactor={14} zIndexRange={[6, 0]} style={{ pointerEvents: listOpen ? 'auto' : 'none' }}>
          <div className="cluster-label">
            <div><b>{n}</b> events · {formatYear(from)}{Math.floor(to) !== Math.floor(from) ? `–${formatYear(to)}` : ''}</div>
            <div className="mix">{mix.map(({ f, count }) => <i key={f} style={{ flex: count, background: FIELD_COLOR[f] }} title={`${count} ${f}`} />)}</div>
            <small>{anchor.title} + {n - 1} more</small>
            {listOpen && (
              <ul className="cluster-list">
                {members.map((m) => (
                  <li key={m.id}><button onClick={() => onOpenEvent(m.id)}>{m.title}</button></li>
                ))}
              </ul>
            )}
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
 * Every event that isn't important enough for this zoom level, as one batch of small dots
 * (one draw call for hundreds). Dots not in the faint set are shrunk to nothing. The small
 * sideways/up offset only stops dots on the same day sitting on top of each other.
 * Hover shows a label on desktop. On phones the dots aren't tappable (they're far below
 * the 44px minimum) — zoom in and they become proper bubbles.
 */
function FaintDots({ events, faint, resolved, scale, mobile, onOpen }: {
  events: TimelineEvent[];
  faint: Set<string>;
  resolved: Map<string, ResolvedDate>;
  scale: TimeScale;
  mobile: boolean;
  onOpen: (id: string) => void;
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
      const p = points[i];
      const sc = faint.has(ev.id) ? 1 : 0;
      mesh.setMatrixAt(i, m.makeScale(sc, sc, sc).setPosition(p));
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
        onClick={(e) => { e.stopPropagation(); if (e.instanceId !== undefined && faint.has(events[e.instanceId].id)) onOpen(events[e.instanceId].id); }}
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

/** Everything inside the 3D canvas, including the level-of-detail planner. */
function Scene(props: Props) {
  const { data, scale, level, highlightId, mobile, showImported, onOpenEvent, onOpenEntity, onZoomTo } = props;
  const { camera, size } = useThree();

  // Dates (with disputes applied) and importance, worked out once per data change.
  const resolved = useMemo(() => new Map(data.events.map((e) => [e.id, resolveEventDate(e, data)])), [data]);
  const importance = useMemo(() => importanceMap(data), [data]);
  const events = useMemo(() => (showImported ? data.events : data.events.filter((e) => e.provenance?.importedFrom !== 'wikidata')), [data.events, showImported]);
  const byId = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events]);

  // ---- Level of detail: a few times a second, project events to the screen and plan them. ----
  const [plan, setPlan] = useState<RiverPlan>({ singles: [], clusters: [], faint: [] });
  const lastKey = useRef('');
  const sinceLast = useRef(1);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => { sinceLast.current = 1; }, [scale, level, highlightId, events, mobile]); // re-plan right away

  useFrame((_, dt) => {
    sinceLast.current += dt;
    if (sinceLast.current < 0.2) return;
    sinceLast.current = 0;
    const fovTan = Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360);
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
      // Screen pixels per world unit straight up at this spot (less than pxPerUnit when looking down).
      const upPx = Math.abs(up.y - tmp.y) * (size.height / 2);
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
        // These mirror where EventNode / ClusterNode draw their labels, so the planner can
        // tell which labels would collide. Sizes are measured from the CSS (13px text).
        labelW: ((ev.title.length + 10) * 6.8 + 18) * labelScale,
        labelH: 24 * labelScale,
        labelLift: (radius + 0.6) * upPx,
        clusterLabel: { w: 170 * labelScale, h: 62 * labelScale, lift: (0.6 + 0.7) * upPx },
      });
    }
    const p = planScreen(items, { minRadius: mobile ? MIN_TAP_RADIUS.mobile : MIN_TAP_RADIUS.desktop, gap: 3 });
    p.faint.push(...offscreen);
    const key = planKey(p);
    if (key !== lastKey.current) {
      lastKey.current = key;
      setPlan(p);
    }
  });

  // ---- "Zoom into this period" popup when you click the water. ----
  const [pop, setPop] = useState<{ s: number; year: number } | null>(null);
  useEffect(() => setPop(null), [scale]);
  const next = deeper(level);
  const onWaterClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || !next) return; // that was a drag, or we can't zoom any closer
    e.stopPropagation();
    const s = -e.point.z;
    setPop({ s, year: scale.toYear(s) });
  };

  const faint = useMemo(() => new Set(plan.faint), [plan]);

  // Slide the camera towards the highlighted item's lane: most of the way on phones, a little on desktop.
  const focusField = highlightId ? (byId.get(highlightId)?.field ?? data.entities.find((e) => e.id === highlightId)?.field) : undefined;
  const sideways = focusField ? laneOffset(focusField) * (mobile ? 0.8 : 0.3) : 0;

  return (
    <>
      <color attach="background" args={['#05070f']} />
      <fog attach="fog" args={['#05070f', 20, 90]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 10, 0]} intensity={1} />
      <Stars radius={150} depth={60} count={3000} factor={4} fade speed={0.5} />
      <CameraRig targetS={props.targetS} onYear={props.onYear} mobile={mobile} scale={scale} sideways={sideways} />
      <Lanes scale={scale} onWaterClick={onWaterClick} />
      <Particles scale={scale} />
      <Ticks scale={scale} />

      {plan.singles.map(({ id, showLabel }) => {
        const ev = byId.get(id);
        if (!ev) return null;
        const r = resolved.get(id)!;
        return (
          <group key={id}>
            <EventNode ev={ev} resolved={r} scale={scale} onOpen={() => onOpenEvent(id)} highlighted={highlightId === id} showLabel={showLabel} mobile={mobile} />
            {spanVisible(r.date, scale) && <UncertaintySpan resolved={r} field={ev.field} y={0.6} scale={scale} dim={!!ev.provenance} />}
          </group>
        );
      })}

      {plan.clusters.map((c) => (
        <ClusterNode
          key={c.memberIds.join('.')}
          members={c.memberIds.map((id) => byId.get(id)!).filter(Boolean)}
          anchor={byId.get(c.anchorId)!}
          resolved={resolved}
          scale={scale}
          level={level}
          mobile={mobile}
          showLabel={c.showLabel}
          onZoomTo={onZoomTo}
          onOpenEvent={onOpenEvent}
        />
      ))}

      <FaintDots events={events} faint={faint} resolved={resolved} scale={scale} mobile={mobile} onOpen={onOpenEvent} />

      {data.entities.map((en) => (
        <EntityNode key={en.id} en={en} scale={scale} onOpen={() => onOpenEntity(en.id)} highlighted={highlightId === en.id} mobile={mobile} />
      ))}

      {pop && next && (
        <Html position={[riverX(pop.s), 0.6, -pop.s]} center zIndexRange={[20, 0]}>
          <div className="zoom-pop">
            <span>{formatForLevel(pop.year, next)}</span>
            <button onClick={() => onZoomTo(windowFor(next, pop.year), pop.year)}>🔍 Zoom into {windowLabel(windowFor(next, pop.year))}</button>
            <button className="x" onClick={() => setPop(null)} aria-label="Close">✕</button>
          </div>
        </Html>
      )}
    </>
  );
}

export function River(props: Props) {
  const { setTargetS, mobile, scale, onZoomStep } = props;
  const wrap = useRef<HTMLDivElement>(null);
  // Keep the latest zoom callback without re-binding the listeners on every render.
  const zoomRef = useRef(onZoomStep);
  zoomRef.current = onZoomStep;

  // Scroll / drag / swipe / keys travel through time. Pinch, Ctrl+scroll and +/− zoom.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const clamp = (s: number) => Math.max(scale.sMin, Math.min(scale.sMax, s));
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

    // Zoom gestures arrive as many small steps; add them up and zoom one level once they're big enough.
    let zoomAcc = 0;
    let coolUntil = 0;
    const zoomNudge = (amount: number) => {
      const now = performance.now();
      if (now < coolUntil) return;
      zoomAcc += amount;
      if (Math.abs(zoomAcc) >= 1) {
        zoomRef.current(zoomAcc > 0 ? 1 : -1);
        zoomAcc = 0;
        coolUntil = now + 450; // one level per gesture, not five
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomNudge(-e.deltaY / 60); // Ctrl+scroll, or a trackpad pinch
      else setTargetS((s) => clamp(s + e.deltaY * 0.015));
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart = 0;
    const gap = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) pinchStart = gap();
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        // Two fingers: spreading apart by half again zooms in a level; pinching to two-thirds zooms out.
        const ratio = gap() / (pinchStart || 1);
        if (ratio > 1.5 || ratio < 0.67) {
          zoomRef.current(ratio > 1 ? 1 : -1);
          pinchStart = gap();
        }
        return;
      }
      const d = prev.y - e.clientY; // one finger / mouse: travel
      setTargetS((s) => clamp(s + d * (mobile ? 0.25 : 0.15)));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = 0;
    };
    const key = (e: KeyboardEvent) => {
      if (typing(e.target)) return; // don't steer the river while typing in the search box
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setTargetS((s) => clamp(s + 5));
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setTargetS((s) => clamp(s - 5));
      if (e.key === '+' || e.key === '=') zoomRef.current(1);
      if (e.key === '-' || e.key === '_') zoomRef.current(-1);
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
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
