// An invisible sphere that grows when its object is far away, so it's always at least
// `minPx` pixels (radius) on screen — easy to tap even when the visible bubble is tiny.
// 22px radius = the 44px minimum tap size on phones. Used by the main river and topic rivers.
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

/** Minimum tap-target radius in screen pixels. */
export const MIN_TAP_RADIUS = { mobile: 22, desktop: 9 };

export function HitArea({ radius, minPx, onClick, onOver, onOut }: {
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
