// The topic river: a single river shown behind the claim map, holding only the events
// related to what you're looking at (src/lib/related.ts → topicRiver).
//
// Stops are spaced evenly in date order, like stations on a line, so gliding moves you
// from one event to the next (each stop is labelled with its real date). Arcs above the
// water show the typed links between stops ("led to", "part of"…). Where another topic
// river crosses — a stop with related events that aren't on this river — a side stream
// branches off with a button to switch onto it.
//
// The camera glides to `pos` (a stop number, can be fractional while gliding).
import { Html, Line, QuadraticBezierLine, Stars } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Dataset, LinkType } from '../types';
import { colorOf } from '../lib/time';
import { formatShort } from '../lib/dates';
import { resolveEventDate } from '../lib/dateDispute';
import { LINK_WORDS, type TopicRiver as TopicRiverModel } from '../lib/related';
import { HitArea, MIN_TAP_RADIUS } from './HitArea';

/** World units between stops. */
export const STOP_SPACING = 9;
/** Colour per link type, shared with the claim map's link list. */
export const LINK_COLOR: Record<LinkType, string> = { caused: '#ff7a59', led_to: '#7aa2ff', part_of: '#3ddc97', response_to: '#f5b83d' };

/** Gentle meander for the topic river (narrower than the main river's). */
const meander = (s: number) => Math.sin(s * 0.06) * 3;
const at = (i: number, y = 0): [number, number, number] => {
  const s = i * STOP_SPACING;
  return [meander(s), y, -s];
};

export interface TopicProps {
  data: Dataset;
  river: TopicRiverModel;
  pos: number; // current position, in stops
  mobile: boolean;
  onPick: (index: number) => void; // glide to a stop
  onBranch: (eventId: string) => void; // switch onto the river crossing at this stop
}

/** Follows `pos` smoothly. Sits behind and above the current stop, looking down the river. */
function TopicCamera({ pos, mobile }: { pos: number; mobile: boolean }) {
  const { camera } = useThree();
  const s = useRef(pos * STOP_SPACING);
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    s.current += (pos * STOP_SPACING - s.current) * Math.min(1, dt * 4);
    const back = mobile ? 7 : 11;
    const height = mobile ? 12 : 5.5;
    camera.position.set(meander(s.current - back), height, -(s.current - back));
    look.set(meander(s.current + 4), 0, -(s.current + 4));
    camera.lookAt(look);
  });
  return null;
}

