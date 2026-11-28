import { describe, expect, it } from 'vitest';
import { seed } from '../data/seed';
import { trending } from './trending';
import { claimStatus } from './status';
import { resolveEventDate } from './dateDispute';

describe('trending', () => {
  const t = trending(seed);

  it('lists only events that have debates, busiest first', () => {
    expect(t.hotDebates.length).toBeGreaterThan(0);
    for (const d of t.hotDebates) expect(seed.events.find((e) => e.id === d.eventId)!.topicIds.length).toBeGreaterThan(0);
    for (let i = 1; i < t.hotDebates.length; i++) expect(t.hotDebates[i - 1].votes).toBeGreaterThanOrEqual(t.hotDebates[i].votes);
  });

  it('only lists claims whose earned status is Contested, each tied to its event', () => {
    for (const c of t.contested) {
      const claim = seed.claims.find((x) => x.id === c.claimId)!;
      expect(claimStatus(claim, seed).status).toBe('Contested');
      expect(seed.topics.find((x) => x.id === c.topicId)!.eventId).toBe(c.eventId);
    }
  });

  it('only lists events whose date is disputed', () => {
    for (const d of t.disputedDates) expect(resolveEventDate(seed.events.find((e) => e.id === d.eventId)!, seed).disputed).toBe(true);
  });

  it('respects the limit', () => {
    const small = trending(seed, 1);
    expect(small.hotDebates.length).toBeLessThanOrEqual(1);
    expect(small.contested.length).toBeLessThanOrEqual(1);
    expect(small.disputedDates.length).toBeLessThanOrEqual(1);
  });

  it('more votes move a debate up the list', () => {
    const last = t.hotDebates[t.hotDebates.length - 1];
    const ev = seed.events.find((e) => e.id === last.eventId)!;
    const claimId = seed.topics.find((x) => x.id === ev.topicIds[0])!.claimIds[0];
    const boosted = { ...seed, claims: seed.claims.map((c) => (c.id === claimId ? { ...c, agree: { up: c.agree.up + 1e6, down: c.agree.down } } : c)) };
    expect(trending(boosted).hotDebates[0].eventId).toBe(last.eventId);
  });
});
