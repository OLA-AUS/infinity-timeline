#!/usr/bin/env node
// Import World War II events from Wikidata into data/events/ww2/, one JSON file per event.
//
//   npm run import:ww2                      # default: the 250 most notable events
//   npm run import:ww2 -- --limit 500       # more events
//   npm run import:ww2 -- --dry-run         # show what would change, write nothing
//   npm run import:ww2 -- --force           # also overwrite files people have edited by hand
//
// How it works (three small queries rather than one huge one, so Wikidata doesn't time out):
//   1. find candidates linked to WW2 that have a date, most-linked first
//   2. keep only real events (things Wikidata classes as an "occurrence"; not people or units)
//   3. fetch names, descriptions and dates, and convert them (scripts/lib/wikidata.mjs)
//   4. fetch relations between those events (part of, has cause, followed by…) → "links"
//
// Safe to re-run. Nothing is ever deleted: events that drop out of the results keep their
// files. Files with "manualEdits": true are skipped so hand corrections are never lost.
// Q-ids listed in data/import/wikidata-ww2.exclude.txt are never imported.
//
// Please be polite to Wikidata: set WIKIDATA_USER_AGENT to something with contact details,
// e.g. WIKIDATA_USER_AGENT="my-timeline-fork/1.0 (you@example.org)". See
// https://meta.wikimedia.org/wiki/User-Agent_policy
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  candidatesQuery,
  classQuery,
  detailsQuery,
  filterEvents,
  groupDetails,
  itemToEvent,
  parseCandidateRows,
  parseClassRows,
  parseExcludeList,
  relationsQuery,
  relationsToLinks,
} from './lib/wikidata.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = process.env.WIKIDATA_USER_AGENT || 'timeline-wikidata-importer/0.1 (set WIKIDATA_USER_AGENT to add contact details)';

// ---- Command-line options ---------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (flag('help')) {
  console.log('Usage: node scripts/import-wikidata-ww2.mjs [--limit N] [--out DIR] [--dry-run] [--force]');
  process.exit(0);
}
const LIMIT = Number(option('limit', 250));
const OUT = path.resolve(ROOT, option('out', 'data/events/ww2'));
const DRY = flag('dry-run');
const FORCE = flag('force');
const EXCLUDE_FILE = path.join(ROOT, 'data/import/wikidata-ww2.exclude.txt');
const EXCLUDED = fs.existsSync(EXCLUDE_FILE) ? parseExcludeList(fs.readFileSync(EXCLUDE_FILE, 'utf8')) : new Set();

// ---- Talking to Wikidata ------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a SPARQL query, retrying politely if Wikidata says "slow down" or has a hiccup. */
async function sparql(query, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({ query }),
    });
    if (res.ok) return (await res.json()).results.bindings;
    const retryAfter = Number(res.headers.get('retry-after')) || 5 * attempt;
    const body = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      console.warn(`  ${label}: HTTP ${res.status}, retrying in ${retryAfter}s…`);
      await sleep(retryAfter * 1000);
      continue;
    }
    throw new Error(`${label} failed: HTTP ${res.status} ${body}`);
  }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---- Main ---------------------------------------------------------------------------
async function main() {
  const retrievedAt = new Date().toISOString().slice(0, 10);
  console.log(`Importing up to ${LIMIT} WW2 events from Wikidata → ${path.relative(ROOT, OUT)}${DRY ? ' (dry run)' : ''}`);

  // 1. Candidates. Ask for extra, because some will turn out not to be events.
  const candidates = parseCandidateRows(await sparql(candidatesQuery(Math.ceil(LIMIT * 1.5)), 'candidates'));
  console.log(`  ${candidates.length} candidates`);

  // 2. Keep only events.
  const classes = [...new Set(candidates.flatMap((c) => c.classes))];
  const classRows = [];
  for (const batch of chunk(classes, 200)) {
    classRows.push(...(await sparql(classQuery(batch), 'classes')));
    await sleep(1000);
  }
  const isEvent = filterEvents(candidates, parseClassRows(classRows));
  const events = isEvent.filter((c) => !EXCLUDED.has(c.qid)).slice(0, LIMIT);
  console.log(`  ${isEvent.length} are events (dropped ${candidates.length - isEvent.length} people, units, objects…); ${isEvent.length - isEvent.filter((c) => !EXCLUDED.has(c.qid)).length} on the exclude list`);

  // 3. Details, in batches.
  const out = [];
  const sitelinksOf = new Map(events.map((e) => [e.qid, e.sitelinks])); // feeds the importance score
  for (const batch of chunk(events.map((e) => e.qid), 80)) {
    const grouped = groupDetails(await sparql(detailsQuery(batch), 'details'));
    for (const qid of batch) {
      const ev = grouped.has(qid) ? itemToEvent(grouped.get(qid), { retrievedAt, sitelinks: sitelinksOf.get(qid) }) : null;
      if (ev) out.push(ev);
    }
    process.stdout.write(`  fetched ${out.length}/${events.length}\r`);
    await sleep(1000);
  }
  console.log();

  // 4. Relations between the events we're importing become links (stored in the "from" event's file).
  const importedQids = new Set(out.map((e) => e.provenance.qid));
  const relRows = [];
  for (const batch of chunk([...importedQids], 100)) {
    relRows.push(...(await sparql(relationsQuery(batch), 'relations')));
    await sleep(1000);
  }
  const linksFrom = relationsToLinks(relRows, importedQids);
  for (let i = 0; i < out.length; i++) {
    const links = linksFrom.get(out[i].provenance.qid);
    if (!links) continue;
    const { provenance, ...rest } = out[i];
    out[i] = { ...rest, links, provenance }; // keep "provenance" last in the file
  }
  console.log(`  ${[...linksFrom.values()].flat().length} links between imported events`);

  // 5. Write files, never clobbering hand edits.
  if (!DRY) fs.mkdirSync(OUT, { recursive: true });
  const stats = { created: 0, updated: 0, unchanged: 0, skippedManual: 0 };
  for (const ev of out) {
    const file = path.join(OUT, `${ev.provenance.qid}.json`);
    const exists = fs.existsSync(file);
    if (exists) {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (old.provenance?.manualEdits && !FORCE) {
        stats.skippedManual++;
        continue;
      }
      // Keep debates people have attached, and don't churn the file just because the date we ran changed.
      ev.topicIds = old.topicIds ?? ev.topicIds;
      const same = JSON.stringify({ ...old, provenance: { ...old.provenance, retrievedAt: '' } }) === JSON.stringify({ ...ev, provenance: { ...ev.provenance, retrievedAt: '' } });
      if (same) {
        stats.unchanged++;
        continue;
      }
    }
    stats[exists ? 'updated' : 'created']++;
    if (!DRY) fs.writeFileSync(file, JSON.stringify(ev, null, 2) + '\n');
  }
  console.log(`Done: ${stats.created} new, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.skippedManual} skipped (edited by hand).`);
  if (!DRY) console.log('Next: npm run validate:data, then open a pull request with the changes.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
