// Moving the camera smoothly while the river's timescale changes.
//
// Every change of level or expansion (src/lib/viewStack.ts) names an *anchor*: the moment
// the camera should end up at. Over about half a second we blend the old scale into the
// new one (blendScales) and, on every frame, place the camera with transitionPose:
//
//   • the anchor glides from where it is on screen to the camera's own spot, so the camera
//     arrives at it exactly when the animation ends
//   • for "stay where you are" changes (going back, collapsing) the anchor *is* the moment
//     at the camera, so the camera simply keeps showing that moment while the river around
//     it stretches or squeezes
//   • for Continue, the anchor slides by the window's length, so the river slides past
//   • sideways, the camera starts exactly where it was and eases over to the middle of the
//     river by the end — no sudden sideways hop
//
// At the very first frame the camera is exactly where it was, and at the last it's exactly
// on the anchor, so nothing ever jumps. All of this is plain maths, tested directly in
// cameraAnchor.test.ts.
import type { Year } from '../types';
import { riverX, yearToS } from './time';
import type { TimeScale } from './timeScale';

/** Camera placement relative to the point it follows. */
export interface Rig {
  back: number; // how far behind the followed point the camera sits
  height: number; // how high above the water
  ahead: number; // how far ahead of the followed point it looks
}

/**
 * Desktop flies low along the river, looking ahead. Phones look steeply down at the point
 * they follow (the "dive"), so that point sits in the middle of the screen, clear of the
 * footer. The big date readout always shows the time at that followed point.
 */
export const RIG: Record<'desktop' | 'mobile', Rig> = {
  desktop: { back: 14, height: 5, ahead: 12 },
  mobile: { back: 10, height: 14, ahead: 0 },
};

/** How long a level change or expansion animates, in milliseconds. */
export const EXPAND_MS = 500;

/** Ease-out: starts quickly and settles gently (u from 0 to 1). */
export const easeOut = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);

/**
 * The river's sideways wiggle at a moment in time. It depends only on the year (via the
 * full-river scale), so expanding time never moves an event sideways.
 */
export const meander = (year: Year) => riverX(yearToS(year));

/**
 * Where the camera is: `s` is the distance along the river it follows (in the current
 * scale's units). `latC` and `latL` are small sideways offsets for the camera and the
 * point it looks at, used only while a transition eases sideways (0 the rest of the time).
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

/** The time at the camera — what the big date readout shows. */
export const cameraTime = (pose: CameraPose, scale: TimeScale) => scale.toYear(pose.s);

/**
 * The camera pose part-way through a transition.
 *   start    — the pose when the transition began (with scale `from`)
 *   now      — the scale for this frame (a blend of `from` and the target)
 *   aFrom    — the anchor moment at the start; aTo — at the end (they differ only for Continue)
 *   e        — eased progress, 0 → 1
 */
export function transitionPose(start: CameraPose, from: TimeScale, now: TimeScale, aFrom: Year, aTo: Year, e: number, rig: Rig): CameraPose {
  // How far ahead of the camera the anchor was at the start; this shrinks to 0.
  const depth0 = from.toS(aFrom) - start.s;
  const anchor = aFrom + (aTo - aFrom) * e;
  const s = now.toS(anchor) - depth0 * (1 - e);
  // Sideways: start exactly where we were, ease to the river's middle by the end.
  const before = cameraFrame(start, from, rig);
  const camMid = meander(now.toYear(s - rig.back));
  const lookMid = meander(now.toYear(s + rig.ahead));
  return { s, latC: (before.position[0] - camMid) * (1 - e), latL: (before.look[0] - lookMid) * (1 - e) };
}

/** Resolve a view change's anchor into start and end moments for transitionPose. */
export function anchorMoments(anchor: { at: Year } | { camera: true; shift?: number }, pose: CameraPose, from: TimeScale): { aFrom: Year; aTo: Year } {
  if ('at' in anchor) return { aFrom: anchor.at, aTo: anchor.at };
  const here = cameraTime(pose, from);
  return { aFrom: here, aTo: here + (anchor.shift ?? 0) };
}
