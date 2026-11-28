// "What's hot" lists for the search panel, shown before you start typing.
//
// There's no server yet, so "trending" can't mean "what people looked at this week". Instead it
// means "where the most voting is happening" in the data we have, which is honest and works
// offline. When there's a backend, swap these for real recent-activity counts and keep the
// same shape so the search panel doesn't need to change.
//
//   • hotDebates     — events with debates, ranked by how many votes their claims have had
//   • contested      — claims whose earned status is Contested, ranked by votes
//   • disputedDates  — events whose date is currently disputed
import type { Dataset } from '../types';
import { claimStatus } from './status';
import { resolveEventDate } from './dateDispute';

export interface TrendingDebate {
  eventId: string;
  title: string;
  votes: number; // agree + well-sourced votes across the event's claims and their evidence
  debates: number; // how many topics hang off the event
}

export interface TrendingClaim {
  claimId: string;
  eventId: string;
  topicId: string;
  text: string;
  votes: number;
}

export interface TrendingDate {
  eventId: string;
  title: string;
}

export interface Trending {
  hotDebates: TrendingDebate[];
  contested: TrendingClaim[];
  disputedDates: TrendingDate[];
}

/** All the votes a claim has had: public opinion plus "well sourced" votes on its evidence. */
function claimVotes(data: Dataset, claimId: string): number {
  const c = data.claims.find((x) => x.id === claimId);
  if (!c) return 0;
  const evidenceVotes = data.evidence
    .filter((e) => e.claimId === claimId)
    .reduce((sum, e) => sum + e.wellSourced.up + e.wellSourced.down, 0);
  return c.agree.up + c.agree.down + evidenceVotes;
}

/** Build the three lists, each capped at `limit` items, busiest first. */
export function trending(data: Dataset, limit = 5): Trending {
  // Each topic belongs to one event; collect that event's claim votes.
  const hotDebates: TrendingDebate[] = data.events
    .filter((ev) => ev.topicIds.length > 0)
    .map((ev) => {
      const topics = data.topics.filter((t) => ev.topicIds.includes(t.id));
      const votes = topics.reduce((sum, t) => sum + t.claimIds.reduce((s, cid) => s + claimVotes(data, cid), 0), 0);
      return { eventId: ev.id, title: ev.title, votes, debates: topics.length };
    })
    .sort((a, b) => b.votes - a.votes || a.title.localeCompare(b.title))
    .slice(0, limit);

  const contested: TrendingClaim[] = data.claims
    .filter((c) => claimStatus(c, data).status === 'Contested')
    .map((c) => {
      const topic = data.topics.find((t) => t.id === c.topicId);
      return topic ? { claimId: c.id, eventId: topic.eventId, topicId: topic.id, text: c.text, votes: claimVotes(data, c.id) } : null;
    })
    .filter((x): x is TrendingClaim => x !== null)
    .sort((a, b) => b.votes - a.votes || a.text.localeCompare(b.text))
    .slice(0, limit);

  const disputedDates: TrendingDate[] = data.events
    .filter((ev) => resolveEventDate(ev, data).disputed)
    .map((ev) => ({ eventId: ev.id, title: ev.title }))
    .slice(0, limit);

  return { hotDebates, contested, disputedDates };
}
