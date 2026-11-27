// Earned claim status. "Well sourced" votes move status; "agree" votes never do.
import type { Claim, ClaimStatus, Dataset, Evidence } from '../types';
import { DEFAULT_TRUST, sourceTrust, type TrustOptions } from './trust';

export interface StatusOptions {
  minTotalWeight: number;
  establishedRatio: number;
  disprovenRatio: number;
}

export const DEFAULT_STATUS: StatusOptions = {
  minTotalWeight: 0.8,
  establishedRatio: 0.8,
  disprovenRatio: 0.2,
};

export interface EvidenceWeight {
  evidence: Evidence;
  sourceTrust: number;
  voteFactor: number;
  weight: number;
}

/** Reputation-weighting would go here; for now votes nudge weight between ×0.5 and ×1.5, capped. */
export function wellSourcedFactor(up: number, down: number): number {
  const total = up + down;
  if (total === 0) return 1;
  const net = (up - down) / total; // -1..1
  const confidence = Math.min(1, total / 50); // small samples can't swing much
  return 1 + 0.5 * net * confidence;
}

export function evidenceWeight(ev: Evidence, data: Dataset, opts: TrustOptions = DEFAULT_TRUST): EvidenceWeight {
  const src = data.sources.find((s) => s.id === ev.sourceId);
  const st = src ? sourceTrust(src, data, opts).score : 0;
  const vf = wellSourcedFactor(ev.wellSourced.up, ev.wellSourced.down);
  return { evidence: ev, sourceTrust: st, voteFactor: vf, weight: (st / 100) * ev.relevance * vf };
}

export interface StatusResult {
  status: ClaimStatus;
  support: number;
  oppose: number;
  ratio: number;
  weights: EvidenceWeight[];
  reason: string;
}

export function claimStatus(
  claim: Claim,
  data: Dataset,
  opts: StatusOptions = DEFAULT_STATUS,
  trustOpts: TrustOptions = DEFAULT_TRUST,
): StatusResult {
  const weights = data.evidence.filter((e) => e.claimId === claim.id).map((e) => evidenceWeight(e, data, trustOpts));
  const support = weights.filter((w) => w.evidence.direction === 'for').reduce((a, w) => a + w.weight, 0);
  const oppose = weights.filter((w) => w.evidence.direction === 'against').reduce((a, w) => a + w.weight, 0);
  const total = support + oppose;
  const ratio = total === 0 ? 0.5 : support / total;

  let status: ClaimStatus;
  let reason: string;
  if (total < opts.minTotalWeight) {
    status = 'Fringe';
    reason = `Total evidence weight ${total.toFixed(2)} is below the ${opts.minTotalWeight} needed to rate it either way.`;
  } else if (ratio >= opts.establishedRatio) {
    status = 'Established';
    reason = `${Math.round(ratio * 100)}% of weighted evidence supports it (≥ ${opts.establishedRatio * 100}% needed).`;
  } else if (ratio <= opts.disprovenRatio) {
    status = 'Disproven';
    reason = `Only ${Math.round(ratio * 100)}% of weighted evidence supports it (≤ ${opts.disprovenRatio * 100}% = disproven).`;
  } else {
    status = 'Contested';
    reason = `${Math.round(ratio * 100)}% of weighted evidence supports it — between the thresholds.`;
  }

  // Later confirmed: was Fringe or Disproven at some earlier snapshot, Established now.
  if (status === 'Established' && claim.statusHistory?.some((h) => h.status === 'Fringe' || h.status === 'Disproven')) {
    status = 'Later confirmed';
    reason += ' It was previously rated Fringe/Disproven.';
  }
  return { status, support, oppose, ratio, weights, reason };
}

export const STATUS_COLOR: Record<ClaimStatus, string> = {
  Established: '#3ddc97',
  Contested: '#f5b83d',
  Fringe: '#9aa4b2',
  Disproven: '#ff5c6c',
  'Later confirmed': '#5cc8ff',
};
