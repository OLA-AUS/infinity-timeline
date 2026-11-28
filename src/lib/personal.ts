// Personal spaces (Family / Friends / Work / your own): private timelines that sit beside the
// main river. This file is the pure logic — what a space holds, how edits are recorded, how a
// space becomes ordinary events/people/sources for the river, and how files are checked on
// import. Storage (IndexedDB) is in personalStore.ts; GEDCOM import in gedcom.ts.
//
// Privacy rules (see docs/PERSONAL_SPACES.md):
//   • A space lives only in this browser. Nothing here talks to a server, and nothing in
//     data/ or the site build may reference a personal id (the data validator checks).
//   • Personal items reuse the public machinery — FuzzyDate, date disputes through claims and
//     evidence, typed links with "well sourced" / "agree" votes — so they behave the same.
//   • Nothing is deleted: edits keep the previous version in the space's log, and "remove"
//     archives an item. (Deleting a whole space wipes it from this device — that's yours to do.)
//
// Ids: inside a space, items have short local ids. On the river every id is prefixed with
// "p:<space id>:" (see `pid`), so two spaces — or a space and its imported copy — never clash.
import type { Claim, Dataset, Entity, EventLink, Evidence, FuzzyDate, LinkType, Source, SourceType, SpaceTag, Story, TimelineEvent, Topic } from '../types';
import { LINK_TYPES } from '../types';
import { formatDate } from './dates';

export type SpaceKind = 'family' | 'friends' | 'work' | 'custom';
export const SPACE_KINDS: SpaceKind[] = ['family', 'friends', 'work', 'custom'];
export const SPACE_KIND_LABEL: Record<SpaceKind, string> = { family: 'Family', friends: 'Friends', work: 'Work', custom: 'Custom' };

/** Lane colours. Chosen to stand apart from the six field colours of the main river. */
export const SPACE_COLORS: Record<SpaceKind, string> = { family: '#ffcf99', friends: '#8ef0e4', work: '#c9b8ff', custom: '#e8f59a' };
const EXTRA_COLORS = ['#ffb3c7', '#b8e1ff', '#d4f7b0', '#ffe3a3'];

/** Votes, as on public claims: "well sourced" moves strength/status, "agree" is opinion only. */
export interface Votes { up: number; down: number }

export interface PersonalPerson {
  id: string;
  name: string;
  born?: FuzzyDate;
  died?: FuzzyDate;
  /** Living people are always private, and need their consent before anything goes public. */
  living?: boolean;
  note?: string;
  gedcomId?: string; // the @I12@ it came from, so a re-import can find it
  archived?: boolean;
}

export interface PersonalEvent {
  id: string;
  title: string;
  date: FuzzyDate;
  end?: FuzzyDate;
  summary: string;
  peopleIds: string[]; // people in this space
  sourceIds: string[]; // sources in this space that back it up
  kind?: 'birth' | 'marriage' | 'death' | 'other';
  gedcomId?: string;
  archived?: boolean;
}

/** A certificate, letter, photo, family bible, newspaper cutting… Trust is worked out like any source. */
export interface PersonalSource {
  id: string;
  title: string;
  type: SourceType;
  year?: number;
  authorId?: string; // a person in this space who wrote or kept it
  note?: string;
  url?: string;
  gedcomId?: string;
  archived?: boolean;
}

/** Story mode: a memory typed in, with who told it and when. */
export interface PersonalStory {
  id: string;
  eventId: string;
  text: string;
  toldBy: string;
  toldById?: string;
  toldOn?: FuzzyDate;
  recordedAt: string;
  archived?: boolean;
}

/** "Grandad enlists —part of→ WW2 begins". `to` is a world event id when `toWorld`, else one in this space. */
export interface PersonalLink {
  id: string;
  from: string;
  to: string;
  toWorld: boolean;
  type: LinkType;
  note?: string;
  sourceIds: string[];
  wellSourced: Votes;
  agree: Votes;
  archived?: boolean;
}

/**
 * A date dispute, the public way: "Uncle Ray says 1962" is a claim by Uncle Ray proposing a
 * date, and only evidence (sources for / against) can earn it a status. Agreeing never does.
 */
