// Decides how each event on the river is drawn, given where it lands on screen:
//   • single  — its own bubble (with a label, if there's room for one)
//   • cluster — several events whose bubbles would overlap, merged into one bubble with a count
//   • faint   — a small dot, because it isn't important enough for this zoom level
//
// The 3D river projects every event to screen pixels a few times a second and passes
// them here. This file only does 2D geometry, so it's quick and easy to test.
//
// Rules, in order:
//   1. Events below the zoom level's importance threshold are faint (src/lib/importance.ts).
//   2. The rest are taken most-important first. Each one either starts a new bubble or,
//      if it would overlap an existing bubble, joins that bubble as a cluster.
//   3. A "pinned" event (one you just searched for or jumped to) always gets its own
//      bubble and label; anything that would sit on top of it becomes a faint dot.
//   4. Labels (for bubbles and clusters alike) are placed most-important first and skipped
//      if they'd overlap another label. Clusters always keep a small count badge.

export interface ScreenItem {
  id: string;
  x: number; // screen pixels
  y: number;
  r: number; // bubble radius in pixels
  importance: number;
  major: boolean; // important enough for a bubble at this zoom level
  pinned?: boolean;
  labelW: number; // estimated label size in pixels
  labelH: number;
  /** How far above the bubble's centre its label's centre sits, in pixels (default: just above). */
  labelLift?: number;
  /** Size and lift of the label this event would get if it anchored a cluster. */
  clusterLabel?: { w: number; h: number; lift: number };
}

export interface ClusterGroup {
  anchorId: string; // the most important member; the bubble sits where it is
  memberIds: string[];
  x: number;
  y: number;
  r: number;
  showLabel: boolean; // room for the full "N events · years" label?
}

export interface RiverPlan {
  singles: { id: string; showLabel: boolean }[];
  clusters: ClusterGroup[];
  faint: string[];
}

export interface PlanOptions {
  minRadius: number; // never treat a bubble as smaller than this (keeps tap targets apart)
  gap: number; // extra space wanted between bubbles
}

export function planScreen(items: ScreenItem[], { minRadius, gap }: PlanOptions): RiverPlan {
  const faint: string[] = items.filter((i) => !i.major && !i.pinned).map((i) => i.id);
  const majors = items
    .filter((i) => i.major || i.pinned)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.importance - a.importance || a.id.localeCompare(b.id));

  const groups: (Omit<ClusterGroup, 'showLabel'> & { pinned: boolean })[] = [];
  for (const it of majors) {
    const r = Math.max(it.r, minRadius);
    const hit = groups.find((g) => Math.hypot(g.x - it.x, g.y - it.y) < g.r + r + gap);
    if (!hit || it.pinned) {
      groups.push({ anchorId: it.id, memberIds: [it.id], x: it.x, y: it.y, r, pinned: !!it.pinned });
    } else if (hit.pinned) {
      faint.push(it.id); // never cover up the event the user is looking for
    } else {
      hit.memberIds.push(it.id);
    }
  }

  // Labels: most important first, skipping any that would collide with one already placed.
  const byId = new Map(items.map((i) => [i.id, i]));
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const fits = (b: { x: number; y: number; w: number; h: number }) =>
    !placed.some((p) => Math.abs(p.x - b.x) * 2 < p.w + b.w && Math.abs(p.y - b.y) * 2 < p.h + b.h);

  const singles: RiverPlan['singles'] = [];
  const clusters: ClusterGroup[] = [];
  for (const g of groups) {
    const it = byId.get(g.anchorId)!;
    if (g.memberIds.length > 1) {
      // A cluster label is about two lines high and fairly wide, scaled like the anchor's label.
      const cl = it.clusterLabel ?? { w: it.labelH * 6, h: it.labelH * 2, lift: g.r + it.labelH };
      const box = { x: g.x, y: g.y - cl.lift, w: cl.w, h: cl.h };
      const showLabel = fits(box);
      if (showLabel) placed.push(box);
      clusters.push({ anchorId: g.anchorId, memberIds: g.memberIds, x: g.x, y: g.y, r: g.r, showLabel });
      continue;
    }
    const box = { x: it.x, y: it.y - (it.labelLift ?? g.r + it.labelH / 2 + 4), w: it.labelW, h: it.labelH };
    const showLabel = !!it.pinned || fits(box);
    if (showLabel) placed.push(box);
    singles.push({ id: it.id, showLabel });
  }
  return { singles, clusters, faint };
}

/** A short fingerprint of a plan, so the river only re-renders when the plan really changes. */
export function planKey(p: RiverPlan): string {
  return [
    p.singles.map((s) => s.id + (s.showLabel ? '+' : '')).join(','),
    p.clusters.map((c) => c.memberIds.join('.') + (c.showLabel ? '+' : '')).join(','),
    p.faint.length,
  ].join('|');
}
