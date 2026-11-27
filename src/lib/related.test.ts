// Tests for event links, relatedness and topic rivers.
import { describe, expect, it } from 'vitest';
import { seed } from '../data/seed';
import { loadRepoData, mergeDatasets } from '../data/repoData';
import { buildGraph, directLinks, eventEntities, linkStrength, relatedEvents, relevanceRule, topicRiver } from './related';
import type { Dataset } from '../types';

const all = mergeDatasets(seed, loadRepoData());
const graph = buildGraph(all);
const link = (id: string) => all.links.find((l) => l.id === id)!;

describe('the WW2 demo chain', () => {
  it('runs WW2 begins → Battle of Britain → Bengal famine → WW2 ends → Indian independence → Suez', () => {
    const chain = ['ev_ww2', 'wd_Q154720', 'ev_bengal', 'ev_ww2end', 'ev_india', 'ev_suez'];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(all.links.some((l) => l.from === chain[i] && l.to === chain[i + 1]), `${chain[i]} → ${chain[i + 1]}`).toBe(true);
    }
    expect(all.links.filter((l) => l.origin === 'curated').every((l) => l.demo)).toBe(true);
  });
});

describe('link strength', () => {
  it('explains itself and stays between 0 and 1', () => {
    for (const l of all.links) {
      const s = linkStrength(l);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.factors.reduce((a, f) => a + f.delta, 0)).toBeCloseTo(s.score, 2);
    }
  });

  it('"well sourced" votes move it, "agree" votes never do', () => {
    const l = link('l_bob_bengal');
    const base = linkStrength(l).score;
    expect(linkStrength({ ...l, agree: { up: 1e6, down: 0 } }).score).toBe(base);
    expect(linkStrength({ ...l, wellSourced: { up: 500, down: 0 } }).score).toBeGreaterThan(base);
    expect(linkStrength({ ...l, wellSourced: { up: 0, down: 500 } }).score).toBeLessThan(base);
  });

  it('the disputed demo link is weaker than the well-supported one', () => {
    expect(linkStrength(link('l_bob_bengal')).score).toBeLessThan(linkStrength(link('l_ww2_bob')).score);
  });
});

describe('relatedness', () => {
  it('"direct" only follows one step of links', () => {
    const ids = relatedEvents('ev_ww2', graph, 0).map((r) => r.eventId);
    expect(ids).toContain('ev_ww2');
    expect(ids).toContain('wd_Q154720');
    expect(ids).not.toContain('ev_ww2end'); // three steps away
    expect(relevanceRule(0).maxHops).toBe(1);
  });

  it('"loose" reaches further, and explains the path', () => {
    const loose = relatedEvents('ev_ww2', graph, 1);
    expect(loose.length).toBeGreaterThan(relatedEvents('ev_ww2', graph, 0).length);
    const bengal = loose.find((r) => r.eventId === 'ev_bengal')!;
    expect(bengal.hops).toBe(2);
    expect(bengal.path).toEqual(['led to Battle of Britain', 'led to Bengal famine']);
  });

  it('shared people/organisations connect debated events loosely', () => {
    expect(eventEntities('ev_ww2', all).has('e_histA')).toBe(true);
    const loose = relatedEvents('ev_moon', graph, 1).map((r) => r.eventId);
    const direct = relatedEvents('ev_moon', graph, 0).map((r) => r.eventId);
    expect(loose.some((id) => id !== 'ev_moon')).toBe(true); // Moon debate shares people with others
    expect(direct).toEqual(['ev_moon']); // but nothing is *linked* to it
  });

  it('lists an event\'s direct links, strongest first', () => {
    const d = directLinks('ev_india', graph);
    expect(d.map((e) => e.to).sort()).toEqual(['ev_suez', 'ev_ww2end']);
    expect(d[0].strength).toBeGreaterThanOrEqual(d[1].strength);
  });

  it('ignores links to events that are not loaded', () => {
    const broken: Dataset = { ...all, links: [...all.links, { ...link('l_ww2_bob'), id: 'x', to: 'nope' }] };
    expect(() => buildGraph(broken)).not.toThrow();
  });
});

describe('topic rivers', () => {
  it('holds the anchor plus related events, oldest first', () => {
    const r = topicRiver('ev_india', all, graph, 0.5);
    const ids = r.stops.map((s) => s.eventId);
    expect(ids).toContain('ev_india');
    expect(ids).toContain('ev_suez');
    const years = r.stops.map((s) => s.year);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
  });

  it('marks branch points where another topic river crosses', () => {
    // From WW2 begins, "direct" shows only its neighbours; the Battle of Britain leads on to
    // the Bengal famine, which isn't on this river — so it's a branch point.
    const r = topicRiver('ev_ww2', all, graph, 0);
    const bob = r.branches.find((b) => b.eventId === 'wd_Q154720');
    expect(bob?.newEvents).toBeGreaterThan(0);
    expect(r.branches.every((b) => b.eventId !== 'ev_ww2')).toBe(true); // the anchor isn't a branch
  });
});