export interface DateProposal {
  id: string;
  eventId: string;
  claimantId: string; // a person in this space
  date: FuzzyDate;
  note?: string;
  evidence: { id: string; sourceId: string; direction: 'for' | 'against'; note: string; wellSourced: Votes }[];
  agree: Votes;
  archived?: boolean;
}

export type ItemKind = 'person' | 'event' | 'source' | 'story' | 'link' | 'proposal';
export interface ItemOf {
  person: PersonalPerson;
  event: PersonalEvent;
  source: PersonalSource;
  story: PersonalStory;
  link: PersonalLink;
  proposal: DateProposal;
}
const LIST: { [K in ItemKind]: 'people' | 'events' | 'sources' | 'stories' | 'links' | 'proposals' } = {
  person: 'people',
  event: 'events',
  source: 'sources',
  story: 'stories',
  link: 'links',
  proposal: 'proposals',
};

/** One entry in a space's append-only history. `before` is the previous version, if any. */
export interface SpaceLogEntry {
  at: string;
  kind: ItemKind | 'space';
  itemId: string;
  summary: string;
  before?: unknown;
}

export interface PersonalSpace {
  id: string;
  name: string;
  kind: SpaceKind;
  color: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  people: PersonalPerson[];
  events: PersonalEvent[];
  sources: PersonalSource[];
  stories: PersonalStory[];
  links: PersonalLink[];
  proposals: DateProposal[];
  log: SpaceLogEntry[];
}

// ---- Ids ---------------------------------------------------------------------------------

