#!/usr/bin/env node
// Turn an ordinary date into the JSON a data file needs, so nobody has to work out
// decimal years by hand. Paste the output into the "date" (or "end") of an event file.
//
//   npm run date -- 1944-06-06                         known to the day
//   npm run date -- 1928-09                            known to the month
//   npm run date -- 1440                               known to the year
//   npm run date -- 1436..1451 --best 1440             a range, with a best guess
//   npm run date -- 1939-09-01 --method documented --source my_book_id
//
// Methods: documented, contemporary_accounts, archaeological, radiocarbon,
//          scholarly_estimate, wikidata, community (the default — "not yet sourced").
import { ymdToYear } from './lib/wikidata.mjs';
import { METHODS } from './lib/validate.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const all = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const input = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

if (!input) {
  console.log('Usage: npm run date -- <YYYY | YYYY-MM | YYYY-MM-DD | FROM..TO> [--best YYYY[-MM[-DD]]] [--method M] [--source ID]');
  process.exit(1);
}

/** Parse "1944", "1944-06" or "1944-06-06" (a leading "-" means BCE) into a range. */
function parse(text) {
  const m = /^(-?\d+)(?:-(\d\d))?(?:-(\d\d))?$/.exec(text.trim());
  if (!m) throw new Error(`Can't read "${text}". Use YYYY, YYYY-MM or YYYY-MM-DD.`);
  const y = Number(m[1]);
  if (m[3]) return { earliest: ymdToYear(y, +m[2], +m[3], 0), latest: ymdToYear(y, +m[2], +m[3], 1), best: ymdToYear(y, +m[2], +m[3]), precision: 'day' };
  if (m[2]) {
    const mo = +m[2];
    const earliest = ymdToYear(y, mo, 1, 0);
    const latest = mo === 12 ? ymdToYear(y + 1, 1, 1, 0) : ymdToYear(y, mo + 1, 1, 0);
    return { earliest, latest, best: (earliest + latest) / 2, precision: 'month' };
  }
  return { earliest: y, latest: y + 1, best: y + 0.5, precision: 'year' };
}

const round = (n) => Math.round(n * 1e6) / 1e6;
const method = opt('method') ?? 'community';
if (!METHODS.includes(method)) {
  console.error(`Unknown method "${method}". Use one of: ${METHODS.join(', ')}`);
  process.exit(1);
}

let date;
if (input.includes('..')) {
  // A range: precision is set by how wide it is.
  const [a, b] = input.split('..').map(parse);
  const span = b.latest - a.earliest;
  const precision = span <= 0.1 ? 'month' : span <= 1.5 ? 'year' : span <= 25 ? 'decade' : span <= 250 ? 'century' : 'millennium';
  const best = opt('best') ? parse(opt('best')).best : (a.earliest + b.latest) / 2;
  date = { earliest: a.earliest, latest: b.latest, best, precision };
} else {
  date = parse(input);
}
if (!(date.earliest <= date.best && date.best <= date.latest)) {
  console.error('The best guess must fall inside the range.');
  process.exit(1);
}

const out = { earliest: round(date.earliest), latest: round(date.latest), best: round(date.best), precision: date.precision, method, sources: all('source') };
console.log(JSON.stringify(out, null, 2));
