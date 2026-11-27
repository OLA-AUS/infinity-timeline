// Keeping the camera steady while the river's timescale changes ("expand in place").
//
// When you expand time around a moment, every year moves along the river. If the camera
// stayed at the same distance along the river it would suddenly be looking at a different
// time — a jolt. Instead we keep the chosen moment (the "anchor") exactly where it was on
// screen: before, during and after the change.
//
// What fixes a point's place on screen is where it is *relative to the camera*. So:
//   • depth:    keep the anchor the same distance ahead of the camera. If the anchor moves
//               from distance A to distance B along the river, the camera moves by B − A too.
//   • sideways: the river wiggles left and right (its "meander"). We make the wiggle a
//               property of the moment in time, not of the distance along the river, so the
//               anchor itself never moves sideways. The camera's own sideways position (and
//               the point it looks at) would change, though, because it now sits over a
//               different moment — so we add a correction ("lateral offset") that keeps
//               them exactly where they were. The correction fades out once you travel.
//
// All of this is plain maths with no 3D library, so it's tested directly
// (cameraAnchor.test.ts): expanding and then collapsing returns the exact same camera.
import type { Year } from '../types';
import { riverX, yearToS } from './time';
import type { TimeScale } from './timeScale';

/** Camera placement relative to the point it follows. */
export interface Rig {
  back: number; // how far behind the followed point the camera sits
  height: number; // how high above the water
  ahead: number; // how far ahead of the followed point it looks
}

/** Desktop flies low along the river; phones look down more steeply (the "dive"). */
export const RIG: Record<'desktop' | 'mobile', Rig> = {
  desktop: { back: 14, height: 5, ahead: 12 },
  mobile: { back: 6, height: 16, ahead: 12 },
};

/** How long an expand / collapse animation takes, in milliseconds. */
export const EXPAND_MS = 500;

/** Ease-out: starts quickly and settles gently (u from 0 to 1). */
export const easeOut = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);

/**
 * The river's sideways wiggle at a moment in time. It depends only on the year (via the
 * normal log scale), so expanding time never moves an event sideways. At normal zoom it's
 * exactly the old wiggle, riverX(s).
 */
export const meander = (year: Year) => riverX(yearToS(year));

/**
 * Where the camera is: `s` is the distance along the river it follows (in the current
 * scale's units). `latC` and `latL` are the sideways corrections for the camera position
 * and the point it looks at (0 when nothing has been expanded or collapsed recently).
 */
export interface CameraPose {
  s: number;
  latC: number;
  latL: number;
}

export interface CameraFrame {
  position: [number, number, number];
  look: [number, number, number];
}

/** Turn a pose into an actual camera position and look-at point, for a given scale. */
export function cameraFrame(pose: CameraPose, scale: TimeScale, rig: Rig, sideways = 0): CameraFrame {
  const camS = pose.s - rig.back;
  const lookS = pose.s + rig.ahead;
  return {
    position: [meander(scale.toYear(camS)) + pose.latC + sideways, rig.height, -camS],
    look: [meander(scale.toYear(lookS)) + pose.latL + sideways, 0, -lookS],
  };
}

/** Where a moment sits on the river (its centre line), for a given scale. */
export function riverPoint(year: Year, scale: TimeScale): [number, number, number] {
  return [meander(year), 0, -scale.toS(year)];
}

/**
 * The camera pose for scale `to` that keeps `anchorYear` exactly where it was on screen
 * with scale `from`. Use it for every frame of an animation (with a blended `to`) as well
 * as for the end result.
 */
export function anchorPose(pose: CameraPose, from: TimeScale, to: TimeScale, anchorYear: Year, rig: Rig): CameraPose {
  // Depth: keep the anchor the same distance ahead of the camera.
  const depth = from.toS(anchorYear) - pose.s;
  const s = to.toS(anchorYear) - depth;
  // Sideways: keep the camera and its look-at point at the same x as before.
  const before = cameraFrame(pose, from, rig);
  return {
    s,
    latC: before.position[0] - meander(to.toYear(s - rig.back)),
    latL: before.look[0] - meander(to.toYear(s + rig.ahead)),
  };
}

/** The anchor's position relative to the camera — identical before and after anchoring. */
export function relativeToCamera(year: Year, pose: CameraPose, scale: TimeScale, rig: Rig): { fromCamera: number[]; lookDir: number[] } {
  const f = cameraFrame(pose, scale, rig);
  const p = riverPoint(year, scale);
  return {
    fromCamera: [p[0] - f.position[0], p[1] - f.position[1], p[2] - f.position[2]],
    lookDir: [f.look[0] - f.position[0], f.look[1] - f.position[1], f.look[2] - f.position[2]],
  };
}

/** Once you travel, the sideways corrections fade out over roughly this much river. */
export const LATERAL_FADE = 30;
