// Tests for reading typed dates ("around 1920") into FuzzyDates.
import { describe, expect, it } from 'vitest';
import { parseDateText } from './dateInput';
import { hasWideRange, yearToYmd } from './dates';

const ymd = (t: number) => yearToYmd(t + 1e-7);

describe('parseDateText', () => {
  it('reads exact dates to the day, month or year', () => {
    const d = parseDateText('1962-05-04')!;
    expect(d.precision).toBe('day');
    expect(ymd(d.best)).toEqual({ y: 1962, m: 5, d: 4 });
    expect(parseDateText('4 May 1962')!.best).toBeCloseTo(d.best, 9);
    expect(parseDateText('May 4, 1962')!.best).toBeCloseTo(d.best, 9);
    expect(parseDateText('May 1962')).toMatchObject({ precision: 'month' });
    expect(parseDateText('1962-05')).toMatchObject({ precision: 'month' });
    expect(parseDateText('1962')).toMatchObject({ earliest: 1962, latest: 1963, best: 1962.5, precision: 'year', method: 'community' });
  });

  it('"around 1920" is a glowing span two years either side, marked as an estimate', () => {
    const d = parseDateText('around 1920')!;
    expect(d).toMatchObject({ earliest: 1918, latest: 1923, best: 1920.5, method: 'scholarly_estimate' });
    expect(hasWideRange(d)).toBe(true); // so the river draws a span
    for (const t of ['c. 1920', 'c1920', 'circa 1920', 'abt 1920', 'ABT 1920', 'about 1920', 'est 1920', 'CAL 1920', '~1920']) {
      expect(parseDateText(t), t).toMatchObject({ earliest: 1918, latest: 1923 });
    }
  });

  it('reads decades, ranges and open-ended dates', () => {
    expect(parseDateText('1920s')).toMatchObject({ earliest: 1920, latest: 1930, best: 1925, precision: 'decade' });
    for (const t of ['1918..1922', '1918-1922', '1918 to 1922', 'between 1918 and 1922', 'BET 1918 AND 1922', 'FROM 1918 TO 1922']) {
      expect(parseDateText(t), t).toMatchObject({ earliest: 1918, latest: 1923, best: 1920.5 });
    }
    expect(parseDateText('before 1920')).toMatchObject({ earliest: 1910, latest: 1920 });
    expect(parseDateText('AFT 1920')).toMatchObject({ earliest: 1921, latest: 1931 });
  });

  it('reads days families remember by name', () => {
    expect(ymd(parseDateText('Christmas 2019')!.best)).toEqual({ y: 2019, m: 12, d: 25 });
    expect(ymd(parseDateText('christmas eve 2019')!.best)).toEqual({ y: 2019, m: 12, d: 24 });
    expect(ymd(parseDateText("New Year's Day 2020")!.best)).toEqual({ y: 2020, m: 1, d: 1 });
    expect(ymd(parseDateText("new year's eve 1999")!.best)).toEqual({ y: 1999, m: 12, d: 31 });
    expect(parseDateText('summer 1962')).toBeNull(); // which hemisphere? Don't guess.
  });

  it('keeps the method and sources it is given', () => {
    expect(parseDateText('1962', 'documented', ['s1'])).toMatchObject({ method: 'documented', sources: ['s1'] });
  });

  it('returns null for text it cannot read, never a guess', () => {
    for (const t of ['', 'sometime', 'Smarch 1962', '1962-13', '1922..1918', 'the war']) expect(parseDateText(t), t).toBeNull();
  });
});
