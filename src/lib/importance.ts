// How important an event is — used to decide what to show when the river is crowded.
//
// On the normal (unexpanded) river, only the more important events get a bubble; the rest
// are drawn as faint dots until you expand time around them. Like every score on this site,
// importance comes with its reasons ("factors"), so the UI can explain it.
//
//   importance = 10 × debates              (topics people are arguing about)
//              +  3 × links                (opinion charts that point at it)
//              +  2 × sources              (distinct sources backing its date)
//              +  4 × log2(1 + sitelinks)  (Wikipedia language editions, for Wikidata imports)
//              + 25 if hand-picked         (curated landmark events in the seed — always shown)
//
// It measures how much there is to explore here, not how much the event "mattered" to
// history. Changing these weights is a governance decision, like the trust weights.
import type { Dataset, TimelineEvent } from '../types';
import type { Factor } from './trust';
import type { ExpandLevel } from './timeScale';

export interface ImportanceResult {
  score: number;
  factors: Factor[];
}

export const IMPORTANCE_WEIGHTS = { debate: 10, link: 3, source: 2, sitelinks: 4, curated: 25 };

/**
 * The minimum importance for an event to get its own bubble at each level of expansion.
 * Below it, the event is a faint dot. Expanded to months or days, everything gets a bubble.
 * Tuned on the WW2 import: the normal river keeps the ~17 most-covered WW2 events.
 */
export const LOD_THRESHOLD: Record<ExpandLevel, number> = { normal: 25, months: 0, days: 0 };

export function eventImportance(ev: TimelineEvent, data: Dataset): ImportanceResult {
  const w = IMPORTANCE_WEIGHTS;
  const factors: Factor[] = [];
  const debates = ev.topicIds.length;
  if (debates) factors.push({ label: `${debates} debate${debates > 1 ? 's' : ''}`, delta: debates * w.debate });
  const links = data.opinions.filter((o) => o.linkedEventIds.includes(ev.id)).length;
  if (links) factors.push({ label: `Linked from ${links} opinion chart${links > 1 ? 's' : ''}`, delta: links * w.link });
  const sources = new Set([...ev.date.sources, ...(ev.end?.sources ?? [])]).size;
  if (sources) factors.push({ label: `${sources} source${sources > 1 ? 's' : ''} for its date`, delta: sources * w.source });
  const sitelinks = ev.provenance?.sitelinks;
  if (sitelinks) factors.push({ label: `In ${sitelinks} Wikipedia language editions`, delta: round(Math.log2(1 + sitelinks) * w.sitelinks) });
  if (!ev.provenance) factors.push({ label: 'Hand-picked landmark event', delta: w.curated });
  if (!factors.length) factors.push({ label: 'Nothing links here yet', delta: 0 });
  return { score: round(factors.reduce((a, f) => a + f.delta, 0)), factors };
}

/** Importance for every event at once (an id → result map), for the river. */
export function importanceMap(data: Dataset): Map<string, ImportanceResult> {
  return new Map(data.events.map((e) => [e.id, eventImportance(e, data)]));
}

const round = (n: number) => Math.round(n * 10) / 10;
