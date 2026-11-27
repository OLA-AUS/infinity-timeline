// Pure helpers for the Wikidata importer: build SPARQL queries and turn Wikidata's
// answers into our event JSON. No network or file access here, so it's easy to test
// (see wikidata.test.mjs). The script that uses this is scripts/import-wikidata-ww2.mjs.

/** Wikidata item for "World War II". */
export const WW2 = 'Q362';
/** "occurrence" — the top class for things that happen. Used to keep only events. */
export const OCCURRENCE = 'Q1190554';
/** Classes we never want, even if they're linked to WW2: military units, humans. */
export const EXCLUDE = ['Q176799', 'Q5'];

/** Wikidata's precision numbers → ours. (11 = day … 6 = millennium.) */
const PRECISION = { 11: 'day', 10: 'month', 9: 'year', 8: 'decade', 7: 'century', 6: 'millennium' };

// ---- Queries ------------------------------------------------------------------

/**
 * Step 1: candidates. Anything that is part of WW2 (directly, or part of a part),
 * or whose "conflict" is WW2, and has a date. Most-linked first, so the most notable
 * events come first. We also fetch each item's classes for step 2.
 */
export function candidatesQuery(limit) {
  return `
SELECT ?item ?sitelinks (GROUP_CONCAT(DISTINCT STRAFTER(STR(?cls), "entity/"); separator=" ") AS ?classes) WHERE {
  { SELECT DISTINCT ?item ?sitelinks WHERE {
      { ?item wdt:P361 wd:${WW2} . } UNION { ?item wdt:P361/wdt:P361 wd:${WW2} . } UNION { ?item wdt:P607 wd:${WW2} . }
      FILTER EXISTS { ?item wdt:P585|wdt:P580 [] . }
      ?item wikibase:sitelinks ?sitelinks .
    } ORDER BY DESC(?sitelinks) ?item LIMIT ${Number(limit)} }
  OPTIONAL { ?item wdt:P31 ?cls . }
} GROUP BY ?item ?sitelinks
ORDER BY DESC(?sitelinks) ?item`;
}

/**
 * Step 2: which of those classes are kinds of "occurrence" (or kinds of things we exclude)?
 * "gearing forward" makes Wikidata walk UP from each class, which is fast. Without it the
 * query walks down from "occurrence" through millions of subclasses and times out.
 */
export function classQuery(classIds) {
  const values = classIds.map((c) => `wd:${c}`).join(' ');
  const targets = [OCCURRENCE, ...EXCLUDE].map((c) => `wd:${c}`).join(' ');
  return `
SELECT DISTINCT ?cls ?sup WHERE {
  VALUES ?cls { ${values} }
  VALUES ?sup { ${targets} }
  ?cls wdt:P279* ?sup . hint:Prior hint:gearing "forward" .
}`;
}

/**
 * Step 3: details for a batch of items — label, description, Wikipedia link and dates.
 * Dates: P585 "point in time", P580 "start time", P582 "end time". Their qualifiers
 * P1319 "earliest date" / P1326 "latest date" give honest ranges when Wikidata has them.
 * Deprecated statements (known to be wrong) are skipped.
 */
export function detailsQuery(qids, lang = 'en') {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  const dateBlock = (prop, name) => `
  OPTIONAL { ?item p:${prop} ?${name}S . ?${name}S psv:${prop} ?${name}V ; wikibase:rank ?${name}R .
             FILTER(?${name}R != wikibase:DeprecatedRank)
             ?${name}V wikibase:timeValue ?${name}Time ; wikibase:timePrecision ?${name}Prec .
             OPTIONAL { ?${name}S pq:P1319 ?${name}Earliest } OPTIONAL { ?${name}S pq:P1326 ?${name}Latest } }`;
  return `
SELECT ?item ?itemLabel ?itemDescription ?enwiki
       ?pointTime ?pointPrec ?pointEarliest ?pointLatest
       ?startTime ?startPrec ?startEarliest ?startLatest
       ?endTime ?endPrec ?endEarliest ?endLatest WHERE {
  VALUES ?item { ${values} }
  ${dateBlock('P585', 'point')}
  ${dateBlock('P580', 'start')}
  ${dateBlock('P582', 'end')}
  OPTIONAL { ?enwiki schema:about ?item ; schema:isPartOf <https://${lang}.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},mul". }
}`;
}

