// Tests for importance, clustering and level of detail, and search.
import { describe, expect, it } from 'vitest';
import { seed } from '../data/seed';
import { loadRepoData, mergeDatasets } from '../data/repoData';
import { planScreen, type ScreenItem } from './cluster';
import { eventImportance, LOD_THRESHOLD } from './importance';
import { search } from './search';

const all = mergeDatasets(seed, loadRepoData());
const item = (id: string, x: number, importance: number, extra: Partial<ScreenItem> = {}): ScreenItem => ({
  id, x, y: 100, r: 10, importance, major: true, labelW: 80, labelH: 18, ...extra,
});

describe('importance', () => {
  it('explains itself, and the factors add up to the score', () => {
    for (const ev of all.events) {
      const r = eventImportance(ev, all);
      expect(r.factors.length).toBeGreaterThan(0);
      expect(r.factors.reduce((a, f) => a + f.delta, 0)).toBeCloseTo(r.score, 0);
    }
  });

  it('debated landmark events outrank plain imports, and every landmark shows at "all time"', () => {
    const ww2 = eventImportance(all.events.find((e) => e.id === 'ev_ww2')!, all).score;
    const imported = all.events.filter((e) => e.provenance).map((e) => eventImportance(e, all).score);
    expect(ww2).toBeGreaterThan(Math.max(...imported));
    for (const ev of seed.events) expect(eventImportance(ev, all).score).toBeGreaterThanOrEqual(LOD_THRESHOLD.all);
  });

  it('only the best-covered imports get a bubble at "all time"', () => {
    const shown = all.events.filter((e) => e.provenance && eventImportance(e, all).score >= LOD_THRESHOLD.all);
    expect(shown.length).toBeGreaterThan(5);
    expect(shown.length).toBeLessThan(40);
  });
});

describe('clustering', () => {
  const opts = { minRadius: 10, gap: 4 };

  it('keeps well-spaced bubbles apart', () => {
    const p = planScreen([item('a', 0, 5), item('b', 100, 3)], opts);
    expect(p.clusters).toEqual([]);
    expect(p.singles.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('merges overlapping bubbles into a cluster anchored on the most important one', () => {
    const p = planScreen([item('a', 0, 1), item('b', 8, 9), item('c', 15, 4), item('far', 300, 2)], opts);
    expect(p.clusters).toHaveLength(1);
    expect(p.clusters[0].anchorId).toBe('b');
    expect(p.clusters[0].memberIds.sort()).toEqual(['a', 'b', 'c']);
    expect(p.singles.map((s) => s.id)).toEqual(['far']);
  });

  it('draws unimportant events as faint dots', () => {
    const p = planScreen([item('a', 0, 5), item('dim', 200, 1, { major: false })], opts);
    expect(p.faint).toEqual(['dim']);
  });

  it('a pinned (searched-for) event always stands alone, with its label', () => {
    const p = planScreen([item('big', 0, 50), item('found', 5, 1, { pinned: true, major: false })], opts);
    expect(p.singles).toContainEqual({ id: 'found', showLabel: true });
    expect(p.clusters).toEqual([]);
    expect(p.faint).toEqual(['big']);
  });

  it('hides labels that would overlap, keeping the more important one', () => {
    const p = planScreen([item('a', 0, 5), item('b', 40, 9)], opts); // bubbles clear, 80px labels clash
    expect(p.singles).toEqual([{ id: 'b', showLabel: true }, { id: 'a', showLabel: false }]);
  });

  it('a minimum radius keeps tap targets from sitting on top of each other', () => {
    const tiny = (id: string, x: number) => item(id, x, 1, { r: 2 });
    expect(planScreen([tiny('a', 0), tiny('b', 30)], { minRadius: 22, gap: 0 }).clusters).toHaveLength(1);
  });
});

describe('search', () => {
  it('finds events, people and claims as you type, ignoring case and accents', () => {
    expect(search(all, 'overlord')[0]).toMatchObject({ kind: 'event', title: 'Operation Overlord' });
    expect(search(all, 'wikid').some((r) => r.kind === 'entity' && r.id === 'e_wikidata')).toBe(true);
    expect(search(all, 'MANCHURIA').some((r) => r.kind === 'claim' && r.id === 'c_start_1931')).toBe(true);
  });

  it('needs every word, in any order', () => {
    expect(search(all, 'moon landing')[0].id).toBe('ev_moon');
    expect(search(all, 'landing moon')[0].id).toBe('ev_moon');
    expect(search(all, 'moon zzzz')).toEqual([]);
  });

  it('filters by field', () => {
    const r = search(all, 'war', { fields: ['medicine'] });
    expect(r.every((x) => x.field === 'medicine')).toBe(true);
    expect(search(all, 'penicillin', { fields: ['politics'] })).toEqual([]);
  });

  it('claims point back at their event so the river can fly there', () => {
    const r = search(all, 'staged').find((x) => x.kind === 'claim')!;
    expect(r.eventId).toBe('ev_moon');
  });
});
