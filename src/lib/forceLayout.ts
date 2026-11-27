// Force layout for the claim map.
//
// The map is a "star": one bubble in the middle, every other bubble linked to it by a line.
// We place the bubbles by simulating simple forces for a few hundred steps:
//   • springs pull each bubble to a comfortable distance from the centre
//   • bubbles and their labels push each other apart so nothing overlaps
//   • a label sitting on top of another bubble's line gets nudged sideways off it
//     (and the line's bubble is nudged the other way), so text never has a line through it
// Each label sits directly above its bubble (if the bubble is in the top half of the map)
// or directly below it (bottom half). The bubble's own line comes in from the centre, so it
// stops at the bubble and can never cross its own label. Keeping labels above/below rather
// than off to the side also keeps the map narrow, which matters on a portrait phone screen.
//
// It is deterministic (no randomness): the same map always gets the same layout,
// which keeps tests stable and stops the map jumping around between renders.

/** A rectangle given by its centre and size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the layout needs to know about each bubble. */
export interface LayoutItem {
  id: string;
  r: number; // bubble radius
  labelW: number; // label width
  labelH: number; // label height
}

/** A bubble after layout: its centre and where its label goes. */
export interface Placed extends LayoutItem {
  x: number;
  y: number;
  label: Box;
}

export interface LayoutOptions {
  centerR: number; // radius of the middle bubble (sits at 0,0)
  linkLength: number; // preferred gap between the middle bubble and the others
  gap: number; // space between a bubble and its own label
  padding: number; // minimum clear space between any two things
  iterations: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = { centerR: 62, linkLength: 120, gap: 6, padding: 8, iterations: 400 };

/** Put a label just above (top half) or below (bottom half) its bubble. */
export function labelBox(x: number, y: number, r: number, w: number, h: number, gap: number): Box {
  const dir = y < 0 ? -1 : 1;
  return { x, y: y + dir * (r + gap + h / 2), w, h };
}

/** Lay out the bubbles around a centre bubble at (0, 0). */
export function layoutStar(items: LayoutItem[], opts: LayoutOptions = DEFAULT_LAYOUT): Placed[] {
  const n = items.length;
  if (n === 0) return [];

  // Start on a circle big enough that the labels roughly fit side by side.
  const maxR = Math.max(...items.map((i) => i.r));
  const around = items.reduce((a, i) => a + Math.max(i.labelW, 2 * i.r) + opts.padding * 2, 0);
  const startR = Math.max(opts.centerR + opts.linkLength + maxR, around / (2 * Math.PI));
  const nodes = items.map((it, k) => {
    const a = (k / n) * Math.PI * 2 - Math.PI / 2;
    return { ...it, x: Math.cos(a) * startR, y: Math.sin(a) * startR };
  });
  if (n === 1) nodes[0].y = -(opts.centerR + opts.linkLength + nodes[0].r); // a lone child sits above

  const box = (i: number) => labelBox(nodes[i].x, nodes[i].y, nodes[i].r, nodes[i].labelW, nodes[i].labelH, opts.gap);
  const move = (i: number, dx: number, dy: number) => {
    nodes[i].x += dx;
    nodes[i].y += dy;
  };

  /** One tick of the simulation. `heat` scales every move; `spring` scales the pull to the centre. */
  const step = (heat: number, spring: number) => {
    for (let i = 0; i < n; i++) {
      // 1. Spring towards the preferred distance from the centre.
      const ni = nodes[i];
      const dist = Math.hypot(ni.x, ni.y) || 1;
      const want = opts.centerR + opts.linkLength + ni.r;
      const pull = (want - dist) * 0.05 * heat * spring;
      move(i, (ni.x / dist) * pull, (ni.y / dist) * pull);

      // 2. Keep this bubble's label off the centre bubble.
      const bi = box(i);
      const p = pushCircleOffBox(0, 0, opts.centerR + opts.padding, bi);
      if (p) move(i, -p.dx, -p.dy);
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // 3. Bubbles and labels must not overlap each other.
        const bi = box(i);
        const bj = box(j);
        const pushes = [
          pushCircleCircle(nodes[i].x, nodes[i].y, nodes[i].r, nodes[j].x, nodes[j].y, nodes[j].r, opts.padding),
          pushCircleOffBox(nodes[i].x, nodes[i].y, nodes[i].r + opts.padding, bj), // moves bubble i off label j
          negate(pushCircleOffBox(nodes[j].x, nodes[j].y, nodes[j].r + opts.padding, bi)), // moves label i off bubble j
          pushBoxBox(bi, bj, opts.padding),
        ];
        for (const p of pushes) {
          if (!p) continue;
          move(i, p.dx * 0.5 * heat, p.dy * 0.5 * heat);
          move(j, -p.dx * 0.5 * heat, -p.dy * 0.5 * heat);
        }
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        // 4. Keep bubble i and its label off the line from the centre to bubble j.
        const bi = box(i);
        const hitsLabel = segmentHitsBox(0, 0, nodes[j].x, nodes[j].y, bi, opts.padding);
        const hitsBubble = pointSegmentDistance(nodes[i].x, nodes[i].y, 0, 0, nodes[j].x, nodes[j].y) < nodes[i].r + opts.padding;
        if (!hitsLabel && !hitsBubble) continue;
        // Sideways direction relative to line j, pointing at whichever side bubble i is on.
        const len = Math.hypot(nodes[j].x, nodes[j].y) || 1;
        let px = -nodes[j].y / len;
        let py = nodes[j].x / len;
        const side = px * (hitsLabel ? bi.x : nodes[i].x) + py * (hitsLabel ? bi.y : nodes[i].y);
        if (side < 0) {
          px = -px;
          py = -py;
        }
        const k = 6 * heat;
        move(i, px * k, py * k);
        move(j, -px * k * 0.5, -py * k * 0.5); // swing line j away too
      }
    }
  };