// ---- Dates ------------------------------------------------------------------------

const DAY_MS = 86_400_000;
function utc(y, m, d) {
  const t = new Date(Date.UTC(2000, m - 1, d));
  t.setUTCFullYear(y);
  return t.getTime();
}

/** Calendar date → decimal year. Same maths as ymdToYear in src/lib/dates.ts — keep in sync. */
export function ymdToYear(y, m = 1, d = 1, dayFraction = 0.5) {
  const start = utc(y, 1, 1);
  const length = utc(y + 1, 1, 1) - start;
  return y + (utc(y, m, d) - start + dayFraction * DAY_MS) / length;
}

/** "1944-06-06T00:00:00Z" → { y: 1944, m: 6, d: 6 }. Month/day of 0 (unknown) become 1. */
export function parseTime(value) {
  const m = /^([+-]?\d+)-(\d\d)-(\d\d)/.exec(value);
  if (!m) return null;
  // Note: for BCE dates Wikidata's year numbering needs care; WW2 doesn't need it.
  return { y: Number(m[1]), m: Math.max(1, Number(m[2])), d: Math.max(1, Number(m[3])) };
}

const round = (n) => Math.round(n * 1e6) / 1e6; // ~30 seconds — keeps JSON diffs tidy

/**
 * One Wikidata time value → our { earliest, latest, best, precision }.
 * The range covers the whole unit of precision: "June 1944" (month precision) means
 * any time from 1 June to 30 June, and the best guess is the middle of it.
 */
export function valueToRange(time, precisionNumber, earliestQ, latestQ) {
  const t = parseTime(time);
  if (!t) return null;
  const precision = PRECISION[precisionNumber] ?? (precisionNumber > 11 ? 'day' : 'millennium');
  let earliest;
  let latest;
  switch (precision) {
    case 'day':
      earliest = ymdToYear(t.y, t.m, t.d, 0);
      latest = ymdToYear(t.y, t.m, t.d, 1);
      break;
    case 'month':
      earliest = ymdToYear(t.y, t.m, 1, 0);
      latest = t.m === 12 ? ymdToYear(t.y + 1, 1, 1, 0) : ymdToYear(t.y, t.m + 1, 1, 0);
      break;
    case 'year':
      earliest = t.y;
      latest = t.y + 1;
      break;
    default: {
      // decade / century / millennium: Wikidata stores a year inside the period.
      const size = { decade: 10, century: 100, millennium: 1000 }[precision];
      earliest = Math.floor(t.y / size) * size;
      latest = earliest + size;
    }
  }
  const best = precision === 'day' ? ymdToYear(t.y, t.m, t.d) : (earliest + latest) / 2;
  // Explicit "earliest date" / "latest date" qualifiers widen the range.
  const qe = earliestQ && parseTime(earliestQ);
  const ql = latestQ && parseTime(latestQ);
  if (qe) earliest = Math.min(earliest, ymdToYear(qe.y, qe.m, qe.d, 0));
  if (ql) latest = Math.max(latest, ymdToYear(ql.y, ql.m, ql.d, 1));
  return { earliest, latest, best, precision, iso: time.slice(0, 10) };
}

const PRECISION_RANK = { day: 0, month: 1, year: 2, decade: 3, century: 4, millennium: 5 };

/**
 * Several values for one date (Wikidata sometimes has more than one) → one FuzzyDate.
 * The best guess comes from the most precise value (earliest one if tied); the range
 * covers every value, so disagreement shows up as a wider glowing span.
 */
export function mergeValues(values, qid) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => PRECISION_RANK[a.precision] - PRECISION_RANK[b.precision] || a.best - b.best);
  const top = sorted[0];
  const distinct = [...new Set(values.map((v) => v.iso))].sort();
  return {
    date: {
      earliest: round(Math.min(...values.map((v) => v.earliest))),
      latest: round(Math.max(...values.map((v) => v.latest))),
      best: round(top.best),
      precision: top.precision,
      method: 'wikidata',
      sources: [`wikidata:${qid}`],
    },
    conflicting: distinct.length > 1 ? distinct : undefined,
  };
}

