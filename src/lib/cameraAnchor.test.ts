// Tests for the camera during level changes and expansions: it never jumps, lands exactly
// on its anchor, and nested expand / collapse keep the camera at the right moment.
import { describe, expect, it } from 'vitest';
import { ymdToYear } from './dates';
import { anchorMoments, cameraFrame, cameraTime, easeOut, RIG, transitionPose, type CameraPose } from './cameraAnchor';
import { blendScales, makeScale, type TimeScale } from './timeScale';
import { chooseLevel, collapse, continueWindow, expandCluster, FULL_RIVER, type ViewChange } from './viewStack';

const full = makeScale(null);

/** Run a view change from `pose` with scale `from` to the end, returning every frame's camera. */
function run(change: ViewChange, pose: CameraPose, from: TimeScale, rig = RIG.desktop, steps = 100) {
  const to = makeScale(change.stack[change.stack.length - 1].window);
  const { aFrom, aTo } = anchorMoments(change.anchor, pose, from);
  const frames: { pose: CameraPose; scale: TimeScale }[] = [];
  for (let i = 0; i <= steps; i++) {
    const e = easeOut(i / steps);
    const scale = i === steps ? to : blendScales(from, to, e);
    frames.push({ pose: transitionPose(pose, from, scale, aFrom, aTo, e, rig), scale });
  }
  return { frames, end: frames[frames.length - 1], to };
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

for (const [name, rig] of Object.entries(RIG)) {
  describe(`transitions (${name})`, () => {
    const start: CameraPose = { s: full.toS(1937.2), latC: 0, latL: 0 };
    const cluster = [ymdToYear(1939, 5, 10), ymdToYear(1940, 7, 10), ymdToYear(1943, 6, 20)];

    it('the first frame is exactly where the camera already was (no jump at the start)', () => {
      const { frames } = run(expandCluster(FULL_RIVER, cluster), start, full, rig);
      const a = cameraFrame(start, full, rig);
      const b = cameraFrame(frames[0].pose, frames[0].scale, rig);
      expect(dist(a.position, b.position)).toBeLessThan(1e-9);
      expect(dist(a.look, b.look)).toBeLessThan(1e-9);
    });

    it('moves a little each frame — no frame jumps far ahead of the others', () => {
      const { frames } = run(expandCluster(FULL_RIVER, cluster), start, full, rig);
      const pts = frames.map((f) => cameraFrame(f.pose, f.scale, rig).position);
      const steps = pts.slice(1).map((p, i) => dist(p, pts[i]));
      const total = steps.reduce((a, b) => a + b, 0);
      // Ease-out makes early steps up to ~3× the average; anything much bigger would be a jump.
      expect(Math.max(...steps)).toBeLessThan((total / steps.length) * 4);
    });

    it('expanding a cluster lands the camera exactly on its first event, centred on the river', () => {
      const { end, to } = run(expandCluster(FULL_RIVER, cluster), start, full, rig);
      expect(cameraTime(end.pose, to)).toBeCloseTo(cluster[0], 9);
      expect(end.pose.latC).toBeCloseTo(0, 12);
      expect(end.pose.latL).toBeCloseTo(0, 12);
    });

    it('a scale-bar level lands on its anchor (here: 1 Jan of the year shown)', () => {
      const here = { s: full.toS(1941.6), latC: 0, latL: 0 };
      const change = chooseLevel(FULL_RIVER, 'years', cameraTime(here, full))!;
      const { end, to } = run(change, here, full, rig);
      expect(cameraTime(end.pose, to)).toBeCloseTo(ymdToYear(1941, 1, 1, 0), 9);
    });

    it('going back keeps the camera on the same moment the whole way', () => {
      const expanded = run(expandCluster(FULL_RIVER, cluster), start, full, rig);
      const t = cameraTime(expanded.end.pose, expanded.to);
      const back = run(collapse(expandCluster(FULL_RIVER, cluster).stack), expanded.end.pose, expanded.to, rig);
      for (const f of back.frames) expect(cameraTime(f.pose, f.scale)).toBeCloseTo(t, 6);
    });

    it('nested: expand, expand inside, collapse twice — the camera ends at the inner first event', () => {
      const outer = expandCluster(FULL_RIVER, cluster);
      const step1 = run(outer, start, full, rig);
      const innerEvents = [ymdToYear(1940, 7, 10), ymdToYear(1940, 9, 15), ymdToYear(1940, 10, 31)];
      const inner = expandCluster(outer.stack, innerEvents);
      const step2 = run(inner, step1.end.pose, step1.to, rig);
      expect(cameraTime(step2.end.pose, step2.to)).toBeCloseTo(innerEvents[0], 9);
      const back1 = run(collapse(inner.stack), step2.end.pose, step2.to, rig);
      const back2 = run(collapse(collapse(inner.stack).stack), back1.end.pose, back1.to, rig);
      expect(back2.to.window).toBeNull(); // back on the full river
      expect(cameraTime(back2.end.pose, back2.to)).toBeCloseTo(innerEvents[0], 6); // still at that moment
      expect(back2.end.pose.s).toBeCloseTo(full.toS(innerEvents[0]), 6);
    });

    it('Continue slides by exactly the window\'s length, keeping the same place within it', () => {
      const expanded = run(expandCluster(FULL_RIVER, cluster), start, full, rig);
      const stack = expandCluster(FULL_RIVER, cluster).stack;
      const w = stack[1].window!;
      const t = cameraTime(expanded.end.pose, expanded.to);
      const next = run(continueWindow(stack, 1)!, expanded.end.pose, expanded.to, rig);
      expect(cameraTime(next.end.pose, next.to)).toBeCloseTo(t + (w.end - w.start), 6);
      // Same distance from the window's start, on the river, before and after.
      expect(next.end.pose.s - next.to.toS(next.to.window!.start)).toBeCloseTo(expanded.end.pose.s - expanded.to.toS(w.start), 6);
    });
  });
}
