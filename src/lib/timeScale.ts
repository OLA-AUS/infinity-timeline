// Time scales for the main river: Full river · Period · Years · Months · Weeks · Days.
//
// "Full river" is the normal log scale (src/lib/time.ts): deep history is squeezed so
// 5,000 years fit. Every other level shows a *window* of time stretched out evenly over
// WINDOW_LENGTH units of river, while everything outside it is still drawn, squeezed:
//
//   before the window        the window            after the window
//   ───── squeezed log ─────|──────── linear ───────|───── squeezed log ─────
//
// The windows:
//   • Years  — the decade around the year in view, ticked by year
//   • Months — the calendar year in view, ticked by month
//   • Weeks  — the calendar quarter in view, ticked by week (weeks start on Monday)
//   • Days   — the calendar month in view (or a short expanded period), ticked by day
//   • Period — any span you expanded from a cluster of events (src/lib/viewStack.ts),
//              ticked by whichever unit suits its length
//
// A TimeScale converts years ⇄ river distance ("s"). While the river animates from one
// window to another, a blended scale (blendScales) is used for each frame in between.
import type { Year } from '../types';
import { yearToS, sToYear } from './time';
import { formatAt, formatYear, ymdToYear, yearToYmd } from './dates';

/** The levels on the scale bar, widest first. */
export type ScaleLevel = 'full' | 'period' | 'years' | 'months' | 'weeks' | 'days';
export const SCALE_LEVELS: ScaleLevel[] = ['full', 'period', 'years', 'months', 'weeks', 'days'];
export const LEVEL_LABEL: Record<ScaleLevel, string> = { full: 'Full river', period: 'Period', years: 'Years', months: 'Months', weeks: 'Weeks', days: 'Days' };

/** The unit tick marks are drawn in. */
export type TickUnit = 'years' | 'months' | 'weeks' | 'days';

/** A stretch of time shown evenly on the river. */
export interface TimeWindow {
  level: Exclude<ScaleLevel, 'full'>;
  start: Year; // inclusive
  end: Year; // exclusive
  tick: TickUnit;
}

/** How long a window is on the river, in world units (≈ a few screens of travel). */
export const WINDOW_LENGTH = 120;
/** How much time outside the window is squeezed compared with the full river. */
export const OUTSIDE_SQUEEZE = 0.3;
/** The oldest and newest years you can travel to. */
export const YEAR_MIN = -3500;
export const YEAR_MAX = 2027;

export interface TimeScale {
  window: TimeWindow | null;
  toS(year: Year): number;
  toYear(s: number): Year;
  sMin: number; // the river's start (oldest end)
  sMax: number; // the river's end (now)
}

const DAY = 1 / 365.25;

/** Monday of the week containing `year` (as a decimal year, at midnight). */
export function weekStart(year: Year): Year {
  const { y, m, d } = yearToYmd(year);
  const date = new Date(Date.UTC(2000, m - 1, d));
  date.setUTCFullYear(y);
  const back = (date.getUTCDay() + 6) % 7; // Monday = 0 … Sunday = 6
  date.setUTCDate(date.getUTCDate() - back);
  return ymdToYear(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0);
}

/** Start of the calendar month containing `year`. */
export const monthStart = (year: Year) => {
  const { y, m } = yearToYmd(year);
  return ymdToYear(y, m, 1, 0);
};

/** The unit window for a level around a moment. Not for "full" or "period". */
export function unitWindow(level: 'years' | 'months' | 'weeks' | 'days', year: Year): TimeWindow {
  const { y, m } = yearToYmd(year);
  switch (level) {
    case 'years': {
      const start = Math.floor(y / 10) * 10;
      return { level, start, end: start + 10, tick: 'years' };
    }
    case 'months':
      return { level, start: y, end: y + 1, tick: 'months' };
    case 'weeks': {
      const q = Math.floor((m - 1) / 3) * 3 + 1; // first month of the quarter
      const start = ymdToYear(y, q, 1, 0);
      const end = q === 10 ? ymdToYear(y + 1, 1, 1, 0) : ymdToYear(y, q + 3, 1, 0);
      return { level, start, end, tick: 'weeks' };
    }
    case 'days':
      return { level, start: ymdToYear(y, m, 1, 0), end: m === 12 ? ymdToYear(y + 1, 1, 1, 0) : ymdToYear(y, m + 1, 1, 0), tick: 'days' };
  }
}

/** The right tick unit for a period of a given length. */
export function tickFor(start: Year, end: Year): TickUnit {
  const span = end - start;
  if (span > 3) return 'years';
  if (span > 4 / 12) return 'months';
  if (span > 21 * DAY) return 'weeks';
  return 'days';
}

