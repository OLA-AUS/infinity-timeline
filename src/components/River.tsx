// The 3D river of time (React Three Fiber).
//
// What's drawn:
//   • Lanes       — one coloured line per field, following the river's meander
//   • Events      — glowing spheres; ringed ones have debates you can dive into
//   • Spans       — a glowing tube plus a soft glowing band on the water, from a date's earliest
//                   to latest possible moment, brightest at the best guess. Disputed dates glow
//                   amber with moving stripes, with a marker for each proposed date still standing.
//   • Imported    — events loaded from data/ (e.g. the Wikidata WW2 import) drawn as small
//                   dots in one batch, so hundreds of them stay fast. Hover for a label.
//   • Entities    — small diamonds where people and organisations were born or founded
// Scroll, drag, swipe or use the arrow keys to travel through time.
import { Html, Line, Stars } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Dataset, Field, FuzzyDate, TimelineEvent } from '../types';
import { FIELDS } from '../types';
import { FIELD_COLOR, laneOffset, position, riverX, sToYear, S_MAX, S_MIN, yearToS } from '../lib/time';
import { formatShort, formatYear } from '../lib/dates';
import { resolveEventDate, type ResolvedDate } from '../lib/dateDispute';
import { STATUS_COLOR } from '../lib/status';

interface Props {
  data: Dataset;
  targetS: number;
  setTargetS: (s: number | ((s: number) => number)) => void;
  onYear: (y: number) => void;
  onOpenEvent: (id: string) => void;
  onOpenEntity: (id: string) => void;
  highlightId?: string;
  mobile: boolean;
  showImported: boolean;
}

/** Years that get a big faint label beside the river. */
const TICKS = [-3000, -2000, -1000, 0, 500, 1000, 1500, 1700, 1800, 1900, 1950, 1980, 2000, 2010, 2020, 2025];

/** Spans shorter than this (in river units) are too small to see, so we skip them. */
const MIN_SPAN_S = 0.06;

const DISPUTED_COLOR = '#f5b83d';

/** Moves the camera smoothly towards the target point in time, and reports the current year. */
function CameraRig({ targetS, onYear, mobile }: { targetS: number; onYear: (y: number) => void; mobile: boolean }) {
  const { camera } = useThree();
  const s = useRef(targetS);
  const look = useMemo(() => new THREE.Vector3(), []);
  const lastYear = useRef(0);

  useFrame((_, dt) => {
    s.current += (targetS - s.current) * Math.min(1, dt * 3); // ease towards the target
    const cur = s.current;
    // Desktop: fly low along the river. Mobile "dive": higher and steeper, looking down the current.
    const back = mobile ? 6 : 14;
    const height = mobile ? 16 : 5;
    camera.position.set(riverX(cur - back), height, -(cur - back));
    look.set(riverX(cur + 12), 0, -(cur + 12));
    camera.lookAt(look);
    const y = sToYear(cur);
    if (Math.abs(y - lastYear.current) > 0.3) {
      lastYear.current = y;
      onYear(y);
    }
  });
  return null;
}

