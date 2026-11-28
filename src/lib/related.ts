// Which events are related to which — the raw material for topic rivers.
//
// Two kinds of connection:
//   1. Typed links (Dataset.links): "WW2 begins —led to→ Battle of Britain". Each link has a
//      strength from 0 to 1 that comes from who drew it, how many sources back it, and its
//      "well sourced" votes. "Agree" votes never change strength (same rule as claims).
//   2. Shared entities: two events whose debates involve the same people or organisations
//      (claimants, authors, institutions, funders). A loose connection, worth less.
//   3. Shared people (personal spaces): two events that list the same person in `peopleIds`
//      ("Grandad enlists", "Grandad marries Nan"). A strong connection, so one person's
//      events form a topic river of their life. World events don't have peopleIds, so this
//      never changes their rivers.
//
// From an "anchor" event we walk outwards. A path's score is the product of its steps'
// strengths, minus a little for every extra hop. The relevance slider (0 = direct, 1 = loose)
// decides how weak a connection, and how many hops, still count.
//
// A topic river is the anchor plus everything related enough, in date order. An event on
// the river that has related events of its own *not* on this river is a branch point:
// another topic river crosses here, and you can switch onto it.
import type { Dataset, EventLink, LinkType } from '../types';
import type { Factor } from './trust';
import { wellSourcedFactor } from './status';
import { resolveEventDate } from './dateDispute';

/** How each link type reads from the point of view of either end. */
export const LINK_WORDS: Record<LinkType, { out: string; in: string }> = {
  caused: { out: 'caused', in: 'was caused by' },
  led_to: { out: 'led to', in: 'followed from' },
  part_of: { out: 'is part of', in: 'includes' },
  response_to: { out: 'was a response to', in: 'prompted' },
};

/** Starting strength by who drew the link, before sources and votes. */
export const LINK_BASE: Record<EventLink['origin'], number> = { curated: 0.75, wikidata: 0.7, community: 0.5, personal: 0.6 };
const DRAWN_BY: Record<EventLink['origin'], string> = {
  curated: 'Drawn by a curator',
  wikidata: 'Drawn by Wikidata',
  community: 'Drawn by an editor',
  personal: 'Drawn by you (personal space, only on this device)',
};
/** Each source adds a little, up to a cap. */
const SOURCE_BONUS = 0.05;
const SOURCE_BONUS_MAX = 0.15;
/** Strength of a "shared entity" connection: per shared entity, capped. */
const SHARED_ENTITY_EACH = 0.15;
const SHARED_ENTITY_MAX = 0.35;
/** Strength of a "same person" connection between personal events: one person, plus a bit per extra person. */
const SHARED_PERSON_FIRST = 0.6;
const SHARED_PERSON_EACH = 0.1;
const SHARED_PERSON_MAX = 0.8;
/** Each hop beyond the first multiplies the score by this, so far-off events fade. */
const HOP_DECAY = 0.75;

export interface LinkStrength {
  score: number; // 0..1
  factors: Factor[];
}

/** How strong a link is, with an Explain breakdown. */
export function linkStrength(link: EventLink): LinkStrength {
  const factors: Factor[] = [];
  const base = LINK_BASE[link.origin];
  factors.push({ label: DRAWN_BY[link.origin], delta: base });
  const bonus = Math.min(SOURCE_BONUS_MAX, link.sources.length * SOURCE_BONUS);
  if (bonus) factors.push({ label: `${link.sources.length} source${link.sources.length > 1 ? 's' : ''}`, delta: round(bonus) });
  const vf = wellSourcedFactor(link.wellSourced.up, link.wellSourced.down);
  const before = base + bonus;
  const score = clamp01(before * vf);
  if (vf !== 1) factors.push({ label: `"Well sourced" votes (×${vf.toFixed(2)})`, delta: round(score - before) });
  else if (before > 1) factors.push({ label: 'Capped at 1', delta: round(1 - before) });
  return { score: round(score), factors };
}