/** The water and a single glowing lane, from just before the first stop to just after the last. */
function TopicWater({ length }: { length: number }) {
  const { water, lane } = useMemo(() => {
    const verts: number[] = [];
    const idx: number[] = [];
    const lane: [number, number, number][] = [];
    let i = 0;
    for (let s = -14; s <= length + 20; s += 1, i++) {
      verts.push(meander(s) - 4, -0.4, -s, meander(s) + 4, -0.4, -s);
      lane.push([meander(s), 0, -s]);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    return { water: g, lane };
  }, [length]);
  useEffect(() => () => water.dispose(), [water]);
  return (
    <group>
      <mesh geometry={water}>
        <meshBasicMaterial color="#1a2f6b" transparent opacity={0.45} side={THREE.DoubleSide} />
      </mesh>
      <Line points={lane} color="#7aa2ff" lineWidth={2} transparent opacity={0.7} />
    </group>
  );
}

export function TopicScene({ data, river, pos, mobile, onPick, onBranch }: TopicProps) {
  const current = Math.round(pos);
  const indexOf = useMemo(() => new Map(river.stops.map((s, i) => [s.eventId, i])), [river]);
  const branchAt = useMemo(() => new Map(river.branches.map((b) => [b.eventId, b.newEvents])), [river]);
  const minPx = mobile ? MIN_TAP_RADIUS.mobile : MIN_TAP_RADIUS.desktop;

  // Links whose both ends are on this river, drawn as arcs between their stops.
  const arcs = useMemo(
    () =>
      data.links
        .filter((l) => indexOf.has(l.from) && indexOf.has(l.to))
        .map((l) => ({ link: l, a: indexOf.get(l.from)!, b: indexOf.get(l.to)! })),
    [data.links, indexOf],
  );

  return (
    <>
      <color attach="background" args={['#05070f']} />
      <fog attach="fog" args={['#05070f', 18, 75]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 10, 0]} intensity={1} />
      <Stars radius={150} depth={60} count={2000} factor={4} fade speed={0.5} />
      <TopicCamera pos={pos} mobile={mobile} />
      <TopicWater length={(river.stops.length - 1) * STOP_SPACING} />

      {arcs.map(({ link, a, b }) => {
        const [ax, , az] = at(a, 0.6);
        const [bx, , bz] = at(b, 0.6);
        const lift = 1.6 + Math.abs(b - a) * 0.8;
        const mid: [number, number, number] = [(ax + bx) / 2, 0.6 + lift, (az + bz) / 2];
        return (
          <group key={link.id}>
            <QuadraticBezierLine start={[ax, 0.6, az]} end={[bx, 0.6, bz]} mid={mid} color={LINK_COLOR[link.type]} lineWidth={2} transparent opacity={0.75} />
            <Html position={[mid[0], mid[1] * 0.75 + 0.3, mid[2]]} center distanceFactor={12} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
              <div className="arc-label" style={{ color: LINK_COLOR[link.type] }}>{LINK_WORDS[link.type].out}{link.demo ? ' · demo' : ''}</div>
            </Html>
          </group>
        );
      })}

      {river.stops.map((stop, i) => {
        const ev = data.events.find((e) => e.id === stop.eventId);
        if (!ev) return null;
        const isCurrent = i === current;
        const isAnchor = stop.eventId === river.anchorId;
        const branch = branchAt.get(stop.eventId);
        const p = at(i, 0.6);
        const r = isCurrent ? 0.7 : 0.45;
        return (
          <group key={stop.eventId} position={p}>
            <mesh>
              <sphereGeometry args={[r, 24, 24]} />
              <meshStandardMaterial color={colorOf(ev)} emissive={isCurrent ? '#ffe066' : colorOf(ev)} emissiveIntensity={isCurrent ? 1.6 : 0.9} />
            </mesh>
            {isAnchor && (
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[r + 0.35, 0.04, 8, 48]} />
                <meshBasicMaterial color="#ffffff" transparent opacity={0.7} />
              </mesh>
            )}
            <HitArea radius={r * 1.2} minPx={minPx} onClick={() => onPick(i)} />
            <Html position={[0, r + 0.7, 0]} center distanceFactor={12} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <div className={`ev-label ${isCurrent ? 'highlighted' : ''}`}>
                <span>{formatShort(resolveEventDate(ev, data).date)}</span> {ev.title}
              </div>
            </Html>
            {branch !== undefined && <BranchStub count={branch} onSwitch={() => onBranch(stop.eventId)} title={ev.title} />}
          </group>
        );
      })}
    </>
  );
}

/** A side stream splitting off at a branch point, with a button to switch onto that river. */
function BranchStub({ count, onSwitch, title }: { count: number; onSwitch: () => void; title: string }) {
  const [hover, setHover] = useState(false);
  const end: [number, number, number] = [4.5, -0.2, -2.5];
  return (
    <group>
      <QuadraticBezierLine start={[0, -0.2, 0]} end={end} mid={[2.5, -0.3, 0.3]} color="#b48cff" lineWidth={hover ? 3 : 2} transparent opacity={0.8} dashed dashSize={0.4} gapSize={0.25} />
      <Html position={end} center distanceFactor={12} zIndexRange={[7, 0]}>
        <button
          className="branch-btn"
          onClick={onSwitch}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          aria-label={`Switch to the topic river through ${title}: ${count} more events`}
        >
          ⑂ {count} more
        </button>
      </Html>
    </group>
  );
}
