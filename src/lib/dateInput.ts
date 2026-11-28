// Turn a date typed by a person ("around 1920", "May 1962", "1918..1922") into a FuzzyDate.
//
// Personal spaces need this: family memories are rarely exact. The result is an ordinary
// FuzzyDate, so a vague date glows as a span on the river just like a public event's.
//
// Understood (case doesn't matter):
//   1962 · 1962-05 · 1962-05-04 · 4 May 1962 · May 1962      → known to the day / month / year
//   Christmas 2019 · Christmas Eve · Boxing Day · New Year's Day / Eve 2019 → that day
//   around 1920 · about · c. · circa · approx · abt · est · cal → ±2 years either side
//   1920s                                                     → the whole decade
//   1918..1922 · 1918-1922 · 1918 to 1922 · between 1918 and 1922 · from 1918 to 1922
//   before 1920 · bef 1920                                    → up to 10 years before
//   after 1920 · aft 1920                                     → up to 10 years after
// GEDCOM's date words (ABT, BEF, AFT, BET … AND, EST, CAL, FROM … TO) are the same
// words, so the GEDCOM importer (src/lib/gedcom.ts) uses this too.
import type { DateMethod, FuzzyDate } from '../types';
import { ymdToYear } from './dates';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "Around" means this many years either side. */
const AROUND_YEARS = 2;
/** "Before" / "after" reach this many years. */
const OPEN_YEARS = 10;

/** One exact-ish date: its range and how precisely it is known. */
type Point = Pick<FuzzyDate, 'earliest' | 'latest' | 'best' | 'precision'>;

/** Read one date with no qualifiers: "1962", "1962-05", "1962-05-04", "4 May 1962", "May 1962", "1920s". */
function point(text: string): Point | null {
  const t = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(t); // 1962-05-04
  if (m) return day(+m[1], +m[2], +m[3]);
  m = /^(\d{1,4})-(\d{1,2})$/.exec(t); // 1962-05
  if (m && +m[2] >= 1 && +m[2] <= 12) return month(+m[1], +m[2]);
  m = /^(\d{1,2}) ([a-z]+)\.? (\d{1,4})$/.exec(t); // 4 May 1962
  if (m && monthOf(m[2])) return day(+m[3], monthOf(m[2])!, +m[1]);
  m = /^([a-z]+)\.? (\d{1,2}) (\d{1,4})$/.exec(t); // May 4 1962
  if (m && monthOf(m[1])) return day(+m[3], monthOf(m[1])!, +m[2]);
  m = /^([a-z]+)\.? (\d{1,4})$/.exec(t); // May 1962
  if (m && monthOf(m[1])) return month(+m[2], monthOf(m[1])!);
  // Days families remember by name. (Not seasons: "summer" is a different month in each hemisphere.)
  m = /^(christmas eve|christmas|christmas day|xmas|boxing day|new year'?s eve|new year'?s day|new year'?s|new year) (\d{1,4})$/.exec(t);
  if (m) {
    const [mo, d] = m[1] === 'christmas eve' ? [12, 24] : m[1] === 'boxing day' ? [12, 26] : m[1].startsWith('new year') ? (m[1].endsWith('eve') ? [12, 31] : [1, 1]) : [12, 25];
    return day(+m[2], mo, d);
  }
  m = /^(\d{3})0s$/.exec(t); // 1920s
  if (m) {
    const y = +m[1] * 10;
    return { earliest: y, latest: y + 10, best: y + 5, precision: 'decade' };
  }
  m = /^(\d{1,4})$/.exec(t); // 1962
  if (m) return { earliest: +m[1], latest: +m[1] + 1, best: +m[1] + 0.5, precision: 'year' };
  return null;
}

function monthOf(word: string): number | null {
  const i = MONTHS.indexOf(word.slice(0, 3));
  return i >= 0 && (word.length === 3 || 'january february march april may june july august september october november december'.includes(word)) ? i + 1 : null;
}

function day(y: number, m: number, d: number): Point | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { earliest: ymdToYear(y, m, d, 0), latest: ymdToYear(y, m, d, 1), best: ymdToYear(y, m, d), precision: 'day' };
}

function month(y: number, m: number): Point {
  const earliest = ymdToYear(y, m, 1, 0);
  const latest = m === 12 ? ymdToYear(y + 1, 1, 1, 0) : ymdToYear(y, m + 1, 1, 0);
  return { earliest, latest, best: (earliest + latest) / 2, precision: 'month' };
}

/** A range from the start of one date to the end of another. Precision is the coarser of the two. */
function range(a: Point, b: Point): Point | null {
  if (b.latest < a.earliest) return null;
  const order = ['day', 'month', 'year', 'decade', 'century', 'millennium'];
  const precision = order.indexOf(a.precision) > order.indexOf(b.precision) ? a.precision : b.precision;
  return { earliest: a.earliest, latest: b.latest, best: (a.earliest + b.latest) / 2, precision };
}

/**
 * Parse typed text into a FuzzyDate, or null if it can't be read.
 * `method` defaults to "community" (proposed by you, not yet backed by a source); vague
 * words ("around", "est") make it a "scholarly_estimate" unless you say otherwise.
 */
export function parseDateText(text: string, method?: DateMethod, sources: string[] = []): FuzzyDate | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  const done = (p: Point | null, vague = false): FuzzyDate | null =>
    p ? { ...p, method: method ?? (vague ? 'scholarly_estimate' : 'community'), sources } : null;

  // Ranges: "between A and B", "from A to B", "A to B", "A..B", "A-B" (both whole years).
  let m = /^(?:bet(?:ween)?|from) (.+?) (?:and|to|-) (.+)$/.exec(t) ?? /^(.+?) (?:to|until|–|-) (.+)$/.exec(t) ?? /^(.+?)\s*\.\.\s*(.+)$/.exec(t) ?? /^(\d{3,4})[–-](\d{3,4})$/.exec(t);
  if (m) {
    const a = point(m[1]);
    const b = point(m[2]);
    return a && b ? done(range(a, b), true) : null;
  }
  // "around 1920" and friends: ±2 years.
  // (Longer words come first, so "circa" isn't read as "c" + "irca".)
  m = /^(?:around|about|approximately|approx\.?|abt\.?|calculated|cal\.?|circa|ca\.?|c\.?|estimated|est\.?|~)\s*(\d.*|[a-z]{3,}.*)$/.exec(t);
  const around = m && point(m[1]); // if what follows isn't a date ("christmas" ≠ "c" + "hristmas"), carry on
  if (around) return done({ ...around, earliest: around.earliest - AROUND_YEARS, latest: around.latest + AROUND_YEARS }, true);
  // "before 1920" / "after 1920": up to 10 years on that side.
  m = /^(?:before|bef\.?)\s+(.+)$/.exec(t);
  if (m) {
    const p = point(m[1]);
    return p ? done({ earliest: p.earliest - OPEN_YEARS, latest: p.earliest, best: p.earliest - 1, precision: 'decade' }, true) : null;
  }
  m = /^(?:after|aft\.?)\s+(.+)$/.exec(t);
  if (m) {
    const p = point(m[1]);
    return p ? done({ earliest: p.latest, latest: p.latest + OPEN_YEARS, best: p.latest + 1, precision: 'decade' }, true) : null;
  }
  // "(around 1920)" written with GEDCOM's "INT" (interpreted) or a trailing note: ignore what's in brackets.
  const bare = t.replace(/^int\s+/, '').replace(/\(.*\)$/, '').trim();
  return done(point(bare));
}