// ---- Rows → events ------------------------------------------------------------------

const qidOf = (uri) => uri.slice(uri.lastIndexOf('/') + 1);

/** Group the detail query's rows (one row per combination of values) by item, de-duplicating. */
export function groupDetails(bindings) {
  const items = new Map();
  for (const b of bindings) {
    const qid = qidOf(b.item.value);
    if (!items.has(qid)) {
      items.set(qid, { qid, label: b.itemLabel?.value, description: b.itemDescription?.value, wikipedia: b.enwiki?.value, point: new Map(), start: new Map(), end: new Map() });
    }
    const it = items.get(qid);
    for (const kind of ['point', 'start', 'end']) {
      const time = b[`${kind}Time`]?.value;
      if (!time) continue;
      const prec = Number(b[`${kind}Prec`]?.value);
      const key = `${time}|${prec}|${b[`${kind}Earliest`]?.value ?? ''}|${b[`${kind}Latest`]?.value ?? ''}`;
      if (!it[kind].has(key)) it[kind].set(key, valueToRange(time, prec, b[`${kind}Earliest`]?.value, b[`${kind}Latest`]?.value));
    }
  }
  return items;
}

/**
 * One grouped item → our event JSON (the shape documented in data/schema/event.schema.json),
 * or null if it can't be used (no English label, no usable date).
 */
export function itemToEvent(item, { retrievedAt, field = 'politics', sitelinks }) {
  if (!item.label || item.label === item.qid) return null; // no English name yet
  const points = [...item.point.values()].filter(Boolean);
  const starts = [...item.start.values()].filter(Boolean);
  const ends = [...item.end.values()].filter(Boolean);

  // Use whichever of "point in time" / "start time" is more precise (point wins ties).
  const finest = (vs) => Math.min(...vs.map((v) => PRECISION_RANK[v.precision]));
  const useStart = starts.length && (!points.length || finest(starts) < finest(points));
  const main = mergeValues(useStart ? starts : points, item.qid);
  if (!main) return null;
  const end = mergeValues(ends, item.qid);

  const provenance = { importedFrom: 'wikidata', qid: item.qid, retrievedAt };
  if (item.wikipedia) provenance.wikipedia = item.wikipedia;
  if (Number.isInteger(sitelinks)) provenance.sitelinks = sitelinks;
  if (main.conflicting) provenance.conflictingValues = main.conflicting;
  provenance.manualEdits = false;

  const event = {
    $schema: '../../schema/event.schema.json',
    id: `wd_${item.qid}`,
    title: item.label,
    summary: item.description ?? '',
    field,
    date: main.date,
  };
  if (end && end.date.best >= main.date.best) event.end = end.date;
  event.topicIds = [];
  event.provenance = provenance;
  return event;
}

/** Keep candidates that are events: at least one class is an occurrence, none excluded. */
export function filterEvents(candidates, classInfo) {
  return candidates.filter((c) => c.classes.some((k) => classInfo.occurrence.has(k)) && !c.classes.some((k) => classInfo.excluded.has(k)));
}

/** Parse step 2's rows into two sets of class ids. */
export function parseClassRows(bindings) {
  const occurrence = new Set();
  const excluded = new Set();
  for (const b of bindings) {
    const cls = qidOf(b.cls.value);
    if (qidOf(b.sup.value) === OCCURRENCE) occurrence.add(cls);
    else excluded.add(cls);
  }
  return { occurrence, excluded };
}

/** Read an exclude list: one Q-id per line, "#" starts a comment (the reason). */
export function parseExcludeList(text) {
  return new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*/, '').trim())
      .filter((l) => /^Q\d+$/.test(l)),
  );
}

/** Parse step 1's rows. */
export function parseCandidateRows(bindings) {
  return bindings.map((b) => ({
    qid: qidOf(b.item.value),
    sitelinks: Number(b.sitelinks.value),
    classes: (b.classes?.value ?? '').split(' ').filter(Boolean),
  }));
}
