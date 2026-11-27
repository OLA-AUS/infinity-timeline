// Tests for expand-in-place: periods, the year ⇄ distance mapping, the Collapse trail and ticks.
// (Camera anchoring has its own tests in cameraAnchor.test.ts.)
import { describe, expect, it } from 'vitest';
import { ymdToYear } from './dates';
import { yearToS } from './time';
import {
  deeper,
  expandCrumbs,
  formatForLevel,
  levelForPrecision,
  levelOf,
  makeScale,
  OUTSIDE_SQUEEZE,
  shallower,
  WINDOW_LENGTH,
  windowFor,
  windowLabel,
  windowTicks,
} from './timeScale';

const sep1939 = ymdToYear(1939, 9, 1);

describe('expanded periods', () => {
  it('months shows the calendar year, days shows the calendar month', () => {
    expect(windowFor('normal', sep1939)).toBeNull();
    expect(windowFor('months', sep1939)).toMatchObject({ level: 'months', start: 1939, end: 1940 });
    const d = windowFor('days', sep1939)!;
    expect(d.level).toBe('days');
    expect(d.start).toBeCloseTo(ymdToYear(1939, 9, 1, 0));
    expect(d.end).toBeCloseTo(ymdToYear(1939, 10, 1, 0));
  });

  it('steps normal → months → days and back', () => {
    expect(deeper('normal')).toBe('months');
    expect(deeper('months')).toBe('days');
    expect(deeper('days')).toBeNull();
    expect(shallower('days')).toBe('months');
    expect(shallower('normal')).toBeNull();
    expect(levelOf(null)).toBe('normal');
    expect(levelOf(windowFor('days', sep1939))).toBe('days');
  });

  it('builds the "1939 › Sep 1939 › Collapse" trail', () => {
    expect(expandCrumbs(null)).toEqual([]);
    expect(expandCrumbs(windowFor('months', sep1939)).map((c) => c.label)).toEqual(['1939']);
    const days = expandCrumbs(windowFor('days', sep1939));
    expect(days.map((c) => c.label)).toEqual(['1939', 'Sep 1939']);
    expect(days[0].window).toMatchObject({ level: 'months', start: 1939 }); // tapping "1939" steps out to months
    expect(windowLabel(windowFor('days', sep1939))).toBe('Sep 1939');
  });

  it('has a tick per month, or per day', () => {
    expect(windowTicks(windowFor('months', sep1939))).toHaveLength(12);
    const days = windowTicks(windowFor('days', sep1939));
    expect(days).toHaveLength(30); // September
    expect(days.filter((t) => t.major).map((t) => t.label)).toEqual(['1 Sep 1939', '5 Sep 1939', '10 Sep 1939', '15 Sep 1939', '20 Sep 1939', '25 Sep 1939', '30 Sep 1939']);
  });

  it('picks how far to expand from a date\'s precision, and formats the HUD date to match', () => {
    expect(levelForPrecision('day')).toBe('days');
    expect(levelForPrecision('month')).toBe('months');
    expect(levelForPrecision('year')).toBe('normal');
    expect(formatForLevel(sep1939, 'days')).toBe('1 Sep 1939');
    expect(formatForLevel(sep1939, 'months')).toBe('Sep 1939');
    expect(formatForLevel(sep1939, 'normal')).toBe('1939');
  });
});

describe('time scale', () => {
  it('not expanded is the plain log scale', () => {
    expect(makeScale(null).toS(1939)).toBe(yearToS(1939));
  });

  for (const level of ['months', 'days'] as const) {
    const w = windowFor(level, sep1939)!;
    const scale = makeScale(w);

    it(`${level}: the expanded period is linear and exactly WINDOW_LENGTH long`, () => {
      const a = scale.toS(w.start);
      expect(scale.toS(w.end) - a).toBeCloseTo(WINDOW_LENGTH);
      expect(scale.toS((w.start + w.end) / 2) - a).toBeCloseTo(WINDOW_LENGTH / 2);
    });

    it(`${level}: later is always further along, and toYear undoes toS`, () => {
      const years = [-3000, 0, 1500, 1900, w.start, (w.start + w.end) / 2, w.end, 1990, 2026].sort((a, b) => a - b);
      let prev = -Infinity;
      for (const y of years) {
        const s = scale.toS(y);
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
        expect(scale.toYear(s)).toBeCloseTo(y, 6);
      }
    });

    it(`${level}: time outside is squeezed but still there`, () => {
      const before = scale.toS(w.start) - scale.toS(1800);
      expect(before).toBeCloseTo(OUTSIDE_SQUEEZE * (yearToS(w.start) - yearToS(1800)));
      expect(before).toBeGreaterThan(0);
    });
  }
});
