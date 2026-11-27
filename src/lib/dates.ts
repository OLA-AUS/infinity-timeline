// Helpers for uncertain dates ("FuzzyDate"). See the FuzzyDate type in src/types.ts.
//
// In short: every date has a best guess plus an honest earliest/latest range,
// a precision ("we only know the month") and a method ("radiocarbon", "documented").
// This file builds those objects, turns them into readable text, and converts
// between calendar dates and the decimal years the river uses.
import type { DateMethod, DatePrecision, FuzzyDate, Year } from '../types';

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Midnight UTC on a calendar day. Works for years 0–99 too (plain Date.UTC would read 45 as 1945). */
function utc(y: number, m: number, d: number): number {
  const t = new Date(Date.UTC(2000, m - 1, d));
  t.setUTCFullYear(y);
  return t.getTime();
}

/**
 * Calendar date → decimal year. By default we point at midday, so "1 Sep 1939"
 * sits in the middle of that day rather than on the boundary with 31 August.
 * Note: scripts/lib/wikidata.mjs has a copy of this for the importer — keep them in sync.
 */
export function ymdToYear(y: number, m = 1, d = 1, dayFraction = 0.5): Year {
  const start = utc(y, 1, 1);
  const length = utc(y + 1, 1, 1) - start;
  return y + (utc(y, m, d) - start + dayFraction * DAY_MS) / length;
}

/** Decimal year → calendar date (the day the moment falls in). */
export function yearToYmd(year: Year): { y: number; m: number; d: number } {
  const y = Math.floor(year);
  const start = utc(y, 1, 1);
  const length = utc(y + 1, 1, 1) - start;
  const t = new Date(start + (year - y) * length);
  return { y, m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Roughly how long one unit of each precision is, in years. */
export const PRECISION_YEARS: Record<DatePrecision, number> = {
  day: 1 / 365.25,
  month: 1 / 12,
  year: 1,
  decade: 10,
  century: 100,
  millennium: 1000,
};

/** Plain-English descriptions, shown in the date "Explain" box. */
export const PRECISION_LABEL: Record<DatePrecision, string> = {
  day: 'known to the day',
  month: 'known to the month',
  year: 'known to the year',
  decade: 'known to the decade',
  century: 'known to the century',
  millennium: 'known to the millennium',
};

export const METHOD_LABEL: Record<DateMethod, string> = {
  documented: 'Recorded at the time in a dated document',
  contemporary_accounts: 'Pieced together from eyewitness accounts',
  archaeological: 'Dated from archaeological finds',
  radiocarbon: 'Lab-dated (e.g. radiocarbon)',
  scholarly_estimate: 'Historians’ estimate from indirect evidence',
  wikidata: 'Imported from Wikidata — needs checking against a primary source',
  community: 'Proposed by an editor — not yet backed by a source',
};

// ---- Building dates ---------------------------------------------------------
// These keep seed data short and readable: onDay(1939, 9, 1) instead of a big object.

interface Extra {
  method?: DateMethod;
  sources?: string[];
}

/** An event known to the exact day. */
export function onDay(y: number, m: number, d: number, { method = 'documented', sources = [] }: Extra = {}): FuzzyDate {
  return { earliest: ymdToYear(y, m, d, 0), latest: ymdToYear(y, m, d, 1), best: ymdToYear(y, m, d), precision: 'day', method, sources };
}

/** An event known only to the month. The best guess is mid-month. */
export function inMonth(y: number, m: number, { method = 'documented', sources = [] }: Extra = {}): FuzzyDate {
  const earliest = ymdToYear(y, m, 1, 0);
  const latest = m === 12 ? ymdToYear(y + 1, 1, 1, 0) : ymdToYear(y, m + 1, 1, 0);
  return { earliest, latest, best: (earliest + latest) / 2, precision: 'month', method, sources };
}

/** An event known only to the year. The best guess is mid-year. */
export function inYear(y: number, { method = 'documented', sources = [] }: Extra = {}): FuzzyDate {
  return { earliest: y, latest: y + 1, best: y + 0.5, precision: 'year', method, sources };
}

/** A date with an explicit range, e.g. "c. 1440, somewhere between 1436 and 1450". */
export function between(
  earliest: Year,
  latest: Year,
  best: Year,
  precision: DatePrecision,
  { method = 'scholarly_estimate', sources = [] }: Extra = {},
): FuzzyDate {
  return { earliest, latest, best, precision, method, sources };
}

// ---- Reading dates ----------------------------------------------------------

/** How wide the honest range is, in years. */
export const spanYears = (d: FuzzyDate) => d.latest - d.earliest;

/** True when the range is wider than the precision alone explains (e.g. an estimate or a dispute). */
export const hasWideRange = (d: FuzzyDate) => spanYears(d) > PRECISION_YEARS[d.precision] * 1.01;

/** Year as text, with BCE for negative years. */
export function formatYear(y: Year): string {
  const r = Math.floor(y);
  return r < 0 ? `${-r} BCE` : `${r}`;
}

/** One moment as text, at a given precision: "1 Sep 1939", "Sep 1939", "1930s"... */
export function formatAt(year: Year, precision: DatePrecision): string {
  switch (precision) {
    case 'day': {
      const { y, m, d } = yearToYmd(year);
      return `${d} ${MONTHS[m - 1]} ${formatYear(y)}`;
    }
    case 'month': {
      const { y, m } = yearToYmd(year);
      return `${MONTHS[m - 1]} ${formatYear(y)}`;
    }
    case 'year':
      return formatYear(year);
    case 'decade': {
      const dec = Math.floor(year / 10) * 10;
      return dec < 0 ? `${-dec}s BCE` : `${dec}s`;
    }
    case 'century': {
      const c = Math.floor(Math.abs(year) / 100) + 1;
      return `${ordinal(c)} century${year < 0 ? ' BCE' : ''}`;
    }
    case 'millennium': {
      const k = Math.floor(Math.abs(year) / 1000) + 1;
      return `${ordinal(k)} millennium${year < 0 ? ' BCE' : ''}`;
    }
  }
}

/**
 * A whole FuzzyDate as text.
 * Precise dates read normally ("1 Sep 1939"). Wide ranges read as
 * "c. 1440 (1436–1450)" so nobody mistakes an estimate for a fact.
 */
export function formatDate(d: FuzzyDate): string {
  if (!hasWideRange(d)) return formatAt(d.best, d.precision);
  // Show the range at a precision fine enough to see both ends differ.
  const rangePrecision: DatePrecision = spanYears(d) < 1 ? (d.precision === 'day' ? 'day' : 'month') : 'year';
  const best = formatAt(d.best, d.precision === 'day' || d.precision === 'month' ? d.precision : 'year');
  return `c. ${best} (${formatAt(d.earliest, rangePrecision)} – ${formatAt(d.latest - 1e-6, rangePrecision)})`;
}

/** Short label for crowded places such as the 3D river. */
export function formatShort(d: FuzzyDate): string {
  return hasWideRange(d) ? `c. ${formatYear(d.best)}` : formatAt(d.best, d.precision === 'day' ? 'month' : d.precision);
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}