/** Build the year ⇄ river-distance conversion for a window (or for the full river). */
export function makeScale(window: TimeWindow | null): TimeScale {
  if (!window) {
    return { window, toS: yearToS, toYear: sToYear, sMin: yearToS(YEAR_MIN), sMax: yearToS(YEAR_MAX) };
  }
  const { start: a, end: b } = window;
  const c = OUTSIDE_SQUEEZE;
  const L = WINDOW_LENGTH;
  const bA = yearToS(a);
  const bB = yearToS(b);
  const s0 = c * bA; // where the window begins on the river
  const toS = (year: Year) => {
    if (year < a) return s0 - c * (bA - yearToS(year)); // squeezed log before
    if (year <= b) return s0 + ((year - a) / (b - a)) * L; // linear inside
    return s0 + L + c * (yearToS(year) - bB); // squeezed log after
  };
  const toYear = (s: number): Year => {
    if (s < s0) return sToYear(bA - (s0 - s) / c);
    if (s <= s0 + L) return a + ((s - s0) / L) * (b - a);
    return sToYear(bB + (s - s0 - L) / c);
  };
  return { window, toS, toYear, sMin: toS(YEAR_MIN), sMax: toS(YEAR_MAX) };
}

/**
 * A scale part-way between two others (u = 0 → `a`, u = 1 → `b`), for animating a change.
 * Every year's position slides smoothly from where `a` puts it to where `b` puts it.
 * Going back from distance to year has no neat formula, so it's found by halving the
 * range between the two scales' answers until it's exact enough.
 */
export function blendScales(a: TimeScale, b: TimeScale, u: number): TimeScale {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const toS = (year: Year) => a.toS(year) * (1 - u) + b.toS(year) * u;
  const toYear = (s: number): Year => {
    let lo = Math.min(a.toYear(s), b.toYear(s));
    let hi = Math.max(a.toYear(s), b.toYear(s));
    for (let i = 0; i < 48 && hi - lo > 1e-9; i++) {
      const mid = (lo + hi) / 2;
      if (toS(mid) < s) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { window: u < 0.5 ? a.window : b.window, toS, toYear, sMin: toS(YEAR_MIN), sMax: toS(YEAR_MAX) };
}

/** A moment, at the detail a tick unit calls for: "1941", "Mar 1941", "3 Mar 1941". */
export function formatAtUnit(year: Year, unit: TickUnit): string {
  if (unit === 'years') return formatYear(year);
  if (unit === 'months') return formatAt(year, 'month');
  return formatAt(year, 'day');
}

/** Short label for a window: "1930s", "1941", "Q2 1941", "Mar 1941", "May 1939 – Jun 1943". */
export function windowLabel(w: TimeWindow | null): string {
  if (!w) return 'Full river';
  const mid = (w.start + w.end) / 2;
  switch (w.level) {
    case 'years':
      return w.start >= 0 ? `${w.start}s` : `${formatYear(w.start)} – ${formatYear(w.end - 1)}`;
    case 'months':
      return formatYear(w.start);
    case 'weeks':
      return `Q${Math.floor((yearToYmd(mid).m - 1) / 3) + 1} ${formatYear(mid)}`;
    case 'days':
      return formatAt(mid, 'month');
    case 'period': {
      // Long periods are labelled by month ("May 1939 – Jun 1943"), short ones by day.
      const unit: TickUnit = w.tick === 'years' || w.tick === 'months' ? 'months' : 'days';
      const a = formatAtUnit(w.start, unit);
      const b = formatAtUnit(w.end - 1e-6, unit);
      return a === b ? a : `${a} – ${b}`;
    }
  }
}

/** The big date readout: the time at the camera, as detailed as the level calls for. */
export function formatForWindow(year: Year, w: TimeWindow | null): string {
  if (!w) return formatYear(year);
  const unit: TickUnit = w.tick === 'years' ? 'months' : 'days';
  return formatAtUnit(year, unit);
}

/** Tick marks across a window, in its tick unit. `major` ticks get a line right across the river. */
export function windowTicks(w: TimeWindow | null): { year: Year; label: string; major: boolean }[] {
  if (!w) return [];
  const ticks: { year: Year; label: string; major: boolean }[] = [];
  const { y: y0 } = yearToYmd(w.start);
  const push = (t: Year, label: string, major = true) => {
    if (t >= w.start - 1e-9 && t < w.end - 1e-9) ticks.push({ year: t, label, major });
  };
  switch (w.tick) {
    case 'years':
      for (let y = Math.ceil(w.start); y < w.end; y++) push(y, formatYear(y));
      break;
    case 'months':
      for (let y = y0; y <= yearToYmd(w.end).y; y++) {
        for (let m = 1; m <= 12; m++) push(ymdToYear(y, m, 1, 0), formatAt(ymdToYear(y, m, 15), 'month'));
      }
      break;
    case 'weeks':
      for (let t = weekStart(w.start); t < w.end; t += 7 * DAY) {
        const monday = weekStart(t + 3 * DAY); // re-snap to Monday so leap years don't drift
        push(monday, formatAt(monday + 0.5 * DAY, 'day'));
      }
      break;
    case 'days':
      for (let t = w.start; t < w.end + DAY; t += DAY) {
        const { y, m, d } = yearToYmd(t + 0.5 * DAY);
        const day = ymdToYear(y, m, d, 0);
        if (ticks.length && Math.abs(ticks[ticks.length - 1].year - day) < 0.5 * DAY) continue;
        push(day, d === 1 || d % 5 === 0 ? formatAt(ymdToYear(y, m, d), 'day') : String(d), d === 1 || d % 5 === 0);
      }
      break;
  }
  return ticks;
}