/** The translucent "water" ribbon plus one coloured line per field lane. */
function Lanes() {
  const lanes = useMemo(
    () =>
      FIELDS.map((f) => {
        const pts: [number, number, number][] = [];
        for (let s = S_MIN - 10; s <= S_MAX + 30; s += 2) pts.push([riverX(s) + laneOffset(f), 0, -s]);
        return { f, pts };
      }),
    [],
  );
  // A wide translucent ribbon for the "water", following the meander.
  const water = useMemo(() => {
    const verts: number[] = [];
    const idx: number[] = [];
    const half = 8;
    let i = 0;
    for (let s = S_MIN - 10; s <= S_MAX + 30; s += 1, i++) {
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
  }, []);
  return (
    <group>
      <mesh geometry={water}>
        <meshBasicMaterial color="#123063" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      {lanes.map(({ f, pts }) => (
        <Line key={f} points={pts} color={FIELD_COLOR[f]} lineWidth={1.5} transparent opacity={0.55} />
      ))}
    </group>
  );
}

/** Drifting specks of light, for a sense of flow. Purely decorative. */
function Particles() {
  const ref = useRef<THREE.Points>(null);
  const count = 1500;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const s = S_MIN + Math.random() * (S_MAX - S_MIN + 30);
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

// ---- Uncertain-date spans ---------------------------------------------------

// The glow is drawn by a tiny shader: brightness peaks at the best-guess point and
// fades towards the earliest/latest ends. Disputed spans get slowly moving stripes.
const SPAN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SPAN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBest;     // 0..1: where along the span the best guess sits
  uniform float uTime;
  uniform float uOpacity;
  uniform float uDisputed; // 0 or 1
  uniform float uBand;     // 1 for the flat band: fade out towards its side edges too
  varying vec2 vUv;
  void main() {
    float t = vUv.x; // 0 at the earliest end, 1 at the latest end
    float d = t < uBest ? (uBest - t) / max(uBest, 0.001) : (t - uBest) / max(1.0 - uBest, 0.001);
    float a = mix(0.25, 1.0, 1.0 - smoothstep(0.0, 1.0, d));
    a *= smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.92, t); // soft ends
    a *= mix(1.0, smoothstep(0.0, 0.6, 1.0 - abs(vUv.y * 2.0 - 1.0)), uBand); // soft sides (band only)
    float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + t * 6.0);
    float stripes = mix(1.0, 0.55 + 0.45 * step(0.5, fract(t * 10.0 - uTime * 0.4)), uDisputed);
    gl_FragColor = vec4(uColor, a * pulse * stripes * uOpacity);
  }
