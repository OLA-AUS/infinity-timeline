// Checks for the JSON data files in data/. Used by scripts/validate-data.mjs (and CI on
// every pull request) so that a typo in a data edit is caught before it reaches the site.
// Each check returns plain-English messages; an empty list means the file is fine.
// The same rules are written as JSON Schema in data/schema/ for editor autocomplete.

export const FIELDS = ['politics', 'science', 'medicine', 'economics', 'technology', 'culture'];
export const PRECISIONS = ['day', 'month', 'year', 'decade', 'century', 'millennium'];
export const METHODS = ['documented', 'contemporary_accounts', 'archaeological', 'radiocarbon', 'scholarly_estimate', 'wikidata', 'community'];
export const ENTITY_KINDS = ['person', 'institution', 'company', 'government', 'funder', 'publication'];
export const LINK_TYPES = ['caused', 'led_to', 'part_of', 'response_to'];
export const SOURCE_TYPES = ['meta_analysis', 'rct', 'peer_reviewed', 'book', 'preprint', 'journalism', 'op_ed', 'social_post', 'primary_document', 'reference_work'];

const EVENT_KEYS = ['$schema', 'id', 'title', 'summary', 'field', 'date', 'end', 'topicIds', 'links', 'provenance'];
const LINK_KEYS = ['to', 'type', 'note', 'sources'];
const ENTITY_KEYS = ['$schema', 'id', 'name', 'kind', 'field', 'founded', 'description'];
const SOURCE_KEYS = ['$schema', 'id', 'title', 'type', 'publishedAt', 'authorIds', 'institutionId', 'funderIds', 'conflictOfInterest', 'retracted', 'url'];
const PROVENANCE_KEYS = ['importedFrom', 'qid', 'retrievedAt', 'wikipedia', 'sitelinks', 'manualEdits', 'conflictingValues'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const ID = /^[a-z][a-z0-9_]*$/i;

/** Warn about keys we don't recognise — usually a typo like "summery". */
function unknownKeys(obj, allowed, where) {
  return Object.keys(obj)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${where}: unknown field "${k}" (typo? allowed: ${allowed.filter((a) => a !== '$schema').join(', ')})`);
}

/** A FuzzyDate: { earliest, latest, best, precision, method, sources }. */
export function checkFuzzyDate(d, where) {
  if (!d || typeof d !== 'object') return [`${where} is missing or not an object`];
  const errs = [];
  for (const k of ['earliest', 'latest', 'best']) if (!isNum(d[k])) errs.push(`${where}.${k} must be a number (a decimal year, e.g. 1944.43)`);
  if (!errs.length && !(d.earliest <= d.best && d.best <= d.latest)) {
    errs.push(`${where}: must have earliest ≤ best ≤ latest (got ${d.earliest} / ${d.best} / ${d.latest})`);
  }
  if (!PRECISIONS.includes(d.precision)) errs.push(`${where}.precision must be one of ${PRECISIONS.join(', ')}`);
  if (!METHODS.includes(d.method)) errs.push(`${where}.method must be one of ${METHODS.join(', ')}`);
  if (!isStrArray(d.sources)) errs.push(`${where}.sources must be a list of source ids (can be empty: [])`);
  errs.push(...unknownKeys(d, ['earliest', 'latest', 'best', 'precision', 'method', 'sources'], where));
  return errs;
}

export function checkEvent(ev, fileBase) {
  const errs = [];
  if (!isStr(ev.id) || !ID.test(ev.id)) errs.push('id must be letters, digits and underscores, starting with a letter');
  if (!isStr(ev.title)) errs.push('title is required');
  if (typeof ev.summary !== 'string') errs.push('summary must be text (it can be empty: "")');
  if (!FIELDS.includes(ev.field)) errs.push(`field must be one of ${FIELDS.join(', ')}`);
  errs.push(...checkFuzzyDate(ev.date, 'date'));
  if (ev.end !== undefined) {
    errs.push(...checkFuzzyDate(ev.end, 'end'));
    if (isNum(ev.end?.best) && isNum(ev.date?.best) && ev.end.best < ev.date.best) errs.push('end.best is before date.best');
  }
  if (ev.topicIds !== undefined && !isStrArray(ev.topicIds)) errs.push('topicIds must be a list of ids');
  if (ev.links !== undefined) {
    if (!Array.isArray(ev.links)) errs.push('links must be a list');
    else
      ev.links.forEach((l, i) => {
        const where = `links[${i}]`;
        if (!l || typeof l !== 'object') return errs.push(`${where} must be an object like { "to": "other_event_id", "type": "led_to" }`);
        if (!isStr(l.to)) errs.push(`${where}.to must be the id of another event`);
        if (l.to === ev.id) errs.push(`${where} links the event to itself`);
        if (!LINK_TYPES.includes(l.type)) errs.push(`${where}.type must be one of ${LINK_TYPES.join(', ')}`);
        if (l.sources !== undefined && !isStrArray(l.sources)) errs.push(`${where}.sources must be a list of source ids`);
        if (l.note !== undefined && typeof l.note !== 'string') errs.push(`${where}.note must be text`);
        errs.push(...unknownKeys(l, LINK_KEYS, where));
      });
  }
  const p = ev.provenance;
  if (p !== undefined) {
    if (!['wikidata', 'manual'].includes(p.importedFrom)) errs.push('provenance.importedFrom must be "wikidata" or "manual"');
    if (p.importedFrom === 'wikidata' && !/^Q\d+$/.test(p.qid ?? '')) errs.push('provenance.qid must look like Q12345');
    if (p.manualEdits !== undefined && typeof p.manualEdits !== 'boolean') errs.push('provenance.manualEdits must be true or false');
    if (p.sitelinks !== undefined && !(Number.isInteger(p.sitelinks) && p.sitelinks >= 0)) errs.push('provenance.sitelinks must be a whole number');
    errs.push(...unknownKeys(p, PROVENANCE_KEYS, 'provenance'));
  }
  // The file name must match the id (or the Wikidata id for imports) so files are easy to find.
  const expected = [ev.id, p?.qid].filter(Boolean);
  if (fileBase && !expected.includes(fileBase)) errs.push(`file name should be ${expected.map((e) => e + '.json').join(' or ')}`);
  errs.push(...unknownKeys(ev, EVENT_KEYS, 'event'));
  return errs;
}

export function checkEntity(en, fileBase) {
  const errs = [];
  if (!isStr(en.id) || !ID.test(en.id)) errs.push('id must be letters, digits and underscores, starting with a letter');
  if (!isStr(en.name)) errs.push('name is required');
  if (!ENTITY_KINDS.includes(en.kind)) errs.push(`kind must be one of ${ENTITY_KINDS.join(', ')}`);
  if (!FIELDS.includes(en.field)) errs.push(`field must be one of ${FIELDS.join(', ')}`);
  if (typeof en.description !== 'string') errs.push('description must be text');
  errs.push(...checkFuzzyDate(en.founded, 'founded'));
  if (fileBase && fileBase !== en.id) errs.push(`file name should be ${en.id}.json`);
  errs.push(...unknownKeys(en, ENTITY_KEYS, 'entity'));
  return errs;
}

export function checkSource(s, fileBase) {
  const errs = [];
  if (!isStr(s.id) || !ID.test(s.id)) errs.push('id must be letters, digits and underscores, starting with a letter');
  if (!isStr(s.title)) errs.push('title is required');
  if (!SOURCE_TYPES.includes(s.type)) errs.push(`type must be one of ${SOURCE_TYPES.join(', ')}`);
  if (!isNum(s.publishedAt)) errs.push('publishedAt must be a year (number)');
  if (!isStrArray(s.authorIds)) errs.push('authorIds must be a list of entity ids (can be empty)');
  if (!isStrArray(s.funderIds)) errs.push('funderIds must be a list of entity ids (empty = funding unknown, which is flagged)');
  if (s.url !== undefined && !/^https?:\/\//.test(s.url)) errs.push('url must start with http:// or https://');
  if (fileBase && fileBase !== s.id) errs.push(`file name should be ${s.id}.json`);
  errs.push(...unknownKeys(s, SOURCE_KEYS, 'source'));
  return errs;
}

/**
 * Checks across all files: ids are unique, and every id a file points to exists.
 * Real data must only point at other real data in data/ — never at the demo seed.
 * `files` is a list of { path, kind: 'event'|'entity'|'source', data }.
 */
export function checkReferences(files) {
  const errs = [];
  const seen = new Map();
  for (const f of files) {
    const id = f.data?.id;
    if (!id) continue;
    if (seen.has(id)) errs.push({ path: f.path, message: `id "${id}" is also used by ${seen.get(id)}` });
    else seen.set(id, f.path);
  }
  const ids = (kind) => new Set(files.filter((f) => f.kind === kind).map((f) => f.data?.id));
  const entities = ids('entity');
  const events = ids('event');
  const sources = ids('source');
  const sourceOk = (id) => sources.has(id) || /^wikidata:Q\d+$/.test(id);

  for (const f of files) {
    const d = f.data ?? {};
    if (f.kind === 'event') {
      const links = Array.isArray(d.links) ? d.links : [];
      for (const id of [...(d.date?.sources ?? []), ...(d.end?.sources ?? []), ...links.flatMap((l) => l?.sources ?? [])]) {
        if (!sourceOk(id)) errs.push({ path: f.path, message: `source "${id}" not found — add data/sources/${id}.json, or use "wikidata:Q…"` });
      }
      for (const l of links) {
        if (l?.to && !events.has(l.to)) errs.push({ path: f.path, message: `links to event "${l.to}", which isn't in data/events/` });
      }
    }
    if (f.kind === 'entity') {
      for (const id of d.founded?.sources ?? []) if (!sourceOk(id)) errs.push({ path: f.path, message: `source "${id}" not found` });
    }
    if (f.kind === 'source') {
      for (const id of [...(d.authorIds ?? []), ...(d.funderIds ?? []), ...(d.institutionId ? [d.institutionId] : [])]) {
        if (!entities.has(id)) errs.push({ path: f.path, message: `entity "${id}" not found — add data/entities/${id}.json` });
      }
    }
  }
  return errs;
}
