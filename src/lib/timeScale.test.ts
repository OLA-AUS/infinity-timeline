// Tests for river zoom: windows, the year ⇄ distance mapping, breadcrumbs and cluster zoom.
import { describe, expect, it } from 'vitest';
import { ymdToYear } from './dates';
import { yearToS } from './time';
import {
  breadcrumb,
  deeper,
  levelForPrecision,
  makeScale,
  OUTSIDE_SQUEEZE,
  shallower,
  WINDOW_LENGTH,
  windowFor,
  windowLabel,
  windowTicks,
  zoomForSpan,
} from './timeScale';

const sep1939 = ymdToYear(1939, 9, 1);

describe('zoom windows', () => {
  it('finds the calendar period around a date at every level', () => {
    expect(windowFor('all', sep1939)).toBeNull();
    expect(windowFor('century', sep1939)).toMatchObject({ start: 1900, end: 2000 });
    expect(windowFor('decade', sep1939)).toMatchObject({ start: 1930, end: 1940 });
    expect(windowFor('year', sep1939)).toMatchObject({ start: 1939, end: 1940 });
    const m = windowFor('month', sep1939)!;
    expect(m.start).toBeCloseTo(ymdToYear(1939, 9, 1, 0));
    expect(m.end).toBeCloseTo(ymdToYear(1939, 10, 1, 0));
    const d = windowFor('day', sep1939)!;
    expect(d.end - d.start).toBeCloseTo(1 / 365, 5);
  });

  it('labels and breadcrumbs read like the spec', () => {
    const w = windowFor('month', sep1939);
    expect(breadcrumb(w).map((c) => c.label)).toEqual(['All time', '1900s', '1930s', '1939', 'Sep 1939']);
    expect(windowLabel(windowFor('day', sep1939))).toBe('1 Sep 1939');
    expect(breadcrumb(null).map((c) => c.label)).toEqual(['All time']);
  });

  it('steps between levels', () => {
    expect(deeper('all')).toBe('century');
    expect(deeper('day')).toBeNull();
    expect(shallower('century')).toBe('all');
    expect(shallower('all')).toBeNull();
  });

  it('picks a sensible level for a date precision', () => {
    expect(levelForPrecision('day')).toBe('month');
    expect(levelForPrecision('century')).toBe('all');
  });

  it('has ticks for each level', () => {
    expect(windowTicks(windowFor('decade', sep1939))).toHaveLength(10);
    expect(windowTicks(windowFor('year', sep1939))).toHaveLength(12);
    expect(windowTicks(windowFor('month', sep1939))).toHaveLength(30); // September
    expect(windowTicks(windowFor('day', sep1939))).toHaveLength(4);
  });
});

describe('time scale', () => {
  it('"all time" is the plain log scale', () => {
    const s = makeScale(null);
    expect(s.toS(1939)).toBe(yearToS(1939));
  });

  for (const level of ['century', 'decade', 'year', 'month', 'day'] as const) {
    const w = windowFor(level, sep1939)!;
    const scale = makeScale(w);

    it(`${level}: the window is linear and exactly WINDOW_LENGTH long`, () => {
      const a = scale.toS(w.start);
      expect(scale.toS(w.end) - a).toBeCloseTo(WINDOW_LENGTH);
      expect(scale.toS((w.start + w.end) / 2) - a).toBeCloseTo(WINDOW_LENGTH / 2);
    });

    it(`${level}: later is always further along, and toYear undoes toS`, () => {
      let prev = -Infinity;
      const years = [-3000, 0, 1500, 1900, w.start, (w.start + w.end) / 2, w.end, 1990, 2026].sort((a, b) => a - b);
      for (const y of years) {
        const s = scale.toS(y);
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
        expect(scale.toYear(s)).toBeCloseTo(y, 6);
      }
    });

    it(`${level}: time outside the window is squeezed but still there`, () => {
      const before = scale.toS(w.start) - scale.toS(1800);
      expect(before).toBeCloseTo(OUTSIDE_SQUEEZE * (yearToS(w.start) - yearToS(1800)));
      expect(before).toBeGreaterThan(0);
    });
  }
});

describe('zooming to a cluster', () => {
  it('zooms to the narrowest period that holds the whole cluster', () => {
    expect(zoomForSpan(ymdToYear(1944, 6, 6), ymdToYear(1944, 6, 25), 'all')).toMatchObject({ level: 'month' });
    expect(zoomForSpan(1941.0, 1944.4, 'all')).toMatchObject({ level: 'decade', start: 1940 });
    expect(zoomForSpan(1939.7, 1944.4, 'all')).toMatchObject({ level: 'century', start: 1900 }); // crosses decades
  });

  it('if that is no closer than now, goes one level in around the middle', () => {
    // 1939–1941 crosses a decade boundary, so only the century holds it; we're already there.
    expect(zoomForSpan(1939.5, 1941.2, 'century')).toMatchObject({ level: 'decade', start: 1940 });
  });

  it('cannot zoom past a single day', () => {
    expect(zoomForSpan(sep1939, sep1939, 'day')).toBeUndefined();
  });
});