/** Everyone involved in an event's debates: claimants, plus authors, institutions and funders of the evidence. */
export function eventEntities(eventId: string, data: Dataset): Set<string> {
  const out = new Set<string>();
  const ev = data.events.find((e) => e.id === eventId);
  for (const tid of ev?.topicIds ?? []) {
    const topic = data.topics.find((t) => t.id === tid);
    for (const cid of topic?.claimIds ?? []) collectClaim(cid, data, out, new Set());
  }
  return out;
}

function collectClaim(claimId: string, data: Dataset, out: Set<string>, seen: Set<string>) {
  if (seen.has(claimId)) return;
  seen.add(claimId);
  const c = data.claims.find((x) => x.id === claimId);
  if (!c) return;
  out.add(c.claimantId);
  for (const ev of data.evidence.filter((e) => e.claimId === c.id)) {
    const s = data.sources.find((x) => x.id === ev.sourceId);
    if (!s) continue;
    s.authorIds.forEach((a) => out.add(a));
    if (s.institutionId) out.add(s.institutionId);
    s.funderIds.forEach((f) => out.add(f));
  }
  c.childClaimIds.forEach((child) => collectClaim(child, data, out, seen));
}

/** One step from an event to a neighbour, and how to describe it. */
export interface Edge {
  to: string;
  strength: number;
  reason: string; // e.g. "led to Battle of Britain", "shares 3 people/organisations"
  linkId?: string;
  type?: LinkType;
  direction?: 'out' | 'in';
}

/** Every event's neighbours (both link directions, plus shared entities). Build once per dataset. */
export function buildGraph(data: Dataset): Map<string, Edge[]> {
  const ids = new Set(data.events.map((e) => e.id));
  const title = (id: string) => data.events.find((e) => e.id === id)?.title ?? id;
  const graph = new Map<string, Edge[]>(data.events.map((e) => [e.id, []]));

  for (const l of data.links) {
    if (!ids.has(l.from) || !ids.has(l.to)) continue; // a link to something not loaded is ignored
    const strength = linkStrength(l).score;
    graph.get(l.from)!.push({ to: l.to, strength, reason: `${LINK_WORDS[l.type].out} ${title(l.to)}`, linkId: l.id, type: l.type, direction: 'out' });
    graph.get(l.to)!.push({ to: l.from, strength, reason: `${LINK_WORDS[l.type].in} ${title(l.from)}`, linkId: l.id, type: l.type, direction: 'in' });
  }

  // Shared entities — only events with debates have any, so this stays small.
  const withPeople = data.events.filter((e) => e.topicIds.length).map((e) => ({ id: e.id, people: eventEntities(e.id, data) }));
  for (let i = 0; i < withPeople.length; i++) {
    for (let j = i + 1; j < withPeople.length; j++) {
      const shared = [...withPeople[i].people].filter((p) => withPeople[j].people.has(p)).length;
      if (!shared) continue;
      const strength = Math.min(SHARED_ENTITY_MAX, shared * SHARED_ENTITY_EACH);
      const reason = `shares ${shared} ${shared === 1 ? 'person or organisation' : 'people/organisations'}`;
      graph.get(withPeople[i].id)!.push({ to: withPeople[j].id, strength, reason: `${reason} with ${title(withPeople[j].id)}` });
      graph.get(withPeople[j].id)!.push({ to: withPeople[i].id, strength, reason: `${reason} with ${title(withPeople[i].id)}` });
    }
  }
  // Shared people — only events with peopleIds (personal spaces). Grouped by person, so we
  // only compare events that have someone in common.
  const byPerson = new Map<string, string[]>();
  for (const e of data.events) for (const p of e.peopleIds ?? []) byPerson.set(p, [...(byPerson.get(p) ?? []), e.id]);
  const shared = new Map<string, { a: string; b: string; people: string[] }>(); // each pair → who they share
  for (const [person, evs] of byPerson) {
    for (let i = 0; i < evs.length; i++) {
      for (let j = i + 1; j < evs.length; j++) {
        const [a, b] = evs[i] < evs[j] ? [evs[i], evs[j]] : [evs[j], evs[i]];
        const key = `${a}|${b}`;
        const pair = shared.get(key) ?? { a, b, people: [] };
        pair.people.push(person);
        shared.set(key, pair);
      }
    }
  }
  const nameOf = (id: string) => data.entities.find((x) => x.id === id)?.name ?? 'someone';
  for (const { a, b, people } of shared.values()) {
    const n = people.length;
    const strength = Math.min(SHARED_PERSON_MAX, SHARED_PERSON_FIRST + (n - 1) * SHARED_PERSON_EACH);
    const who = n === 1 ? nameOf(people[0]) : `${n} people`;
    graph.get(a)!.push({ to: b, strength, reason: `shares ${who} with ${title(b)}` });
    graph.get(b)!.push({ to: a, strength, reason: `shares ${who} with ${title(a)}` });
  }
  return graph;
}

