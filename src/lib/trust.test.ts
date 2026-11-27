import { describe, expect, it } from 'vitest';
import { seed } from '../data/seed';
import { DEFAULT_TRUST, effectiveTrust, ownTrust, penaltySeverity, recencyDecay, sourceTrust } from './trust';
import { claimStatus, wellSourcedFactor } from './status';
import type { Dataset } from '../types';

const get = (id: string) => seed.entities.find((e) => e.id === id)!;
const claim = (id: string) => seed.claims.find((c) => c.id === id)!;

describe('trust', () => {
  it('recency decay halves every half-life', () => {
    const o = { ...DEFAULT_TRUST, now: 2020 };
    expect(recencyDecay(2020, o)).toBe(1);
    expect(recencyDecay(2010, o)).toBeCloseTo(0.5);
  });

  it('bigger, more recent, more serious penalties hurt more', () => {
    const o = { ...DEFAULT_TRUST, now: 2026 };
    expect(penaltySeverity(3e9, 'civil_settlement', 2025, o)).toBeGreaterThan(penaltySeverity(5e4, 'civil_settlement', 2025, o));
    expect(penaltySeverity(1e9, 'civil_settlement', 2025, o)).toBeGreaterThan(penaltySeverity(1e9, 'civil_settlement', 2000, o));
    expect(penaltySeverity(1e9, 'criminal_fraud', 2025, o)).toBeGreaterThan(penaltySeverity(1e9, 'regulatory_fine', 2025, o));
  });

  it('a heavily fined company scores below baseline', () => {
    expect(ownTrust(get('e_pharma'), seed).score).toBeLessThan(DEFAULT_TRUST.baseline - 10);
  });

  it('undisclosed funding from a low-trust funder drags the recipient down', () => {
    const found = effectiveTrust('e_found', seed);
    expect(found.score).toBeLessThan(DEFAULT_TRUST.baseline);
    expect(found.factors.some((f) => f.label.startsWith('Undisclosed funding'))).toBe(true);
  });

  it('handles funding cycles without infinite recursion', () => {
    const cyclic: Dataset = { ...seed, funding: [...seed.funding, { funderId: 'e_uni', recipientId: 'e_gov', disclosed: true }] };
    expect(() => effectiveTrust('e_uni', cyclic)).not.toThrow();
  });

  it('conflict of interest lowers a source vs an independent one of the same type', () => {
    const industry = sourceTrust(seed.sources.find((s) => s.id === 's15')!, seed).score;
    const independent = sourceTrust(seed.sources.find((s) => s.id === 's17')!, seed).score;
    expect(independent).toBeGreaterThan(industry);
  });

  it('every score has an explain breakdown', () => {
    for (const s of seed.sources) expect(sourceTrust(s, seed).factors.length).toBeGreaterThan(0);
  });
});

describe('status', () => {
  it('well-sourced votes are bounded and small samples barely move weight', () => {
    expect(wellSourcedFactor(0, 0)).toBe(1);
    expect(wellSourcedFactor(1000, 0)).toBeCloseTo(1.5);
    expect(wellSourcedFactor(2, 0)).toBeLessThan(1.05);
  });

  it('agree votes never change status', () => {
    const c = claim('c_staged');
    const before = claimStatus(c, seed).status;
    const flipped = { ...c, agree: { up: 1e6, down: 0 } };
    expect(claimStatus(flipped, seed).status).toBe(before);
  });

  it('demo claims land where the evidence points', () => {
    expect(claimStatus(claim('c_empire'), seed).status).toBe('Established');
    expect(claimStatus(claim('c_staged'), seed).status).toBe('Disproven');
    expect(claimStatus(claim('c_lost'), seed).status).toBe('Disproven');
    expect(claimStatus(claim('c_hidden'), seed).status).toBe('Later confirmed');
    expect(claimStatus(claim('c_villain'), seed).status).toBe('Fringe');
  });
});
