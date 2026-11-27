// "Expand in place" for the main river: normal → months → days.
//
// Normally the river uses a log scale (src/lib/time.ts): deep history is squeezed so
// 5,000 years fit. Expanding picks a calendar period around a moment — the year it's in
// (shown month by month) or the month it's in (shown day by day) — and gives that period
// its own straight, evenly spaced stretch of river, WINDOW_LENGTH units long. Everything
// outside it is still drawn with the normal log scale, squeezed by OUTSIDE_SQUEEZE.
//
//   before the window        the window            after the window
//   ───── squeezed log ─────|──────── linear ───────|───── squeezed log ─────
//
// A TimeScale converts years ⇄ river distance ("s"). Everything in the 3D scene asks the
// scale where things go. While the river animates from one level to another, a blended
// scale (blendScales) is used for each frame in between.
// How the camera stays put while this happens is in src/lib/cameraAnchor.ts.
import type { DatePrecision, Year } from '../types';
import { yearToS, sToYear } from './time';
import { formatAt, formatYear, ymdToYear, yearToYmd } from './dates';

/** How far time is expanded on the main river. */
export type ExpandLevel = 'normal' | 'months' | 'days';
export const EXPAND_LEVELS: ExpandLevel[] = ['normal', 'months', 'days'];

/**
 * The expanded period. `months`: one calendar year, shown month by month.
 * `days`: one calendar month, shown day by day. `null` means not expanded.
 */
export interface TimeWindow {
  level: Exclude<ExpandLevel, 'normal'>;
  start: Year; // inclusive
  end: Year; // exclusive
}

/** How long the expanded period is on the river, in world units (≈ a few screens of travel). */
export const WINDOW_LENGTH = 120;
/** How much time outside the expanded period is squeezed compared with the normal log scale. */
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

const levelIndex = (l: ExpandLevel) => EXPAND_LEVELS.indexOf(l);
export const levelOf = (w: TimeWindow | null): ExpandLevel => w?.level ?? 'normal';
export const isDeeper = (a: ExpandLevel, b: ExpandLevel) => levelIndex(a) > levelIndex(b);

/** One level further in ("normal" → "months"), or null at "days". */
export const deeper = (l: ExpandLevel): ExpandLevel | null => EXPAND_LEVELS[levelIndex(l) + 1] ?? null;
/** One level further out ("days" → "months"), or null at "normal". */
export const shallower = (l: ExpandLevel): ExpandLevel | null => (levelIndex(l) > 0 ? EXPAND_LEVELS[levelIndex(l) - 1] : null);

/** The period to expand at `level` around `year`: its calendar year (months) or month (days). */
export function windowFor(level: ExpandLevel, year: Year): TimeWindow | null {
  const { y, m } = yearToYmd(year);
  if (level === 'months') return { level, start: y, end: y + 1 };
  if (level === 'days') return { level, start: ymdToYear(y, m, 1, 0), end: m === 12 ? ymdToYear(y + 1, 1, 1, 0) : ymdToYear(y, m + 1, 1, 0) };
  return null;
}

/** Build the year ⇄ river-distance conversion for an expanded period (or for none). */
export function makeScale(window: TimeWindow | null): TimeScale {
  if (!window) {
    return { window, toS: yearToS, toYear: sToYear, sMin: yearToS(YEAR_MIN), sMax: yearToS(YEAR_MAX) };
  }
  const { start: a, end: b } = window;
  const c = OUTSIDE_SQUEEZE;
  const L = WINDOW_LENGTH;
  const bA = yearToS(a);
  const bB = yearToS(b);
  const s0 = c * bA; // where the expanded period begins on the river
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

/** Label for an expanded period: "1939" (months) or "Sep 1939" (days). */
export function windowLabel(w: TimeWindow | null): string {
  if (!w) return '';
  return w.level === 'months' ? formatYear(w.start) : formatAt((w.start + w.end) / 2, 'month');
}

export interface Crumb {
  label: string;
  window: TimeWindow | null;
}

/** The trail for the Collapse control: "1939" (months), then "Sep 1939" (days). */
export function expandCrumbs(w: TimeWindow | null): Crumb[] {
  if (!w) return [];
  const mid = (w.start + w.end) / 2;
  const crumbs = [{ label: formatYear(Math.floor(mid)), window: windowFor('months', mid) }];
  if (w.level === 'days') crumbs.push({ label: windowLabel(w), window: w });
  return crumbs;
}

/** How far to expand to see a date clearly: a day-precise date gets days, a month-precise one months. */
export function levelForPrecision(p: DatePrecision): ExpandLevel {
  return p === 'day' ? 'days' : p === 'month' ? 'months' : 'normal';
}

/** Date text for the big HUD readout, detailed enough for the level. */
export function formatForLevel(year: Year, level: ExpandLevel): string {
  if (level === 'days') return formatAt(year, 'day');
  if (level === 'months') return formatAt(year, 'month');
  return formatYear(year);
}

/** Tick marks across the expanded period: one per month, or one per day. */
export function windowTicks(w: TimeWindow | null): { year: Year; label: string; major: boolean }[] {
  if (!w) return [];
  const ticks: { year: Year; label: string; major: boolean }[] = [];
  if (w.level === 'months') {
    for (let m = 1; m <= 12; m++) ticks.push({ year: ymdToYear(w.start, m, 1, 0), label: formatAt(ymdToYear(w.start, m, 15), 'month'), major: true });
  } else {
    const { y, m } = yearToYmd((w.start + w.end) / 2);
    for (let d = 1; d <= 31; d++) {
      const t = ymdToYear(y, m, d, 0);
      if (t >= w.end - 1e-9) break;
      ticks.push({ year: t, label: d === 1 || d % 5 === 0 ? formatAt(ymdToYear(y, m, d), 'day') : String(d), major: d === 1 || d % 5 === 0 });
    }
  }
  return ticks;
}
