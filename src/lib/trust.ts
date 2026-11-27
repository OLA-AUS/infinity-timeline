// Trust scoring: how much weight to give a person, organisation or source.
// See docs/TRUST_MODEL.md for the reasoning behind every number here.
//
// The golden rule: every score returns its `factors` — a list of "this added +x,
// that took away −y" — so the UI can show an "Explain" breakdown. If you add a new
// influence on trust, add it as a factor too. No hidden weights.
import type { Dataset, Entity, PenaltyType, Source, SourceType, Year } from '../types';

/** One line of an "Explain" breakdown: what it is, and how many points it added or removed. */
export interface Factor {
  label: string;
  delta: number;
}

export interface TrustResult {
  score: number; // 0..100
  factors: Factor[];
}

/** Every tunable knob. Changing the defaults is a governance decision (docs/GOVERNANCE.md). */
export interface TrustOptions {
  now: Year; // "today", so old penalties can fade
  baseline: number; // where everyone starts (50/100)
  halfLifeYears: number; // a penalty counts half as much after this many years
  damping: number; // how much funders' trust bleeds into recipients
  maxDepth: number; // how many funding hops to follow
  unknownFundingPenalty: number; // points lost when we don't know who paid for a source
}

export const DEFAULT_TRUST: TrustOptions = {
  now: 2026.9,
  baseline: 50,
  halfLifeYears: 10,
  damping: 0.3,
  maxDepth: 3,
  unknownFundingPenalty: 3,
};

/** How seriously each kind of penalty counts. Fraud counts more than a warning. */
export const PENALTY_WEIGHT: Record<PenaltyType, number> = {
  criminal_fraud: 1.5,
  civil_settlement: 1.0,
  regulatory_fine: 0.8,
  warning: 0.3,
  retraction: 1.2,
};

/** How much each kind of source is worth on its own (1 = best). Multiplies source trust. */
export const SOURCE_TYPE_QUALITY: Record<SourceType, number> = {
  meta_analysis: 1.0,
  rct: 0.95,
  primary_document: 0.9,
  peer_reviewed: 0.85,
  book: 0.7,
  reference_work: 0.6, // encyclopedias / Wikidata: useful, but check the primary source
  journalism: 0.6,
  preprint: 0.55,
  op_ed: 0.35,
  social_post: 0.2,
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n * 10) / 10;

/** 1 for something that happened today, 0.5 after one half-life, 0.25 after two... */
export function recencyDecay(at: Year, opts: TrustOptions): number {
  const yearsAgo = Math.max(0, opts.now - at);
  return Math.pow(0.5, yearsAgo / opts.halfLifeYears);
}

/** Penalty severity = log10(amount+1) × type weight × recency decay. Multiplied ×2 into score points. */
export function penaltySeverity(amountUSD: number, type: PenaltyType, at: Year, opts: TrustOptions): number {
  const base = type === 'retraction' || type === 'warning' ? 3 : Math.log10(amountUSD + 1);
  return base * PENALTY_WEIGHT[type] * recencyDecay(at, opts) * 2;
}

/**
 * An entity's own trust, before funders are blended in:
 * baseline − penalties − undisclosed funding − retracted work, clamped to 0–100.
 */
export function ownTrust(entity: Entity, data: Dataset, opts: TrustOptions = DEFAULT_TRUST): TrustResult {
  const factors: Factor[] = [{ label: 'Baseline', delta: opts.baseline }];

  for (const p of data.penalties.filter((x) => x.entityId === entity.id)) {
    const sev = penaltySeverity(p.amountUSD, p.type, p.at, opts);
    const amt = p.amountUSD > 0 ? ` $${formatMoney(p.amountUSD)}` : '';
    factors.push({ label: `${labelPenalty(p.type)}${amt} (${Math.floor(p.at)}, ${p.regulator})`, delta: -round(sev) });
  }

  const undisclosed = data.funding.filter((f) => f.recipientId === entity.id && !f.disclosed);
  for (const f of undisclosed) {
    const funder = data.entities.find((e) => e.id === f.funderId);
    factors.push({ label: `Undisclosed funding from ${funder?.name ?? f.funderId}`, delta: -8 });
  }

  const retracted = data.sources.filter((s) => s.retracted && s.authorIds.includes(entity.id));
  for (const s of retracted) factors.push({ label: `Authored retracted work: "${s.title}"`, delta: -6 });

  const score = clamp(factors.reduce((a, f) => a + f.delta, 0));
  return { score: round(score), factors };
}

