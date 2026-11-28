// Glowing spans for uncertain and disputed dates on the 3D river.
//
// A span runs along the event's lane from the earliest to the latest possible moment:
// a thin glowing tube, plus a soft wide band on the water (which reads much better from
// the raised camera, because the river runs away from it and squashes long thin shapes).
// It's brightest at the best guess. Disputed dates glow amber with slowly moving stripes,
// and get a marker for each proposed date that is still standing.
//
// Spans are drawn with the current scale, so expanding a period stretches them out.
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Field, FuzzyDate } from '../types';
import { laneOffset } from '../lib/time';
import { meander } from '../lib/cameraAnchor';
import type { TimeScale } from '../lib/timeScale';
import type { ResolvedDate } from '../lib/dateDispute';
import { STATUS_COLOR } from '../lib/status';

/** Spans shorter than this (in river units) are too small to see, so we skip them. */
const MIN_SPAN_S = 0.06;
export const DISPUTED_COLOR = '#f5b83d';

/**
 * 3D point for a year in a lane, using the current scale. The sideways wiggle depends only
 * on the year (see cameraAnchor.ts), so expanding time never moves anything sideways.
 * The lane is a field, or a sideways offset already worked out (laneX() — e.g. a personal lane).
 */
export function place(scale: TimeScale, year: number, lane: Field | number, y = 0): [number, number, number] {
  return [meander(year) + (typeof lane === 'number' ? lane : laneOffset(lane)), y, -scale.toS(year)];
}

/** True if a date's range is long enough, at this zoom, to draw as a span. */
export const spanVisible = (d: FuzzyDate, scale: TimeScale) => scale.toS(d.latest) - scale.toS(d.earliest) >= MIN_SPAN_S;

// The glow is a tiny shader: brightness peaks at the best guess and fades towards the ends.
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

/** A flat strip lying on the water along a lane, from one year to another. */
function bandGeometry(scale: TimeScale, from: number, to: number, lane: Field | number, y: number, width: number) {
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    const [x, , z] = place(scale, from + ((to - from) * k) / steps, lane, y);
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

/** A glowing tube and band from the earliest to the latest possible date. */
export function UncertaintySpan({ resolved, lane, color: laneColor, y, scale, dim = false }: { resolved: ResolvedDate; lane: Field | number; color: string; y: number; scale: TimeScale; dim?: boolean }) {
  const { date, disputed } = resolved;
  const color = disputed ? DISPUTED_COLOR : laneColor;

  const { core, halo, band, materials } = useMemo(() => {
    // Sample points along the lane so the tube follows the river's curve.
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const yr = date.earliest + ((date.latest - date.earliest) * k) / 12;
      pts.push(new THREE.Vector3(...place(scale, yr, lane, y)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const s0 = scale.toS(date.earliest);
    const best = (scale.toS(date.best) - s0) / (scale.toS(date.latest) - s0);
    const materials = [
      spanMaterial(color, best, disputed, dim ? 0.5 : 1),
      spanMaterial(color, best, disputed, dim ? 0.15 : 0.35),
      spanMaterial(color, best, disputed, dim ? 0.25 : 0.7, true),
    ];
    return {
      core: new THREE.TubeGeometry(curve, 48, 0.12, 8, false),
      halo: new THREE.TubeGeometry(curve, 48, dim ? 0.25 : 0.45, 12, false),
      band: bandGeometry(scale, date.earliest, date.latest, lane, -0.3, dim ? 0.8 : 2),
      materials,
    };
  }, [date.earliest, date.latest, date.best, lane, y, color, disputed, dim, scale]);

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
            <mesh key={c.claim.id} position={place(scale, c.date.best, lane, -0.15)}>
              <sphereGeometry args={[0.2, 12, 12]} />
              <meshBasicMaterial color={STATUS_COLOR[c.status]} />
            </mesh>
          ))}
    </group>
  );
}
