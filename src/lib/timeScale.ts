// Time zoom for the river: all time → century → decade → year → month → day.
//
// Normally the river uses a log scale (src/lib/time.ts): deep history is squeezed so
// 5,000 years fit. That makes busy periods like WW2 pile up in a few units of river.
// Zooming picks a "window" — one calendar century, decade, year, month or day — and
// gives it its own straight (linear) stretch of river, WINDOW_LENGTH units long, so
// events inside it spread out evenly. Everything outside the window is still drawn,
// using the normal log scale squeezed by OUTSIDE_SQUEEZE, so you never lose your place.
//
//   before the window        the window            after the window
//   ───── squeezed log ─────|──────── linear ───────|───── squeezed log ─────
//
// A TimeScale converts years ⇄ river distance ("s") for the current zoom. Everything
// in the 3D scene asks the scale where things go, so changing zoom moves them all.
import type { DatePrecision, Year } from '../types';
import { yearToS, sToYear } from './time';
import { formatAt, formatYear, ymdToYear, yearToYmd } from './dates';

export type ZoomLevel = 'all' | 'century' | 'decade' | 'year' | 'month' | 'day';

/** Zoom levels from widest to narrowest. */
export const ZOOM_LEVELS: ZoomLevel[] = ['all', 'century', 'decade', 'year', 'month', 'day'];

/** A calendar period the river is zoomed into. `null` means "all time" (no zoom). */
export interface TimeWindow {
  level: Exclude<ZoomLevel, 'all'>;
  start: Year; // inclusive
  end: Year; // exclusive
}

/** How long the zoomed window is on the river, in world units (≈ a few screens of travel). */
export const WINDOW_LENGTH = 120;
/** How much time outside the window is squeezed compared with the normal log scale. */
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

const levelIndex = (l: ZoomLevel) => ZOOM_LEVELS.indexOf(l);
export const levelOf = (w: TimeWindow | null): ZoomLevel => w?.level ?? 'all';
export const isDeeper = (a: ZoomLevel, b: ZoomLevel) => levelIndex(a) > levelIndex(b);

/** One level closer in ("decade" → "year"), or null at the deepest level. */
export function deeper(level: ZoomLevel): ZoomLevel | null {
  return ZOOM_LEVELS[levelIndex(level) + 1] ?? null;
}

/** One level further out ("year" → "decade"), or null at "all time". */
export function shallower(level: ZoomLevel): ZoomLevel | null {
  return levelIndex(level) > 0 ? ZOOM_LEVELS[levelIndex(level) - 1] : null;
}

/** The calendar period at `level` that contains `year`, e.g. ('decade', 1939.7) → 1930–1940. */
export function windowFor(level: ZoomLevel, year: Year): TimeWindow | null {
  const { y, m, d } = yearToYmd(year);
  switch (level) {
    case 'all':
      return null;
    case 'century': {
      const start = Math.floor(y / 100) * 100;
      return { level, start, end: start + 100 };
    }
    case 'decade': {
      const start = Math.floor(y / 10) * 10;
      return { level, start, end: start + 10 };
    }
    case 'year':
      return { level, start: y, end: y + 1 };
    case 'month':
      return { level, start: ymdToYear(y, m, 1, 0), end: m === 12 ? ymdToYear(y + 1, 1, 1, 0) : ymdToYear(y, m + 1, 1, 0) };
    case 'day':
      return { level, start: ymdToYear(y, m, d, 0), end: ymdToYear(y, m, d, 1) };
  }
}

/** Build the year ⇄ river-distance conversion for a zoom window (or for "all time"). */
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

/** Short label for a window: "1900s", "1930s", "1939", "Sep 1939", "1 Sep 1939". */
export function windowLabel(w: TimeWindow | null): string {
  if (!w) return 'All time';
  switch (w.level) {
    case 'century':
    case 'decade':
      return w.start >= 0 ? `${w.start}s` : `${formatYear(w.start)} – ${formatYear(w.end - 1)}`;
    case 'year':
      return formatYear(w.start);
    case 'month':
      return formatAt((w.start + w.end) / 2, 'month');
    case 'day':
      return formatAt((w.start + w.end) / 2, 'day');
  }
}

export interface Crumb {
  label: string;
  window: TimeWindow | null;
}

/** The breadcrumb trail for a window: All time › 1900s › 1930s › 1939 › Sep 1939. */
export function breadcrumb(w: TimeWindow | null): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'All time', window: null }];
  if (!w) return crumbs;
  const mid = (w.start + w.end) / 2;
  for (const level of ZOOM_LEVELS.slice(1, levelIndex(w.level) + 1)) {
    const win = windowFor(level, mid);
    crumbs.push({ label: windowLabel(win), window: win });
  }
  return crumbs;
}

/**
 * Where to zoom to show everything between two years (used when you click a cluster).
 * Picks the narrowest calendar period that holds both ends. If that isn't any closer
 * than where you are now, it zooms one level in around the middle instead.
 * Returns undefined when you're already at the deepest level.
 */
export function zoomForSpan(from: Year, to: Year, current: ZoomLevel): TimeWindow | null | undefined {
  for (const level of [...ZOOM_LEVELS].reverse()) {
    if (level === 'all') break;
    const w = windowFor(level, from)!;
    if (w.start <= from && to < w.end) {
      if (isDeeper(level, current)) return w;
      break;
    }
  }
  const next = deeper(current);
  return next ? windowFor(next, (from + to) / 2) : undefined;
}

/** The zoom level that suits a date's precision: a day-precise date is best seen in its month. */
export function levelForPrecision(p: DatePrecision): ZoomLevel {
  return ({ day: 'month', month: 'year', year: 'decade', decade: 'century', century: 'all', millennium: 'all' } as const)[p];
}

/** Year text for the big HUD number, detailed enough for the zoom level. */
export function formatForLevel(year: Year, level: ZoomLevel): string {
  if (level === 'month' || level === 'day') return formatAt(year, 'day');
  if (level === 'year') return formatAt(year, 'month');
  return formatYear(year);
}

/** Tick marks along the window: decades in a century, years in a decade, months, days, hours. */
export function windowTicks(w: TimeWindow | null): { year: Year; label: string }[] {
  if (!w) return [];
  const ticks: { year: Year; label: string }[] = [];
  switch (w.level) {
    case 'century':
      for (let y = w.start; y < w.end; y += 10) ticks.push({ year: y, label: y >= 0 ? `${y}s` : formatYear(y) });
      break;
    case 'decade':
      for (let y = w.start; y < w.end; y++) ticks.push({ year: y, label: formatYear(y) });
      break;
    case 'year':
      for (let m = 1; m <= 12; m++) ticks.push({ year: ymdToYear(w.start, m, 1, 0), label: formatAt(ymdToYear(w.start, m, 15), 'month') });
      break;
    case 'month': {
      const { y, m } = yearToYmd((w.start + w.end) / 2);
      for (let d = 1; d <= 31; d++) {
        const t = ymdToYear(y, m, d, 0);
        if (t >= w.end - 1e-9) break;
        ticks.push({ year: t, label: formatAt(ymdToYear(y, m, d), 'day') });
      }
      break;
    }
    case 'day':
      for (let h = 0; h < 24; h += 6) ticks.push({ year: w.start + ((w.end - w.start) * h) / 24, label: `${String(h).padStart(2, '0')}:00` });
      break;
  }
  return ticks;
}