/** What the relevance slider means: the weakest score still shown, and how many hops to walk. */
export function relevanceRule(relevance: number) {
  const r = clamp01(relevance);
  return { minScore: round(0.6 - 0.5 * r), maxHops: r < 0.34 ? 1 : r < 0.67 ? 2 : 3 };
}

export interface RelatedEvent {
  eventId: string;
  score: number; // 0..1, 1 for the anchor itself
  hops: number;
  path: string[]; // plain-English steps from the anchor, e.g. ["led to Battle of Britain", "led to Bengal famine"]
}

/** Events related to `anchorId`, strongest connection first (the anchor itself included, score 1). */
export function relatedEvents(anchorId: string, graph: Map<string, Edge[]>, relevance: number): RelatedEvent[] {
  const { minScore, maxHops } = relevanceRule(relevance);
  const best = new Map<string, RelatedEvent>([[anchorId, { eventId: anchorId, score: 1, hops: 0, path: [] }]]);
  let frontier = [best.get(anchorId)!];
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: RelatedEvent[] = [];
    for (const cur of frontier) {
      for (const e of graph.get(cur.eventId) ?? []) {
        const score = round(cur.score * e.strength * (hop > 1 ? HOP_DECAY : 1));
        if (score < minScore) continue;
        const old = best.get(e.to);
        if (old && old.score >= score) continue;
        const r = { eventId: e.to, score, hops: hop, path: [...cur.path, e.reason] };
        best.set(e.to, r);
        next.push(r);
      }
    }
    frontier = next;
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.eventId.localeCompare(b.eventId));
}

export interface TopicRiver {
  anchorId: string;
  /** Events on the river, oldest first (the order you glide along them). */
  stops: (RelatedEvent & { year: number })[];
  /** Stops where another topic river crosses: how many events you'd gain by switching there. */
  branches: { eventId: string; newEvents: number }[];
}

/** The topic river for an anchor event at a given relevance. */
export function topicRiver(anchorId: string, data: Dataset, graph: Map<string, Edge[]>, relevance: number): TopicRiver {
  const related = relatedEvents(anchorId, graph, relevance);
  const year = (id: string) => {
    const ev = data.events.find((e) => e.id === id);
    return ev ? resolveEventDate(ev, data).date.best : 0;
  };
  const stops = related.map((r) => ({ ...r, year: year(r.eventId) })).sort((a, b) => a.year - b.year || a.eventId.localeCompare(b.eventId));
  const onRiver = new Set(stops.map((s) => s.eventId));
  const branches = stops
    .filter((s) => s.eventId !== anchorId)
    .map((s) => ({ eventId: s.eventId, newEvents: relatedEvents(s.eventId, graph, relevance).filter((r) => !onRiver.has(r.eventId)).length }))
    .filter((b) => b.newEvents > 0);
  return { anchorId, stops, branches };
}

/** Direct links touching an event, strongest first — shown as bubbles in the claim map. */
export function directLinks(eventId: string, graph: Map<string, Edge[]>): Edge[] {
  return (graph.get(eventId) ?? []).filter((e) => e.linkId).sort((a, b) => b.strength - a.strength);
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