/** A short random id for a new item. */
export function newId(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

/** Every personal id on the river starts with this. data/ files must never contain one. */
export const PERSONAL_PREFIX = 'p:';
/** The river-wide id of an item in a space. */
export const pid = (spaceId: string, localId: string) => `${PERSONAL_PREFIX}${spaceId}:${localId}`;
/** Split a river-wide personal id back into its space and local id (null if it isn't personal). */
export function parsePid(id: string): { spaceId: string; localId: string } | null {
  if (!id.startsWith(PERSONAL_PREFIX)) return null;
  const rest = id.slice(PERSONAL_PREFIX.length);
  const i = rest.indexOf(':');
  return i > 0 ? { spaceId: rest.slice(0, i), localId: rest.slice(i + 1) } : null;
}
export const isPersonal = (id: string) => id.startsWith(PERSONAL_PREFIX);

// ---- Making and editing spaces ------------------------------------------------------------

/** A new, empty space. `taken` = colours already used, so a second custom space gets another. */
export function createSpace(name: string, kind: SpaceKind, now: string, taken: string[] = [], id = newId('space')): PersonalSpace {
  const color = [SPACE_COLORS[kind], ...EXTRA_COLORS, ...Object.values(SPACE_COLORS)].find((c) => !taken.includes(c)) ?? SPACE_COLORS[kind];
  return {
    id,
    name: name.trim() || SPACE_KIND_LABEL[kind],
    kind,
    color,
    hidden: false,
    createdAt: now,
    updatedAt: now,
    people: [],
    events: [],
    sources: [],
    stories: [],
    links: [],
    proposals: [],
    log: [{ at: now, kind: 'space', itemId: id, summary: `Created the ${name.trim() || SPACE_KIND_LABEL[kind]} space` }],
  };
}

/** Add an item, or replace the one with the same id. The old version is kept in the log. */
export function upsert<K extends ItemKind>(space: PersonalSpace, kind: K, item: ItemOf[K], now: string, summary?: string): PersonalSpace {
  const key = LIST[kind];
  const list = space[key] as unknown as ItemOf[K][];
  const before = list.find((x) => x.id === item.id);
  const next = before ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
  const label = (item as { title?: string; name?: string }).title ?? (item as { name?: string }).name ?? kind;
  return {
    ...space,
    [key]: next,
    updatedAt: now,
    log: [...space.log, { at: now, kind, itemId: item.id, summary: summary ?? `${before ? 'Edited' : 'Added'} ${kind} “${label}”`, ...(before ? { before } : {}) }],
  };
}

/** Add many items at once (an import), with one log entry. */
export function addMany(space: PersonalSpace, items: Partial<{ [K in ItemKind]: ItemOf[K][] }>, now: string, summary: string): PersonalSpace {
  const next: PersonalSpace = { ...space, updatedAt: now, log: [...space.log, { at: now, kind: 'space', itemId: space.id, summary }] };
  for (const kind of Object.keys(items) as ItemKind[]) {
    const key = LIST[kind];
    (next[key] as unknown[]) = [...(space[key] as unknown[]), ...(items[kind] as unknown[])];
  }
  return next;
}

/** "Remove": the item is archived (hidden everywhere) but kept, with a log entry. */
export function archive(space: PersonalSpace, kind: ItemKind, id: string, now: string): PersonalSpace {
  const key = LIST[kind];
  const before = (space[key] as { id: string; archived?: boolean }[]).find((x) => x.id === id);
  if (!before || before.archived) return space;
  return upsert(space, kind, { ...before, archived: true } as ItemOf[typeof kind], now, `Removed ${kind} “${(before as { title?: string; name?: string }).title ?? (before as { name?: string }).name ?? id}” (kept in history)`);
}

/** Rename, recolour or show/hide a space. */
export function updateSpace(space: PersonalSpace, patch: Partial<Pick<PersonalSpace, 'name' | 'color' | 'hidden'>>, now: string): PersonalSpace {
  const what = patch.hidden !== undefined ? (patch.hidden ? 'Hid the lane' : 'Showed the lane') : 'Edited the space';
  const before = { name: space.name, color: space.color, hidden: space.hidden };
  return { ...space, ...patch, updatedAt: now, log: [...space.log, { at: now, kind: 'space', itemId: space.id, summary: what, before }] };
}

const live = <T extends { archived?: boolean }>(xs: T[]) => xs.filter((x) => !x.archived);

// ---- From a space to the river ------------------------------------------------------------

/**
 * Turn a space into ordinary dataset records, with river-wide ids and a lane. Everything
 * archived is left out. Links to world events that aren't loaded are simply ignored later.
 */
export function spaceToDataset(space: PersonalSpace, lane: number): Pick<Dataset, 'entities' | 'events' | 'sources' | 'topics' | 'claims' | 'evidence' | 'links'> & { stories: Story[] } {
  const P = (local: string) => pid(space.id, local);
  const tag: SpaceTag = { id: space.id, name: space.name, color: space.color, lane };
  const people = live(space.people);
  const personIds = new Set(people.map((p) => p.id));
  const sources = live(space.sources);
  const sourceIds = new Set(sources.map((s) => s.id));
  const events = live(space.events);
  const eventIds = new Set(events.map((e) => e.id));
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? 'Someone';

  const entities: Entity[] = people.map((p) => ({
    id: P(p.id),
    name: p.name,
    kind: 'person',
    field: 'culture',
    founded: p.born ?? { earliest: 0, latest: 0, best: 0, precision: 'year', method: 'community', sources: [] },
    description: p.note ?? `In your ${space.name} space${p.died ? ` · died ${formatDate(p.died)}` : ''}`,
    space: p.born ? tag : { ...tag, undated: true },
  }));

  const outSources: Source[] = sources.map((s) => ({
    id: P(s.id),
    title: s.title,
    type: s.type,
    publishedAt: s.year ?? Number.NaN, // NaN = undated; the source panel says so
    authorIds: s.authorId && personIds.has(s.authorId) ? [P(s.authorId)] : [],
    funderIds: [],
    url: s.url,
  }));

  // Date disputes: one topic per event with proposals, one claim per proposal.
  const proposals = live(space.proposals).filter((pr) => eventIds.has(pr.eventId));
  const disputed = new Set(proposals.map((pr) => pr.eventId));
  const topicId = (eventId: string) => P(`dispute-${eventId}`);
  const topics: Topic[] = [...disputed].map((eventId) => ({
    id: topicId(eventId),
    eventId: P(eventId),
    title: `When did “${events.find((e) => e.id === eventId)!.title}” happen?`,
    claimIds: proposals.filter((pr) => pr.eventId === eventId).map((pr) => P(pr.id)),
    dateOf: P(eventId),
  }));
  const claims: Claim[] = proposals.map((pr) => ({
    id: P(pr.id),
    topicId: topicId(pr.eventId),
    text: `${name(pr.claimantId)} says ${formatDate(pr.date)}${pr.note ? ` — ${pr.note}` : ''}`,
    claimantId: P(pr.claimantId),
    childClaimIds: [],
    evidenceIds: pr.evidence.filter((e) => sourceIds.has(e.sourceId)).map((e) => P(e.id)),
    agree: pr.agree,
    proposedDate: pr.date,
  }));
  const evidence: Evidence[] = proposals.flatMap((pr) =>
    pr.evidence.filter((e) => sourceIds.has(e.sourceId)).map((e) => ({
      id: P(e.id),
      claimId: P(pr.id),
      sourceId: P(e.sourceId),
      direction: e.direction,
      relevance: 1,
      note: e.note,
      wellSourced: e.wellSourced,
    })),
  );

  const outEvents: TimelineEvent[] = events.map((e) => ({
    id: P(e.id),
    title: e.title,
    date: { ...e.date, sources: [...new Set([...e.date.sources, ...e.sourceIds])].filter((s) => sourceIds.has(s)).map(P) },
    ...(e.end ? { end: e.end } : {}),
    field: 'culture', // unused for personal events: their lane and colour come from `space`
    summary: e.summary,
    topicIds: disputed.has(e.id) ? [topicId(e.id)] : [],
    peopleIds: e.peopleIds.filter((p) => personIds.has(p)).map(P),
    space: tag,
  }));

  const links: EventLink[] = live(space.links)
    .filter((l) => eventIds.has(l.from) && (l.toWorld || eventIds.has(l.to)))
    .map((l) => ({
      id: P(l.id),
      from: P(l.from),
      to: l.toWorld ? l.to : P(l.to),
      type: l.type,
      note: l.note,
      sources: l.sourceIds.filter((s) => sourceIds.has(s)).map(P),
      origin: 'personal',
      wellSourced: l.wellSourced,
      agree: l.agree,
    }));

  const stories: Story[] = live(space.stories)
    .filter((s) => eventIds.has(s.eventId))
    .map((s) => ({
      id: P(s.id),
      eventId: P(s.eventId),
      text: s.text,
      toldBy: s.toldBy,
      ...(s.toldById && personIds.has(s.toldById) ? { toldById: P(s.toldById) } : {}),
      ...(s.toldOn ? { toldOn: s.toldOn } : {}),
      recordedAt: s.recordedAt,
    }));

  return { entities, events: outEvents, sources: outSources, topics, claims, evidence, links, stories };
}

/**
 * The world dataset plus every visible space, each in its own lane (in the order given).
 * Hidden spaces are left out entirely, so they don't cluster, link or show up in search.
 */
export function withSpaces(world: Dataset, spaces: PersonalSpace[]): Dataset {
  const visible = spaces.filter((s) => !s.hidden);
  if (!visible.length) return world;
  const parts = visible.map((s, lane) => spaceToDataset(s, lane));
  return {
    ...world,
    entities: [...world.entities, ...parts.flatMap((p) => p.entities)],
    events: [...world.events, ...parts.flatMap((p) => p.events)],
    sources: [...world.sources, ...parts.flatMap((p) => p.sources)],
    topics: [...world.topics, ...parts.flatMap((p) => p.topics)],
    claims: [...world.claims, ...parts.flatMap((p) => p.claims)],
    evidence: [...world.evidence, ...parts.flatMap((p) => p.evidence)],
    links: [...world.links, ...parts.flatMap((p) => p.links)],
    stories: [...(world.stories ?? []), ...parts.flatMap((p) => p.stories)],
  };
}

// ---- Votes on personal items --------------------------------------------------------------

/**
 * Apply a vote to a personal claim (a date proposal), piece of evidence or link. Returns the
 * changed space, or null if the id isn't in any of `spaces`. Same two signals as everywhere:
 * "agree" only touches opinion counts; "well sourced" is what moves status and strength.
 */
export function votePersonal(spaces: PersonalSpace[], id: string, kind: 'agree' | 'well_sourced', value: 1 | -1, amount: number, now: string): PersonalSpace | null {
  const where = parsePid(id);
  const space = where && spaces.find((s) => s.id === where.spaceId);
  if (!where || !space) return null;
  const key = value === 1 ? 'up' : 'down';
  const bump = (v: Votes): Votes => ({ ...v, [key]: v[key] + amount });
  const log = (summary: string) => [...space.log, { at: now, kind: 'space' as const, itemId: where.localId, summary }];

  const link = space.links.find((l) => l.id === where.localId);
  if (link) {
    const next = kind === 'agree' ? { ...link, agree: bump(link.agree) } : { ...link, wellSourced: bump(link.wellSourced) };
    return { ...space, links: space.links.map((l) => (l.id === link.id ? next : l)), updatedAt: now, log: log(`Voted “${kind === 'agree' ? 'agree' : 'well sourced'}” ${value > 0 ? '+' : '−'} on a link`) };
  }
  const proposal = space.proposals.find((p) => p.id === where.localId);
  if (proposal && kind === 'agree') {
    return { ...space, proposals: space.proposals.map((p) => (p.id === proposal.id ? { ...p, agree: bump(p.agree) } : p)), updatedAt: now, log: log(`Voted agree ${value > 0 ? '+' : '−'} on a date proposal`) };
  }
  const owner = space.proposals.find((p) => p.evidence.some((e) => e.id === where.localId));
  if (owner && kind === 'well_sourced') {
    const next = { ...owner, evidence: owner.evidence.map((e) => (e.id === where.localId ? { ...e, wellSourced: bump(e.wellSourced) } : e)) };
    return { ...space, proposals: space.proposals.map((p) => (p.id === owner.id ? next : p)), updatedAt: now, log: log(`Voted “well sourced” ${value > 0 ? '+' : '−'} on evidence`) };
  }
  return null;
}

// ---- Export and import ------------------------------------------------------------------------

export const EXPORT_FORMAT = 'infinity-timeline/personal-space';
export const EXPORT_VERSION = 1;
/** Suggested file name ending — also in .gitignore, so an export saved in the repo is never committed. */
export const EXPORT_SUFFIX = '.infinity-space.json';

/** The file you download: the whole space, history included. */
export function exportSpace(space: PersonalSpace, now: string): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now, space }, null, 2);
}

