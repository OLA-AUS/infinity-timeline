// What the main river is showing, as a stack of steps — the breadcrumb.
//
//   Full river › May 1939 – Jun 1943 › Aug 1940 – Oct 1940 › …
//
// The first step is always the full river. Expanding a cluster of events pushes a
// "period" step; periods can be nested (expand a cluster inside an expanded period).
// Choosing Years / Months / Weeks / Days on the scale bar puts a unit step on top
// (replacing a unit step that's already there). Clicking a breadcrumb step goes back to
// it; Collapse pops the top step; Continue slides the top window along by its own length.
//
// Every change also says where the camera should end up — its *anchor*:
//   • scale bar   → the selected event's date if one is selected, otherwise the start of
//                   the current unit: Years → 1 Jan of the year shown, Months → the 1st of
//                   the month shown, Weeks → that week's Monday, Days → the first day of
//                   the month (or of a short expanded period) in view
//   • expand      → the first event of the cluster
//   • back / collapse / Full river / Period → wherever the camera is now (it doesn't move in time)
//   • Continue    → the same place in the next (or previous) window
// The animation itself is in src/lib/cameraAnchor.ts (transitionPose).
// Everything here is plain data in, data out, so it's tested directly (viewStack.test.ts).
import type { Year } from '../types';
import { monthStart, tickFor, unitWindow, weekStart, windowLabel, type ScaleLevel, type TimeWindow } from './timeScale';
import { yearToYmd, ymdToYear } from './dates';

export interface ViewStep {
  window: TimeWindow | null; // null = full river
}

export type ViewStack = ViewStep[];

export const FULL_RIVER: ViewStack = [{ window: null }];

/** Where the camera should end up after a change: a moment, or "stay at the moment you're at" (plus an optional shift). */
export type Anchor = { at: Year } | { camera: true; shift?: number };

export interface ViewChange {
  stack: ViewStack;
  anchor: Anchor;
}

/** How much space to leave either side of an expanded cluster, as a share of its span. */
export const PERIOD_PADDING = 0.05;
/** The shortest period we'll expand (half a day), so a cluster on one day still opens up. */
export const MIN_PERIOD = 0.5 / 365.25;
/** Expanded periods shorter than this count as "short": the Days level shows the period itself. */
export const SHORT_PERIOD = 62 / 365.25;

export const top = (stack: ViewStack) => stack[stack.length - 1];
export const currentWindow = (stack: ViewStack) => top(stack).window;

/** The level the scale bar highlights. */
export function currentLevel(stack: ViewStack): ScaleLevel {
  return currentWindow(stack)?.level ?? 'full';
}

/** The innermost expanded period, if any (so "Period" can go back to it). */
export function innermostPeriod(stack: ViewStack): number {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].window?.level === 'period') return i;
  return -1;
}

/** "Period" on the scale bar is greyed out unless a period has been expanded. */
export const periodAvailable = (stack: ViewStack) => innermostPeriod(stack) >= 0;

/** Breadcrumb labels: "Full river", "May 1939 – Jun 1943", "1941", … */
export const crumbs = (stack: ViewStack) => stack.map((s) => windowLabel(s.window));

/** The window to expand for a cluster of events: their span plus ~5% each side. */
export function periodWindow(first: Year, last: Year): TimeWindow {
  let span = Math.max(last - first, 0);
  let pad = span * PERIOD_PADDING;
  if (span + 2 * pad < MIN_PERIOD) {
    pad = (MIN_PERIOD - span) / 2;
    span = Math.max(span, 0);
  }
  const start = first - pad;
  const end = last + pad;
  return { level: 'period', start, end, tick: tickFor(start, end) };
}

/** Expand a cluster: push a period for its span, and fly to its first event. */
export function expandCluster(stack: ViewStack, eventYears: Year[]): ViewChange {
  const first = Math.min(...eventYears);
  const last = Math.max(...eventYears);
  return { stack: [...stack, { window: periodWindow(first, last) }], anchor: { at: first } };
}

/**
 * The "start of the current unit" for a scale-bar level, from the time at the camera:
 * Years → 1 Jan, Months → the 1st, Weeks → Monday, Days → the 1st of the month, or the
 * start of a short expanded period that contains the camera.
 */
export function unitStart(level: 'years' | 'months' | 'weeks' | 'days', cameraYear: Year, stack: ViewStack): Year {
  const { y } = yearToYmd(cameraYear);
  switch (level) {
    case 'years':
      return ymdToYear(y, 1, 1, 0);
    case 'months':
      return monthStart(cameraYear);
    case 'weeks':
      return weekStart(cameraYear);
    case 'days': {
      const p = shortPeriodAround(stack, cameraYear);
      return p ? p.start : monthStart(cameraYear);
    }
  }
}

/** A short expanded period containing `year`, if any (Days then shows that period). */
function shortPeriodAround(stack: ViewStack, year: Year): TimeWindow | null {
  const i = innermostPeriod(stack);
  const w = i >= 0 ? stack[i].window! : null;
  return w && w.end - w.start <= SHORT_PERIOD && year >= w.start && year < w.end ? w : null;
}

/**
 * Click a level on the scale bar.
 *   Full river → back to the first step. Period → back to the innermost expanded period.
 *   Years / Months / Weeks / Days → a unit step on top (replacing a unit step already there),
 *   anchored on the selected event's date, or else the start of the current unit.
 * Returns null if the level can't be chosen (Period with no period expanded).
 */
export function chooseLevel(stack: ViewStack, level: ScaleLevel, cameraYear: Year, selectedYear?: Year): ViewChange | null {
  if (level === 'full') return { stack: FULL_RIVER, anchor: { camera: true } };
  if (level === 'period') {
    const i = innermostPeriod(stack);
    return i < 0 ? null : { stack: stack.slice(0, i + 1), anchor: { camera: true } };
  }
  const at = selectedYear ?? unitStart(level, cameraYear, stack);
  const p = level === 'days' ? shortPeriodAround(stack, at) : null;
  const window: TimeWindow = p ? { ...p, level: 'days', tick: 'days' } : unitWindow(level, at);
  const base = top(stack).window && top(stack).window!.level !== 'period' ? stack.slice(0, -1) : stack;
  return { stack: [...base, { window }], anchor: { at } };
}

/** Click breadcrumb step `i`: go back to it, staying at the same moment. */
export function goToStep(stack: ViewStack, i: number): ViewChange {
  return { stack: stack.slice(0, Math.max(1, i + 1)), anchor: { camera: true } };
}

/** Collapse: drop the top step, staying at the same moment. */
export function collapse(stack: ViewStack): ViewChange {
  return goToStep(stack, stack.length - 2);
}

/**
 * Continue: slide the top window forwards (+1) or backwards (−1) by its own length, and
 * keep the camera at the same place within it.
 */
export function continueWindow(stack: ViewStack, dir: 1 | -1): ViewChange | null {
  const w = currentWindow(stack);
  if (!w) return null;
  const shift = dir * (w.end - w.start);
  const moved: TimeWindow = { ...w, start: w.start + shift, end: w.end + shift };
  return { stack: [...stack.slice(0, -1), { window: moved }], anchor: { camera: true, shift } };
}

/** For "fly to" (search, jumps): the level a date's precision deserves, anchored on the date. */
export function levelForPrecision(p: 'day' | 'month' | 'year' | 'decade' | 'century' | 'millennium'): ScaleLevel {
  return p === 'day' ? 'days' : p === 'month' ? 'months' : 'full';
}
