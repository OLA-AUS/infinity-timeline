// Tests for the scale levels' windows, the year ⇄ distance mapping, labels and ticks.
// (Anchoring and nesting are tested in viewStack.test.ts and cameraAnchor.test.ts.)
import { describe, expect, it } from 'vitest';
import { ymdToYear, yearToYmd } from './dates';
import { yearToS } from './time';
import {
  blendScales,
  formatForWindow,
  makeScale,
  OUTSIDE_SQUEEZE,
  tickFor,
  unitWindow,
  WINDOW_LENGTH,
  weekStart,
  windowLabel,
  windowTicks,
  type TimeWindow,
} from './timeScale';

const aug1941 = ymdToYear(1941, 8, 14);
const day = (t: number) => yearToYmd(t + 1e-7);

describe('unit windows', () => {
  it('Years shows the decade, Months the year, Weeks the quarter, Days the month', () => {
    expect(unitWindow('years', aug1941)).toMatchObject({ start: 1940, end: 1950, tick: 'years' });
    expect(unitWindow('months', aug1941)).toMatchObject({ start: 1941, end: 1942, tick: 'months' });
    const q = unitWindow('weeks', aug1941);
    expect(day(q.start)).toEqual({ y: 1941, m: 7, d: 1 });
    expect(day(q.end)).toEqual({ y: 1941, m: 10, d: 1 });
    const d = unitWindow('days', aug1941);
    expect(day(d.start)).toEqual({ y: 1941, m: 8, d: 1 });
    expect(day(d.end)).toEqual({ y: 1941, m: 9, d: 1 });
  });

  it('weeks start on Monday', () => {
    expect(day(weekStart(aug1941))).toEqual({ y: 1941, m: 8, d: 11 });
    expect(day(weekStart(ymdToYear(1941, 8, 11)))).toEqual({ y: 1941, m: 8, d: 11 }); // a Monday stays put
  });

  it('labels windows plainly', () => {
    expect(windowLabel(null)).toBe('Full river');
    expect(windowLabel(unitWindow('years', aug1941))).toBe('1940s');
    expect(windowLabel(unitWindow('months', aug1941))).toBe('1941');
    expect(windowLabel(unitWindow('weeks', aug1941))).toBe('Q3 1941');
    expect(windowLabel(unitWindow('days', aug1941))).toBe('Aug 1941');
  });

  it('picks a tick unit to suit a period\'s length', () => {
    expect(tickFor(1939, 1944)).toBe('years');
    expect(tickFor(1940, 1941)).toBe('months');
    expect(tickFor(1940.5, 1940.6)).toBe('weeks');
    expect(tickFor(1940.5, 1940.52)).toBe('days');
  });

  it('has a tick per unit across the window', () => {
    expect(windowTicks(unitWindow('years', aug1941))).toHaveLength(10);
    expect(windowTicks(unitWindow('months', aug1941))).toHaveLength(12);
    const weeks = windowTicks(unitWindow('weeks', aug1941));
    expect(weeks.length).toBeGreaterThanOrEqual(13);
    for (const t of weeks) expect(new Date(Date.UTC(1941, day(t.year).m - 1, day(t.year).d)).getUTCDay()).toBe(1); // Mondays
    expect(windowTicks(unitWindow('days', aug1941))).toHaveLength(31);
  });

  it('the big date is as detailed as the window calls for', () => {
    expect(formatForWindow(aug1941, null)).toBe('1941');
    expect(formatForWindow(aug1941, unitWindow('years', aug1941))).toBe('Aug 1941');
    expect(formatForWindow(aug1941, unitWindow('days', aug1941))).toBe('14 Aug 1941');
  });
});

describe('time scale', () => {
  it('the full river is the plain log scale', () => {
    expect(makeScale(null).toS(1941)).toBe(yearToS(1941));
  });

  const windows: TimeWindow[] = [
    unitWindow('years', aug1941),
    unitWindow('months', aug1941),
    unitWindow('weeks', aug1941),
    unitWindow('days', aug1941),
    { level: 'period', start: 1939.3, end: 1943.6, tick: 'years' },
  ];
  for (const w of windows) {
    const scale = makeScale(w);
    it(`${w.level}: the window is evenly spaced and exactly WINDOW_LENGTH long`, () => {
      const a = scale.toS(w.start);
      expect(scale.toS(w.end) - a).toBeCloseTo(WINDOW_LENGTH);
      expect(scale.toS((w.start + w.end) / 2) - a).toBeCloseTo(WINDOW_LENGTH / 2);
    });

    it(`${w.level}: later is always further along, and toYear undoes toS`, () => {
      const years = [-3000, 0, 1500, 1900, w.start, (w.start + w.end) / 2, w.end, 1990, 2026].sort((a, b) => a - b);
      let prev = -Infinity;
      for (const y of years) {
        const s = scale.toS(y);
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
        expect(scale.toYear(s)).toBeCloseTo(y, 6);
      }
    });

    it(`${w.level}: time outside is squeezed but still there`, () => {
      const before = scale.toS(w.start) - scale.toS(1800);
      expect(before).toBeCloseTo(OUTSIDE_SQUEEZE * (yearToS(w.start) - yearToS(1800)));
    });
  }

  it('blended scales slide smoothly between two windows and can be inverted', () => {
    const a = makeScale(windows[0]);
    const b = makeScale(windows[4]);
    for (const u of [0.25, 0.5, 0.75]) {
      const m = blendScales(a, b, u);
      for (const y of [1900, 1940, 1941.6, 1945]) expect(m.toYear(m.toS(y))).toBeCloseTo(y, 6);
    }
  });
});