  // Main run: big moves early, fine-tuning late.
  for (let t = 0; t < opts.iterations; t++) step(1 - (t / opts.iterations) * 0.85, 1);

  // Clean-up: crowded maps can end with a near-miss. Keep nudging gently (with a weaker
  // pull to the centre, so the spring can't drag things back into the clash) until there
  // are no problems left, or give up after a while and accept a slightly imperfect map.
  const result = () => nodes.map((nd, i) => ({ ...nd, label: box(i) }));
  for (let extra = 0; extra < 800; extra += 10) {
    const issues = layoutIssues(result(), opts);
    if (issues.labelLineCrossings === 0 && issues.overlaps === 0) break;
    for (let k = 0; k < 10; k++) step(0.3, 0.1);
  }
  return result();
}

/** Count problems in a layout. Used by tests and handy when tuning: both numbers should be 0. */
export function layoutIssues(placed: Placed[], opts: LayoutOptions = DEFAULT_LAYOUT) {
  let labelLineCrossings = 0;
  let overlaps = 0;
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    if (circleHitsBox(0, 0, opts.centerR, a.label, 0)) overlaps++;
    for (let j = 0; j < placed.length; j++) {
      if (i === j) continue;
      const b = placed[j];
      if (segmentHitsBox(0, 0, b.x, b.y, a.label, 0)) labelLineCrossings++;
      if (j > i) {
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) overlaps++;
        if (boxesOverlap(a.label, b.label, 0)) overlaps++;
        if (circleHitsBox(a.x, a.y, a.r, b.label, 0) || circleHitsBox(b.x, b.y, b.r, a.label, 0)) overlaps++;
      }
    }
  }
  return { labelLineCrossings, overlaps };
}

/** The rectangle that contains every bubble and label (plus the centre bubble). */
export function layoutBounds(placed: Placed[], centerR: number): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = -centerR, minY = -centerR, maxX = centerR, maxY = centerR;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.r, p.label.x - p.label.w / 2);
    maxX = Math.max(maxX, p.x + p.r, p.label.x + p.label.w / 2);
    minY = Math.min(minY, p.y - p.r, p.label.y - p.label.h / 2);
    maxY = Math.max(maxY, p.y + p.r, p.label.y + p.label.h / 2);
  }
  return { minX, minY, maxX, maxY };
}

// ---- Geometry helpers ---------------------------------------------------------
// Each "push" returns how far to move the FIRST thing so the two stop overlapping, or null.

type Push = { dx: number; dy: number } | null;
const negate = (p: Push): Push => (p ? { dx: -p.dx, dy: -p.dy } : null);

function pushCircleCircle(ax: number, ay: number, ar: number, bx: number, by: number, br: number, pad: number): Push {
  const dx = ax - bx;
  const dy = ay - by;
  const d = Math.hypot(dx, dy);
  const min = ar + br + pad;
  if (d >= min) return null;
  if (d < 1e-6) return { dx: min, dy: 0 };
  return { dx: (dx / d) * (min - d), dy: (dy / d) * (min - d) };
}

/** How far to move the BOX so it clears the circle — returned as the circle's push (caller flips it). */
function pushCircleOffBox(cx: number, cy: number, r: number, b: Box): Push {
  const nx = clamp(cx, b.x - b.w / 2, b.x + b.w / 2);
  const ny = clamp(cy, b.y - b.h / 2, b.y + b.h / 2);
  const dx = cx - nx;
  const dy = cy - ny;
  const d = Math.hypot(dx, dy);
  if (d >= r) return null;
  if (d < 1e-6) {
    // Circle centre is inside the box: push out along the line between the centres.
    const ox = cx - b.x;
    const oy = cy - b.y;
    const od = Math.hypot(ox, oy) || 1;
    return { dx: (ox / od) * r, dy: (oy / od) * r };
  }
  return { dx: (dx / d) * (r - d), dy: (dy / d) * (r - d) };
}

function pushBoxBox(a: Box, b: Box, pad: number): Push {
  const ox = (a.w + b.w) / 2 + pad - Math.abs(a.x - b.x);
  const oy = (a.h + b.h) / 2 + pad - Math.abs(a.y - b.y);
  if (ox <= 0 || oy <= 0) return null;
  // Separate along whichever axis needs the smaller move.
  return ox < oy ? { dx: Math.sign(a.x - b.x || 1) * ox, dy: 0 } : { dx: 0, dy: Math.sign(a.y - b.y || 1) * oy };
}

function circleHitsBox(cx: number, cy: number, r: number, b: Box, pad: number): boolean {
  return pushCircleOffBox(cx, cy, r + pad, b) !== null;
}

function boxesOverlap(a: Box, b: Box, pad: number): boolean {
  return pushBoxBox(a, b, pad) !== null;
}

/** Does the line segment A→B pass through the (padded) box? (Liang–Barsky clipping.) */
export function segmentHitsBox(ax: number, ay: number, bx: number, by: number, b: Box, pad: number): boolean {
  const minX = b.x - b.w / 2 - pad;
  const maxX = b.x + b.w / 2 + pad;
  const minY = b.y - b.h / 2 - pad;
  const maxY = b.y + b.h / 2 + pad;
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, ax - minX],
    [dx, maxX - ax],
    [-dy, ay - minY],
    [dy, maxY - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
