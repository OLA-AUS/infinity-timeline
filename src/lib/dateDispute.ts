// Dates can be disputed exactly like claims.
//
// How it works:
// 1. Someone opens a topic with `dateOf: <eventId>` ("When did WW2 end?").
// 2. Each claim in that topic proposes a date (`proposedDate`) and gets evidence, like any claim.
// 3. Each claim earns a status from its evidence (src/lib/status.ts) — votes on "agree" never count.
// 4. This file turns those statuses into the date the river shows:
//    - one proposal is Established   → use its date; the dispute is settled
//    - some proposals are Contested  → keep the recorded date as the marker, but widen the
//                                      glowing span to cover every live proposal
//    - all are Fringe / Disproven    → the recorded date stands
// Every outcome comes with a plain-English `reason`, so the UI can explain it.
import type { Claim, ClaimStatus, Dataset, FuzzyDate, TimelineEvent } from '../types';
import { claimStatus } from './status';
import { formatDate } from './dates';

export interface DateContender {
  claim: Claim;
  date: FuzzyDate;
  status: ClaimStatus;
  support: number;
  oppose: number;
}

export interface ResolvedDate {
  /** The date to draw: position = best, glowing span = earliest..latest. */
  date: FuzzyDate;
  /** True while two or more dates are still live. The river draws the span differently. */
  disputed: boolean;
  /** Every proposed date, with the status it has earned. */
  contenders: DateContender[];
  /** The date-dispute topic, if there is one (so the UI can link to it). */
  topicId?: string;
  /** Plain-English explanation of how the shown date was chosen. */
  reason: string;
}

const SETTLED: ClaimStatus[] = ['Established', 'Later confirmed'];

export function resolveEventDate(event: TimelineEvent, data: Dataset): ResolvedDate {
  const topic = data.topics.find((t) => t.dateOf === event.id);
  const claims = (topic?.claimIds ?? [])
    .map((id) => data.claims.find((c) => c.id === id))
    .filter((c): c is Claim => !!c?.proposedDate);

  if (!topic || claims.length === 0) {
    return { date: event.date, disputed: false, contenders: [], topicId: topic?.id, reason: 'Nobody has disputed this date yet.' };
  }

  const contenders: DateContender[] = claims.map((c) => {
    const st = claimStatus(c, data);
    return { claim: c, date: c.proposedDate!, status: st.status, support: st.support, oppose: st.oppose };
  });

  // A proposal the evidence clearly backs wins outright. If several somehow do, the best-supported wins.
  const winners = contenders.filter((c) => SETTLED.includes(c.status)).sort((a, b) => b.support - a.support);
  if (winners.length) {
    const w = winners[0];
    return {
      date: w.date,
      disputed: false,
      contenders,
      topicId: topic.id,
      reason: `The proposal “${w.claim.text}” is ${w.status} by weighted evidence, so the river uses its date (${formatDate(w.date)}).`,
    };
  }

  // Several proposals are still live: show the whole range they cover.
  const live = contenders.filter((c) => c.status === 'Contested');
  if (live.length) {
    const all = [event.date, ...live.map((c) => c.date)];
    const earliest = Math.min(...all.map((d) => d.earliest));
    const latest = Math.max(...all.map((d) => d.latest));
    const sources = [...new Set(all.flatMap((d) => d.sources))];
    return {
      date: { ...event.date, earliest, latest, sources },
      disputed: true,
      contenders,
      topicId: topic.id,
      reason:
        `${live.length} proposed date${live.length > 1 ? 's are' : ' is'} Contested, so the glowing span covers all of them. ` +
        `The marker stays on the recorded date (${formatDate(event.date)}) until the evidence settles it.`,
    };
  }

  return {
    date: event.date,
    disputed: false,
    contenders,
    topicId: topic.id,
    reason: 'Other dates have been proposed, but none has enough evidence behind it (all Fringe or Disproven), so the recorded date stands.',
  };
}