/**
 * Effective trust = (1 − d) × own + d × weighted average of funders' effective trust.
 * Depth-limited, cycle-safe.
 */
export function effectiveTrust(
  entityId: string,
  data: Dataset,
  opts: TrustOptions = DEFAULT_TRUST,
  depth = 0,
  visiting: Set<string> = new Set(),
): TrustResult {
  const entity = data.entities.find((e) => e.id === entityId);
  if (!entity) return { score: opts.baseline, factors: [{ label: 'Unknown entity', delta: opts.baseline }] };

  const own = ownTrust(entity, data, opts);
  // Funders we're not already visiting (that's the cycle protection: A funds B funds A).
  const edges = data.funding.filter((f) => f.recipientId === entityId && !visiting.has(f.funderId));
  if (depth >= opts.maxDepth || edges.length === 0) return own;

  visiting.add(entityId);
  // Average the funders' trust, weighted by how much of the money each one gave.
  const totalShare = edges.reduce((a, e) => a + (e.share ?? 1 / edges.length), 0) || 1;
  let funderAvg = 0;
  for (const e of edges) {
    const w = (e.share ?? 1 / edges.length) / totalShare;
    funderAvg += w * effectiveTrust(e.funderId, data, opts, depth + 1, visiting).score;
  }
  visiting.delete(entityId);

  const blended = (1 - opts.damping) * own.score + opts.damping * funderAvg;
  const delta = round(blended - own.score);
  return {
    score: round(clamp(blended)),
    factors: [...own.factors, { label: `Funders' trust blended in (${Math.round(opts.damping * 100)}%)`, delta }],
  };
}

/**
 * Source trust: a weighted average of the people behind it (authors 35%, institution 25%,
 * funders 40%), scaled by the source type's quality, then adjusted for unknown funding,
 * conflicts of interest and retraction.
 */
export function sourceTrust(source: Source, data: Dataset, opts: TrustOptions = DEFAULT_TRUST): TrustResult {
  const parts: { label: string; score: number; weight: number }[] = [];
  for (const a of source.authorIds) {
    const e = data.entities.find((x) => x.id === a);
    parts.push({ label: `Author: ${e?.name ?? a}`, score: effectiveTrust(a, data, opts).score, weight: 0.35 / source.authorIds.length });
  }
  if (source.institutionId) {
    const e = data.entities.find((x) => x.id === source.institutionId);
    parts.push({ label: `Institution: ${e?.name}`, score: effectiveTrust(source.institutionId, data, opts).score, weight: 0.25 });
  }
  if (source.funderIds.length) {
    for (const f of source.funderIds) {
      const e = data.entities.find((x) => x.id === f);
      parts.push({ label: `Funder: ${e?.name ?? f}`, score: effectiveTrust(f, data, opts).score, weight: 0.4 / source.funderIds.length });
    }
  }

  const totalW = parts.reduce((a, p) => a + p.weight, 0) || 1;
  const people = parts.reduce((a, p) => a + p.score * (p.weight / totalW), 0) || opts.baseline;
  const quality = SOURCE_TYPE_QUALITY[source.type];

  const factors: Factor[] = parts.map((p) => ({ label: `${p.label} (trust ${p.score})`, delta: round(p.score * (p.weight / totalW)) }));
  let score = people * (0.5 + 0.5 * quality);
  factors.push({ label: `Source type: ${source.type.replace('_', ' ')} (quality ×${(0.5 + 0.5 * quality).toFixed(2)})`, delta: round(score - people) });

  if (!source.funderIds.length) {
    score -= opts.unknownFundingPenalty;
    factors.push({ label: 'Funding unknown / undisclosed', delta: -opts.unknownFundingPenalty });
  }
  if (source.conflictOfInterest) {
    const before = score;
    score *= 0.7;
    factors.push({ label: `Conflict of interest: ${source.conflictOfInterest}`, delta: round(score - before) });
  }
  if (source.retracted) {
    const before = score;
    score = Math.min(score, 5);
    factors.push({ label: 'Retracted', delta: round(score - before) });
  }
  return { score: round(clamp(score)), factors };
}

/** 1_200_000_000 → "1.2B". */
export function formatMoney(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${n}`;
}

function labelPenalty(t: PenaltyType): string {
  return {
    criminal_fraud: 'Criminal fraud penalty',
    civil_settlement: 'Civil settlement',
    regulatory_fine: 'Regulatory fine',
    warning: 'Regulatory warning',
    retraction: 'Retraction',
  }[t];
}