`;

function spanMaterial(color: string, best: number, disputed: boolean, opacity: number, band = false) {
  return new THREE.ShaderMaterial({
    vertexShader: SPAN_VERTEX,
    fragmentShader: SPAN_FRAGMENT,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uBest: { value: best },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uDisputed: { value: disputed ? 1 : 0 },
      uBand: { value: band ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * A flat strip lying on the water along a lane, from one year to another. Seen from the
 * camera's raised angle it reads much better than a thin tube, because the river runs
 * away from the camera and squashes anything long and thin.
 */
function bandGeometry(from: number, to: number, field: Field, y: number, width: number) {
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    const [x, , z] = position(from + ((to - from) * k) / steps, field, y);
    verts.push(x - width / 2, y, z, x + width / 2, y, z);
    uvs.push(k / steps, 0, k / steps, 1);
    if (k > 0) {
      const a = (k - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** True if a date's range is long enough on the river to draw as a span. */
const spanVisible = (d: FuzzyDate) => yearToS(d.latest) - yearToS(d.earliest) >= MIN_SPAN_S;

/** A glowing tube and band along the lane from the earliest to the latest possible date. */
function UncertaintySpan({ resolved, field, y, dim = false }: { resolved: ResolvedDate; field: Field; y: number; dim?: boolean }) {
  const { date, disputed } = resolved;
  const color = disputed ? DISPUTED_COLOR : FIELD_COLOR[field];

  const { core, halo, band, materials } = useMemo(() => {
    // Sample points along the lane so the tube follows the river's curve.
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const yr = date.earliest + ((date.latest - date.earliest) * k) / 12;
      pts.push(new THREE.Vector3(...position(yr, field, y)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const s0 = yearToS(date.earliest);
    const best = (yearToS(date.best) - s0) / (yearToS(date.latest) - s0);
    const materials = [
      spanMaterial(color, best, disputed, dim ? 0.5 : 1),
      spanMaterial(color, best, disputed, dim ? 0.15 : 0.35),
      spanMaterial(color, best, disputed, dim ? 0.25 : 0.7, true),
    ];
    return {
      core: new THREE.TubeGeometry(curve, 48, 0.12, 8, false),
      halo: new THREE.TubeGeometry(curve, 48, dim ? 0.25 : 0.45, 12, false),
      band: bandGeometry(date.earliest, date.latest, field, -0.3, dim ? 0.8 : 2),
      materials,
    };
  }, [date.earliest, date.latest, date.best, field, y, color, disputed, dim]);

  // Free GPU memory when the span goes away or changes.
  useEffect(() => () => {
    core.dispose();
    halo.dispose();
    band.dispose();
    materials.forEach((m) => m.dispose());
  }, [core, halo, band, materials]);

  useFrame(({ clock }) => {
    for (const m of materials) m.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <group>
      <mesh geometry={core} material={materials[0]} />
      <mesh geometry={halo} material={materials[1]} />
      <mesh geometry={band} material={materials[2]} />
      {/* One marker per proposed date still standing, on the band so the event sphere can't hide it. */}
      {disputed &&
        resolved.contenders
          .filter((c) => c.status === 'Contested')
          .map((c) => (
            <mesh key={c.claim.id} position={position(c.date.best, field, -0.15)}>
              <sphereGeometry args={[0.2, 12, 12]} />
              <meshBasicMaterial color={STATUS_COLOR[c.status]} />
            </mesh>
          ))}
    </group>
  );
}

// ---- Event and entity markers -------------------------------------------------

/** A curated event: glowing sphere, label, and a ring if it has debates. */
function EventNode({ ev, resolved, onOpen, highlighted }: { ev: TimelineEvent; resolved: ResolvedDate; onOpen: () => void; highlighted: boolean }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<THREE.Mesh>(null);
  const hasMap = ev.topicIds.length > 0;
  const debates = ev.topicIds.length;
  const pos = position(resolved.date.best, ev.field, 0.6);
  useFrame(({ clock }) => {
    // Gentle breathing; bigger when hovered or just jumped to.
    if (ref.current) ref.current.scale.setScalar((hover || highlighted ? 1.5 : 1) + Math.sin(clock.elapsedTime * 2 + resolved.date.best) * 0.08);
  });
  return (
    <group position={pos}>
      <mesh
        ref={ref}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}
      >
        <sphereGeometry args={[hasMap ? 0.5 : 0.32, 24, 24]} />
        <meshStandardMaterial color={FIELD_COLOR[ev.field]} emissive={FIELD_COLOR[ev.field]} emissiveIntensity={hasMap ? 1.6 : 0.8} />
      </mesh>
      {hasMap && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.85, 0.03, 8, 48]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
        </mesh>
      )}
      <Html position={[0, 1.1, 0]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`ev-label ${hasMap ? 'has-map' : ''}`}>
          <span>{formatShort(resolved.date)}</span> {ev.title}
          {resolved.disputed && <em className="disputed"> · date disputed</em>}
          {hasMap && <em> · {debates} debate{debates > 1 ? 's' : ''}</em>}
        </div>
      </Html>
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
 * Imported events, drawn as one instanced mesh (one draw call for hundreds of dots).
 * Their place along the river is their real date. The small sideways/up offset is only
 * there to stop dots on the same day sitting on top of each other.
 */
function ImportedEvents({ events, resolved, onOpen }: { events: TimelineEvent[]; resolved: Map<string, ResolvedDate>; onOpen: (id: string) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(
    () =>
      events.map((ev) => {
        const [x, , z] = position(resolved.get(ev.id)!.date.best, ev.field, 0);
        return new THREE.Vector3(x + (hash01(ev.id) - 0.5) * 1.6, 0.15 + hash01(ev.id, 7) * 1.4, z);
      }),
    [events, resolved],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    points.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // needed so clicks/hover find the instances
  }, [points]);

  if (events.length === 0) return null;
  const hovered = hover !== null ? events[hover] : undefined;
  return (
    <group>
      <instancedMesh
        key={events.length /* the instance count is fixed at creation */}
        ref={ref}
        args={[undefined, undefined, events.length]}
        onPointerMove={(e) => { e.stopPropagation(); setHover(e.instanceId ?? null); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(null); document.body.style.cursor = 'auto'; }}
        onClick={(e) => { e.stopPropagation(); if (e.instanceId !== undefined) onOpen(events[e.instanceId].id); }}
      >
        <sphereGeometry args={[0.1, 10, 10]} />
        <meshStandardMaterial color="#ffd2c4" emissive={FIELD_COLOR.politics} emissiveIntensity={0.7} />
      </instancedMesh>
      {hovered && (
        <Html position={points[hover!].toArray()} center distanceFactor={10} zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
          <div className="ev-label imported">
            <span>{formatShort(resolved.get(hovered.id)!.date)}</span> {hovered.title} <em>· Wikidata</em>
          </div>
        </Html>
      )}
    </group>
  );
}

/** A person or organisation, at the date they were born or founded. */
function EntityNode({ en, onOpen, highlighted }: { en: Dataset['entities'][number]; onOpen: () => void; highlighted: boolean }) {
  const [hover, setHover] = useState(false);
  const pos = position(en.founded.best, en.field, -0.1);
  return (
    <group position={pos}>
      <mesh
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}
        scale={highlighted ? 2.2 : hover ? 1.5 : 1}
      >
        <octahedronGeometry args={[0.22]} />
        <meshStandardMaterial color="#ffffff" emissive={highlighted ? '#ffe066' : '#8899aa'} emissiveIntensity={highlighted ? 2 : 0.6} />
      </mesh>
      {(hover || highlighted) && (
        <Html position={[0, 0.7, 0]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="en-label">{en.name} <span>· founded {formatShort(en.founded)}</span></div>
        </Html>
      )}
    </group>
  );
}

/** Big faint year labels beside the river. */
function Ticks() {
  return (
    <group>
      {TICKS.map((y) => {
        const s = yearToS(y);
        return (
          <Html key={y} position={[riverX(s) - 9, 0, -s]} center distanceFactor={18} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div className="tick">{formatYear(y)}</div>
          </Html>
        );
      })}
    </group>
  );
}

export function River({ data, targetS, setTargetS, onYear, onOpenEvent, onOpenEntity, highlightId, mobile, showImported }: Props) {
  const wrap = useRef<HTMLDivElement>(null);

  // Work out every event's date once per data change (this is where date disputes are applied).
  const resolved = useMemo(() => new Map(data.events.map((e) => [e.id, resolveEventDate(e, data)])), [data]);
  // Bulk imports with no debates attached are drawn as light dots; everything else gets a full node.
  const isBulk = (e: TimelineEvent) => e.provenance?.importedFrom === 'wikidata' && e.topicIds.length === 0;
  const curated = data.events.filter((e) => !isBulk(e));
  const imported = useMemo(() => (showImported ? data.events.filter(isBulk) : []), [data.events, showImported]);

  // Scroll / drag / swipe / keys move through time.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const clamp = (s: number) => Math.max(S_MIN, Math.min(S_MAX, s));
    const onWheel = (e: WheelEvent) => { e.preventDefault(); setTargetS((s) => clamp(s + e.deltaY * 0.015)); };
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
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setTargetS((s) => clamp(s + 5));
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setTargetS((s) => clamp(s - 5));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [setTargetS, mobile]);

  return (
    <div ref={wrap} className="river" style={{ touchAction: 'none' }}>
      <Canvas camera={{ fov: mobile ? 70 : 60, near: 0.1, far: 400 }} dpr={[1, 2]}>
        <color attach="background" args={['#05070f']} />
        <fog attach="fog" args={['#05070f', 20, 90]} />
        <ambientLight intensity={0.4} />
        <pointLight position={[0, 10, 0]} intensity={1} />
        <Stars radius={150} depth={60} count={3000} factor={4} fade speed={0.5} />
        <CameraRig targetS={targetS} onYear={onYear} mobile={mobile} />
        <Lanes />
        <Particles />
        <Ticks />
        {curated.map((ev) => (
          <EventNode key={ev.id} ev={ev} resolved={resolved.get(ev.id)!} onOpen={() => onOpenEvent(ev.id)} highlighted={highlightId === ev.id} />
        ))}
        {curated.filter((ev) => spanVisible(resolved.get(ev.id)!.date)).map((ev) => (
          <UncertaintySpan key={`span-${ev.id}`} resolved={resolved.get(ev.id)!} field={ev.field} y={0.6} />
        ))}
        <ImportedEvents events={imported} resolved={resolved} onOpen={onOpenEvent} />
        {imported.filter((ev) => spanVisible(resolved.get(ev.id)!.date)).map((ev) => (
          <UncertaintySpan key={`span-${ev.id}`} resolved={resolved.get(ev.id)!} field={ev.field} y={0.1} dim />
        ))}
        {data.entities.map((en) => (
          <EntityNode key={en.id} en={en} onOpen={() => onOpenEntity(en.id)} highlighted={highlightId === en.id} />
        ))}
      </Canvas>
    </div>
  );
}
