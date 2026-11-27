// Tests for importance, bubbles / stacks / fan-out on the main river, and search.
import { describe, expect, it } from 'vitest';
import { seed } from '../data/seed';
import { loadRepoData, mergeDatasets } from '../data/repoData';
import { fanPositions, fanRadius, planScreen, type ScreenItem } from './cluster';
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

  it('debated landmark events outrank plain imports, and every landmark gets a bubble on the normal river', () => {
    const ww2 = eventImportance(all.events.find((e) => e.id === 'ev_ww2')!, all).score;
    const imported = all.events.filter((e) => e.provenance).map((e) => eventImportance(e, all).score);
    expect(ww2).toBeGreaterThan(Math.max(...imported));
    for (const ev of seed.events) expect(eventImportance(ev, all).score).toBeGreaterThanOrEqual(LOD_THRESHOLD.normal);
  });

  it('only the best-covered imports get a bubble on the normal river', () => {
    const shown = all.events.filter((e) => e.provenance && eventImportance(e, all).score >= LOD_THRESHOLD.normal);
    expect(shown.length).toBeGreaterThan(5);
    expect(shown.length).toBeLessThan(40);
  });
});

describe('bubbles, stacks and fan-out', () => {
  const opts = { minRadius: 10, gap: 4 };

  it('every important event keeps its own bubble — nothing is merged', () => {
    const p = planScreen([item('a', 0, 1), item('b', 8, 9), item('c', 15, 4), item('far', 300, 2)], opts);
    expect(p.bubbles.map((b) => b.id).sort()).toEqual(['a', 'b', 'c', 'far']);
  });

  it('overlapping bubbles form a stack, most important first; lone ones are not in any stack', () => {
    const p = planScreen([item('a', 0, 1), item('b', 8, 9), item('c', 15, 4), item('far', 300, 2)], opts);
    expect(p.stacks).toEqual([['b', 'c', 'a']]);
  });

  it('chains of touching bubbles are one stack', () => {
    const p = planScreen([item('a', 0, 3), item('b', 22, 2), item('c', 44, 1)], opts); // a–b and b–c touch, a–c don't
    expect(p.stacks).toEqual([['a', 'b', 'c']]);
  });

  it('draws unimportant events as faint dots', () => {
    const p = planScreen([item('a', 0, 5), item('dim', 200, 1, { major: false })], opts);
    expect(p.faint).toEqual(['dim']);
    expect(p.bubbles.map((b) => b.id)).toEqual(['a']);
  });

  it('a pinned (searched-for) event always gets a bubble and its label', () => {
    const p = planScreen([item('big', 0, 50), item('found', 5, 1, { pinned: true, major: false })], opts);
    expect(p.bubbles).toContainEqual({ id: 'found', showLabel: true });
    expect(p.stacks).toEqual([['found', 'big']]);
  });

  it('hides labels that would overlap, keeping the more important one', () => {
    const p = planScreen([item('a', 0, 5), item('b', 40, 9)], opts); // bubbles clear, 80px labels clash
    expect(p.bubbles).toEqual([{ id: 'b', showLabel: true }, { id: 'a', showLabel: false }]);
  });

  it('a minimum radius means tiny bubbles closer than a fingertip count as overlapping', () => {
    const tiny = (id: string, x: number) => item(id, x, 1, { r: 2 });
    expect(planScreen([tiny('a', 0), tiny('b', 30)], { minRadius: 22, gap: 0 }).stacks).toHaveLength(1);
  });

  it('fans out round a ring, half each side, with rows far enough apart for 44px buttons', () => {
    for (const n of [2, 3, 5, 8, 12]) {
      const pos = fanPositions(n, fanRadius(n));
      expect(pos.filter((p) => p.side === 'right').length).toBe(Math.ceil(n / 2));
      expect(pos.every((p) => (p.side === 'right' ? p.x >= 0 : p.x <= 0))).toBe(true);
      for (const side of ['left', 'right'] as const) {
        const ys = pos.filter((p) => p.side === side).map((p) => p.y);
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('on a narrow screen, can put every bubble on one side', () => {
    const pos = fanPositions(7, fanRadius(7), 'right');
    expect(pos.every((p) => p.side === 'right' && p.x >= 0)).toBe(true);
    for (let i = 1; i < pos.length; i++) expect(pos[i].y - pos[i - 1].y).toBeGreaterThanOrEqual(44);
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
