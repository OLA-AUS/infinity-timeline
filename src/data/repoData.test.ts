// Tests that the data files in data/ load cleanly and fit with the demo seed.
import { describe, expect, it } from 'vitest';
import { seed } from './seed';
import { loadRepoData, mergeDatasets } from './repoData';
import { resolveEventDate } from '../lib/dateDispute';
import { sourceTrust } from '../lib/trust';

const repo = loadRepoData();
const all = mergeDatasets(seed, repo);

describe('repo data', () => {
  it('ids are unique across seed and data files', () => {
    for (const list of [all.events, all.entities, all.sources]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every event remembers which file it came from (for "suggest an edit" links)', () => {
    for (const ev of repo.events) expect(ev.provenance?.file).toMatch(/^data\/events\/.+\.json$/);
  });

  it('every source a date cites exists, and is trust-scored with an explanation', () => {
    for (const ev of repo.events) {
      for (const id of ev.date.sources) {
        const s = all.sources.find((x) => x.id === id);
        expect(s, `${ev.id} cites missing source ${id}`).toBeDefined();
        expect(sourceTrust(s!, all).factors.length).toBeGreaterThan(0);
      }
    }
  });

  it('real data never points at demo entities', () => {
    for (const s of repo.sources) {
      for (const id of [...s.authorIds, ...s.funderIds, s.institutionId].filter(Boolean)) {
        expect(seed.entities.some((e) => e.id === id), `${s.id} → demo entity ${id}`).toBe(false);
      }
    }
  });

  it('every event resolves to a date', () => {
    for (const ev of all.events) expect(Number.isFinite(resolveEventDate(ev, all).date.best)).toBe(true);
  });
});
