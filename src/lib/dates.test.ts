// Tests for uncertain dates and date disputes.
import { describe, expect, it } from 'vitest';
import { seed } from '../data/seed';
import { between, formatDate, hasWideRange, inMonth, inYear, onDay, yearToYmd, ymdToYear } from './dates';
import { resolveEventDate } from './dateDispute';
import type { Dataset } from '../types';

describe('calendar ↔ decimal year', () => {
  it('round-trips a date', () => {
    expect(yearToYmd(ymdToYear(1939, 9, 1))).toEqual({ y: 1939, m: 9, d: 1 });
    expect(yearToYmd(ymdToYear(2024, 2, 29))).toEqual({ y: 2024, m: 2, d: 29 }); // leap day
    expect(yearToYmd(ymdToYear(45, 3, 15))).toEqual({ y: 45, m: 3, d: 15 }); // two-digit year isn't read as 1945
  });

  it('puts 1 Sep 1939 about two-thirds through the year', () => {
    expect(ymdToYear(1939, 9, 1)).toBeCloseTo(1939.668, 2);
  });
});

describe('FuzzyDate helpers', () => {
  it('always keep earliest <= best <= latest', () => {
    for (const d of [onDay(1969, 7, 20), inMonth(1928, 12), inYear(1440), between(-3400, -3100, -3200, 'century')]) {
      expect(d.earliest).toBeLessThanOrEqual(d.best);
      expect(d.best).toBeLessThanOrEqual(d.latest);
    }
  });

  it('formats precise dates plainly and estimates with a range', () => {
    expect(formatDate(onDay(1939, 9, 1))).toBe('1 Sep 1939');
    expect(formatDate(inMonth(1928, 9))).toBe('Sep 1928');
    expect(formatDate(inYear(1440))).toBe('1440');
    expect(formatDate(between(1436, 1451, 1440, 'decade'))).toBe('c. 1440 (1436 – 1450)');
    expect(formatDate(between(-3400, -3100, -3200, 'century'))).toBe('c. 3200 BCE (3400 BCE – 3101 BCE)');
  });

  it('flags ranges wider than their precision', () => {
    expect(hasWideRange(onDay(1939, 9, 1))).toBe(false);
    expect(hasWideRange(between(1436, 1451, 1440, 'decade'))).toBe(true);
  });

  it('every seed event and entity has a valid date', () => {
    for (const d of [...seed.events.map((e) => e.date), ...seed.entities.map((e) => e.founded)]) {
      expect(d.earliest).toBeLessThanOrEqual(d.best);
      expect(d.best).toBeLessThanOrEqual(d.latest);
    }
  });
});

describe('date disputes', () => {
  const ww2 = seed.events.find((e) => e.id === 'ev_ww2')!;

  it('undisputed events keep their recorded date', () => {
    const moon = seed.events.find((e) => e.id === 'ev_moon')!;
    const r = resolveEventDate(moon, seed);
    expect(r.disputed).toBe(false);
    expect(r.date).toEqual(moon.date);
  });

  it('two Contested start dates for WW2 widen the span to cover both', () => {
    const r = resolveEventDate(ww2, seed);
    const byId = Object.fromEntries(r.contenders.map((c) => [c.claim.id, c.status]));
    expect(byId).toEqual({ c_start_1939: 'Contested', c_start_1937: 'Contested', c_start_1931: 'Fringe' });
    expect(r.disputed).toBe(true);
    expect(r.date.earliest).toBeLessThan(ymdToYear(1937, 7, 8)); // covers 7 July 1937…
    expect(r.date.latest).toBeGreaterThan(ymdToYear(1939, 9, 1)); // …through 1 Sep 1939
    expect(r.date.earliest).toBeGreaterThan(1932); // but not the Fringe 1931 proposal
    expect(r.date.best).toBe(ww2.date.best); // marker stays on the recorded date
  });

  it('once evidence establishes one date, the dispute is settled and that date wins', () => {
    // Pile strong, well-sourced counter-evidence on 1937 and extra support on 1939.
    const settled: Dataset = {
      ...seed,
      evidence: seed.evidence.map((e) =>
        e.claimId === 'c_start_1939' && e.direction === 'against' ? { ...e, relevance: 0.05 } : e,
      ),
    };
    const r = resolveEventDate(ww2, settled);
    expect(r.contenders.find((c) => c.claim.id === 'c_start_1939')!.status).toBe('Established');
    expect(r.disputed).toBe(false);
    expect(r.date.best).toBeCloseTo(ymdToYear(1939, 9, 1));
  });

  it('agree votes cannot settle a date dispute', () => {
    const mob: Dataset = { ...seed, claims: seed.claims.map((c) => (c.id === 'c_start_1931' ? { ...c, agree: { up: 1e7, down: 0 } } : c)) };
    const r = resolveEventDate(ww2, mob);
    expect(r.contenders.find((c) => c.claim.id === 'c_start_1931')!.status).toBe('Fringe');
    expect(r.date.earliest).toBeGreaterThan(1932);
  });
});
