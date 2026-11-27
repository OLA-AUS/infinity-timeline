// Decides how each event on the main river is drawn, given where it lands on screen:
//   • bubble — its own glowing bubble, with a label if there's room for one
//   • faint  — a small dot, because it isn't important enough at this level of expansion
// and finds "stacks": groups of bubbles that overlap on screen. Every event keeps its own
// bubble (nothing is merged); clicking a stack fans its bubbles out in a ring so you can
// pick any one of them (River.tsx → FanRing).
//
// The 3D river projects every event to screen pixels a few times a second and passes
// them here. This file only does 2D geometry, so it's quick and easy to test.
//
// Rules:
//   1. Events below the level's importance threshold are faint (src/lib/importance.ts).
//   2. Everything else gets a bubble. Bubbles that touch (directly or through a chain of
//      touching bubbles) form a stack, most important first.
//   3. Labels are placed most-important first and skipped if they'd overlap another label.
//      A "pinned" event (one you searched for or jumped to) always shows its label.

export interface ScreenItem {
  id: string;
  x: number; // screen pixels
  y: number;
  r: number; // bubble radius in pixels
  importance: number;
  major: boolean; // important enough for a bubble at this level
  pinned?: boolean;
  labelW: number; // estimated label size in pixels
  labelH: number;
  /** How far above the bubble's centre its label's centre sits, in pixels (default: just above). */
  labelLift?: number;
}

export interface RiverPlan {
  bubbles: { id: string; showLabel: boolean }[];
  faint: string[];
  /** Groups of 2+ bubbles that overlap on screen, each sorted most important first. */
  stacks: string[][];
}

export interface PlanOptions {
  minRadius: number; // never treat a bubble as smaller than this (keeps tap targets apart)
  gap: number; // bubbles closer than this (edge to edge) count as overlapping
}

export function planScreen(items: ScreenItem[], { minRadius, gap }: PlanOptions): RiverPlan {
  const faint = items.filter((i) => !i.major && !i.pinned).map((i) => i.id);
  const shown = items
    .filter((i) => i.major || i.pinned)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.importance - a.importance || a.id.localeCompare(b.id));

  // Stacks: join every pair of overlapping bubbles (union–find keeps chains together).
  const parent = shown.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i];
      const b = shown[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < Math.max(a.r, minRadius) + Math.max(b.r, minRadius) + gap) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, string[]>();
  shown.forEach((it, i) => {
    const r = root(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(it.id); // `shown` is already most-important-first
  });
  const stacks = [...groups.values()].filter((g) => g.length > 1);

  // Labels: most important first, skipping any that would collide with one already placed.
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const fits = (b: { x: number; y: number; w: number; h: number }) =>
    !placed.some((p) => Math.abs(p.x - b.x) * 2 < p.w + b.w && Math.abs(p.y - b.y) * 2 < p.h + b.h);
  const bubbles = shown.map((it) => {
    const r = Math.max(it.r, minRadius);
    const box = { x: it.x, y: it.y - (it.labelLift ?? r + it.labelH / 2 + 4), w: it.labelW, h: it.labelH };
    const showLabel = !!it.pinned || fits(box);
    if (showLabel) placed.push(box);
    return { id: it.id, showLabel };
  });
  return { bubbles, faint, stacks };
}

/** A short fingerprint of a plan, so the river only re-renders when the plan really changes. */
export function planKey(p: RiverPlan): string {
  return [p.bubbles.map((b) => b.id + (b.showLabel ? '+' : '')).join(','), p.faint.length, p.stacks.map((s) => s.join('.')).join(',')].join('|');
}

/** Height of one fanned-out button plus a little space, in pixels (44px tap target). */
export const FAN_ROW = 48;

/**
 * Where to put each bubble of a fanned-out stack. They sit round a ring, half on the right
 * (labels pointing right) and half on the left (labels pointing left), spaced evenly *up
 * and down* rather than by angle — so neighbouring labels, which run sideways, never
 * overlap, even at the top and bottom of the ring. Order: right side top to bottom, then left.
 * On a narrow screen there's only room for one side: pass `only` to put them all there.
 */
export function fanPositions(count: number, radius: number, only?: 'left' | 'right'): { x: number; y: number; side: 'left' | 'right' }[] {
  const right = only === 'right' ? count : only === 'left' ? 0 : Math.ceil(count / 2);
  const out: { x: number; y: number; side: 'left' | 'right' }[] = [];
  for (const [side, m] of [['right', right], ['left', count - right]] as const) {
    const ry = Math.max(radius, (m * FAN_ROW) / 2); // tall enough for m rows
    for (let k = 0; k < m; k++) {
      const y = ry * (-1 + (2 * k + 1) / m); // evenly spaced, never right at the very top/bottom
      const x = radius * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
      out.push({ x: side === 'right' ? x : -x, y, side });
    }
  }
  return out;
}

/** Ring size for a fan of `count` bubbles. */
export const fanRadius = (count: number) => Math.max(70, Math.min(150, count * 12 + 30));

/** The most bubbles a fan shows; any more and it offers to expand time instead. */
export const FAN_MAX = 12;