export function exportFileName(space: PersonalSpace): string {
  return `${space.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'space'}${EXPORT_SUFFIX}`;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const PRECISIONS = ['day', 'month', 'year', 'decade', 'century', 'millennium'];
const SOURCE_TYPES: SourceType[] = ['meta_analysis', 'rct', 'peer_reviewed', 'book', 'preprint', 'journalism', 'op_ed', 'social_post', 'primary_document', 'reference_work'];

function dateErrors(d: unknown, where: string): string[] {
  if (!isObj(d)) return [`${where}: missing date`];
  if (![d.earliest, d.latest, d.best].every(isNum)) return [`${where}: date needs numbers for earliest, best and latest`];
  if (!((d.earliest as number) <= (d.best as number) && (d.best as number) <= (d.latest as number))) return [`${where}: date must have earliest ≤ best ≤ latest`];
  if (!PRECISIONS.includes(d.precision as string)) return [`${where}: unknown date precision`];
  if (!Array.isArray(d.sources)) return [`${where}: date sources must be a list`];
  return [];
}

/** Everything wrong with a space read from a file (empty = fine). Plain English, for the user. */
export function spaceErrors(s: unknown): string[] {
  if (!isObj(s)) return ['The file has no space in it.'];
  const errs: string[] = [];
  if (!isStr(s.id) || !s.id || s.id.includes(':')) errs.push('The space has no valid id.');
  if (!isStr(s.name)) errs.push('The space has no name.');
  if (!SPACE_KINDS.includes(s.kind as SpaceKind)) errs.push('The space kind must be family, friends, work or custom.');
  for (const key of ['people', 'events', 'sources', 'stories', 'links', 'proposals', 'log'] as const) {
    if (!Array.isArray(s[key])) errs.push(`“${key}” must be a list.`);
  }
  if (errs.length) return errs;
  const ids = new Set<string>();
  const checkId = (x: Record<string, unknown>, what: string) => {
    if (!isStr(x.id) || !x.id) errs.push(`A ${what} has no id.`);
    else if (ids.has(x.id)) errs.push(`The id “${x.id}” is used twice.`);
    else ids.add(x.id);
  };
  for (const p of s.people as unknown[]) {
    if (!isObj(p) || !isStr(p.name)) { errs.push('A person has no name.'); continue; }
    checkId(p, 'person');
    if (p.born !== undefined) errs.push(...dateErrors(p.born, `${p.name} (born)`));
    if (p.died !== undefined) errs.push(...dateErrors(p.died, `${p.name} (died)`));
  }
  for (const e of s.events as unknown[]) {
    if (!isObj(e) || !isStr(e.title)) { errs.push('An event has no title.'); continue; }
    checkId(e, 'event');
    errs.push(...dateErrors(e.date, e.title));
    if (!Array.isArray(e.peopleIds) || !Array.isArray(e.sourceIds)) errs.push(`${e.title}: peopleIds and sourceIds must be lists.`);
  }
  for (const x of s.sources as unknown[]) {
    if (!isObj(x) || !isStr(x.title)) { errs.push('A source has no title.'); continue; }
    checkId(x, 'source');
    if (!SOURCE_TYPES.includes(x.type as SourceType)) errs.push(`${x.title}: unknown source type.`);
  }
  for (const x of s.stories as unknown[]) {
    if (!isObj(x) || !isStr(x.text) || !isStr(x.eventId)) { errs.push('A story is missing its text or event.'); continue; }
    checkId(x, 'story');
  }
  for (const x of s.links as unknown[]) {
    if (!isObj(x) || !isStr(x.from) || !isStr(x.to) || !LINK_TYPES.includes(x.type as LinkType)) { errs.push('A link is missing its ends or type.'); continue; }
    checkId(x, 'link');
    if (isStr(x.to) && x.toWorld && isPersonal(x.to)) errs.push('A link to a world event points at a personal id.');
  }
  for (const x of s.proposals as unknown[]) {
    if (!isObj(x) || !isStr(x.eventId) || !isStr(x.claimantId) || !Array.isArray(x.evidence)) { errs.push('A date proposal is incomplete.'); continue; }
    checkId(x, 'date proposal');
    errs.push(...dateErrors(x.date, 'A date proposal'));
  }
  return errs;
}

/**
 * Read an exported file. If a space with the same id is already on this device, the import
 * becomes a copy with a new id (local ids stay as they are — river ids include the space id).
 * Throws an Error with a plain-English message when the file can't be used.
 */
export function importSpace(text: string, existing: PersonalSpace[], now: string): PersonalSpace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  if (!isObj(parsed) || parsed.format !== EXPORT_FORMAT) throw new Error('That isn’t an Infinity Timeline personal space file.');
  if (!isNum(parsed.version) || parsed.version > EXPORT_VERSION) throw new Error('That file was made by a newer version of the site.');
  const errs = spaceErrors(parsed.space);
  if (errs.length) throw new Error(`The file has problems: ${errs.slice(0, 3).join(' ')}${errs.length > 3 ? ` (and ${errs.length - 3} more)` : ''}`);
  const space = parsed.space as unknown as PersonalSpace;
  const clash = existing.some((s) => s.id === space.id);
  const id = clash ? newId('space') : space.id;
  return {
    ...space,
    id,
    name: clash ? `${space.name} (copy)` : space.name,
    hidden: !!space.hidden,
    color: isStr(space.color) ? space.color : SPACE_COLORS[space.kind],
    updatedAt: now,
    log: [...space.log, { at: now, kind: 'space', itemId: id, summary: clash ? 'Imported from a file as a copy' : 'Imported from a file' }],
  };
}
