import { Html, Line, Stars } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Dataset } from '../types';
import { FIELDS } from '../types';
import { FIELD_COLOR, formatYear, laneOffset, position, riverX, sToYear, S_MAX, S_MIN, yearToS } from '../lib/time';

interface Props {
  data: Dataset;
  targetS: number;
  setTargetS: (s: number | ((s: number) => number)) => void;
  onYear: (y: number) => void;
  onOpenEvent: (id: string) => void;
  onOpenEntity: (id: string) => void;
  highlightId?: string;
  mobile: boolean;
}

const TICKS = [-3000, -2000, -1000, 0, 500, 1000, 1500, 1700, 1800, 1900, 1950, 1980, 2000, 2010, 2020, 2025];

function CameraRig({ targetS, onYear, mobile }: { targetS: number; onYear: (y: number) => void; mobile: boolean }) {
  const { camera } = useThree();
  const s = useRef(targetS);
  const look = useMemo(() => new THREE.Vector3(), []);
  const lastYear = useRef(0);

  useFrame((_, dt) => {
    s.current += (targetS - s.current) * Math.min(1, dt * 3);
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

function EventNode({ ev, onOpen, highlighted }: { ev: Dataset['events'][number]; onOpen: () => void; highlighted: boolean }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<THREE.Mesh>(null);
  const hasMap = ev.topicIds.length > 0;
  const pos = position(ev.at, ev.field, 0.6);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar((hover || highlighted ? 1.5 : 1) + Math.sin(clock.elapsedTime * 2 + ev.at) * 0.08);
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
          <span>{formatYear(ev.at)}</span> {ev.title}
          {hasMap && <em> · {ev.topicIds.length} debates</em>}
        </div>
      </Html>
    </group>
  );
}

function EntityNode({ en, onOpen, highlighted }: { en: Dataset['entities'][number]; onOpen: () => void; highlighted: boolean }) {
  const [hover, setHover] = useState(false);
  const pos = position(en.foundedAt, en.field, -0.1);
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
          <div className="en-label">{en.name} <span>· founded {formatYear(en.foundedAt)}</span></div>
        </Html>
      )}
    </group>
  );
}

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

export function River({ data, targetS, setTargetS, onYear, onOpenEvent, onOpenEntity, highlightId, mobile }: Props) {
  const wrap = useRef<HTMLDivElement>(null);

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
        {data.events.map((ev) => (
          <EventNode key={ev.id} ev={ev} onOpen={() => onOpenEvent(ev.id)} highlighted={highlightId === ev.id} />
        ))}
        {data.entities.map((en) => (
          <EntityNode key={en.id} en={en} onOpen={() => onOpenEntity(en.id)} highlighted={highlightId === en.id} />
        ))}
      </Canvas>
    </div>
  );
}
