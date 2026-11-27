// Tests for "expand in place": the anchored moment must not move on screen, and expanding
// then collapsing must put the camera back exactly where it was.
import { describe, expect, it } from 'vitest';
import { ymdToYear } from './dates';
import { anchorPose, cameraFrame, easeOut, relativeToCamera, RIG, type CameraPose } from './cameraAnchor';
import { blendScales, makeScale, windowFor } from './timeScale';

const sep1939 = ymdToYear(1939, 9, 1);
const normal = makeScale(null);
const months = makeScale(windowFor('months', sep1939));
const days = makeScale(windowFor('days', sep1939));
const close = (a: number[], b: number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

for (const [name, rig] of Object.entries(RIG)) {
  describe(`anchoring (${name})`, () => {
    // Camera somewhere before the anchor, as if you'd been looking at it from a little way back.
    const start: CameraPose = { s: normal.toS(sep1939) - 9, latC: 0, latL: 0 };

    it('keeps the anchored moment at the same place relative to the camera', () => {
      const before = relativeToCamera(sep1939, start, normal, rig);
      const expanded = anchorPose(start, normal, months, sep1939, rig);
      const after = relativeToCamera(sep1939, expanded, months, rig);
      close(after.fromCamera, before.fromCamera);
      close(after.lookDir, before.lookDir); // same viewing direction too, so same screen spot
    });

    it('keeps it fixed on every frame of the animation, not just at the end', () => {
      const before = relativeToCamera(sep1939, start, normal, rig);
      for (const u of [0.1, 0.35, 0.5, 0.8, 0.99]) {
        const mid = blendScales(normal, months, easeOut(u));
        const pose = anchorPose(start, normal, mid, sep1939, rig);
        close(relativeToCamera(sep1939, pose, mid, rig).fromCamera, before.fromCamera, 5);
      }
    });

    it('expanding then collapsing returns the exact same camera position', () => {
      const expanded = anchorPose(start, normal, months, sep1939, rig);
      const back = anchorPose(expanded, months, normal, sep1939, rig);
      expect(back.s).toBeCloseTo(start.s, 9);
      expect(back.latC).toBeCloseTo(0, 9);
      expect(back.latL).toBeCloseTo(0, 9);
      close(cameraFrame(back, normal, rig).position, cameraFrame(start, normal, rig).position, 9);
    });

    it('normal → months → days → months → normal is a round trip too', () => {
      const a = anchorPose(start, normal, months, sep1939, rig);
      const b = anchorPose(a, months, days, sep1939, rig);
      const c = anchorPose(b, days, months, sep1939, rig);
      const d = anchorPose(c, months, normal, sep1939, rig);
      expect(c.s).toBeCloseTo(a.s, 9);
      expect(d.s).toBeCloseTo(start.s, 9);
      close(cameraFrame(d, normal, rig).look, cameraFrame(start, normal, rig).look, 9);
    });

    it('works when the anchor is not the moment the camera follows', () => {
      // e.g. you double-clicked something further up the river.
      const anchor = ymdToYear(1939, 11, 30);
      const novDays = makeScale(windowFor('days', anchor)); // expanding around it shows November
      const before = relativeToCamera(anchor, start, normal, rig);
      const pose = anchorPose(start, normal, novDays, anchor, rig);
      close(relativeToCamera(anchor, pose, novDays, rig).fromCamera, before.fromCamera);
      close(relativeToCamera(anchor, pose, novDays, rig).lookDir, before.lookDir);
    });
  });
}

describe('blended scales', () => {
  it('slide each year smoothly between the two scales, and can be inverted', () => {
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const b = blendScales(normal, months, u);
      for (const y of [1900, 1939, sep1939, 1939.9, 1945]) {
        expect(b.toS(y)).toBeCloseTo(normal.toS(y) * (1 - u) + months.toS(y) * u, 9);
        expect(b.toYear(b.toS(y))).toBeCloseTo(y, 6);
      }
    }
  });

  it('ease-out starts fast and lands exactly', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
