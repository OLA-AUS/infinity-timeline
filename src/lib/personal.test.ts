// Tests for personal spaces: versioned edits, turning a space into river data (lanes, links to
// world events, date disputes, stories), votes, and export / import.
import { describe, expect, it } from 'vitest';
import { seed } from '../data/seed';
import { inYear } from './dates';
import { resolveEventDate } from './dateDispute';
import { buildGraph, linkStrength, topicRiver } from './related';
import { importanceMap } from './importance';
import {
  archive,
  createSpace,
  exportSpace,
  importSpace,
  parsePid,
  pid,
  spaceErrors,
  spaceToDataset,
  upsert,
  votePersonal,
  withSpaces,
  type PersonalSpace,
} from './personal';

const NOW = '2026-11-28T00:00:00.000Z';
const votes = () => ({ up: 0, down: 0 });

/** A small family space: Grandad, Nan, Uncle Ray and Mum, three events and a disputed date. */
function family(): PersonalSpace {
  let s = createSpace('Family', 'family', NOW, [], 'fam');
  s = upsert(s, 'person', { id: 'grandad', name: 'Grandad', born: inYear(1920) }, NOW);
  s = upsert(s, 'person', { id: 'nan', name: 'Nan' }, NOW);
  s = upsert(s, 'person', { id: 'ray', name: 'Uncle Ray', living: true }, NOW);
  s = upsert(s, 'person', { id: 'mum', name: 'Mum', living: true }, NOW);
  s = upsert(s, 'source', { id: 'cert', title: 'Enlistment record', type: 'primary_document', year: 1940 }, NOW);
  s = upsert(s, 'source', { id: 'letter', title: 'Letter home', type: 'primary_document' }, NOW);
  s = upsert(s, 'event', { id: 'enlist', title: 'Grandad enlists', date: inYear(1940), summary: '', peopleIds: ['grandad'], sourceIds: ['cert'] }, NOW);
  s = upsert(s, 'event', { id: 'wedding', title: 'Grandad marries Nan', date: inYear(1946), summary: '', peopleIds: ['grandad', 'nan'], sourceIds: [] }, NOW);
  s = upsert(s, 'event', { id: 'move', title: 'Family moves to the coast', date: inYear(1963), summary: '', peopleIds: ['grandad'], sourceIds: [] }, NOW);
  s = upsert(s, 'link', { id: 'l1', from: 'enlist', to: 'ev_ww2', toWorld: true, type: 'part_of', sourceIds: [], wellSourced: votes(), agree: votes() }, NOW);
  s = upsert(s, 'story', { id: 'st1', eventId: 'enlist', text: 'He lied about his age to get in.', toldBy: 'Nan', toldById: 'nan', recordedAt: NOW }, NOW);
  // "Uncle Ray says 1962, Mum says 1964" — two proposals for the move.
  s = upsert(s, 'proposal', { id: 'ray-says', eventId: 'move', claimantId: 'ray', date: inYear(1962), evidence: [], agree: votes() }, NOW);
  s = upsert(s, 'proposal', {
    id: 'mum-says', eventId: 'move', claimantId: 'mum', date: inYear(1964), agree: votes(),
    evidence: [{ id: 'ev1', sourceId: 'letter', direction: 'for', note: 'Dated letter from the new house', wellSourced: votes() }],
  }, NOW);
  return s;
}

describe('editing a space', () => {
  it('keeps every earlier version in the log — nothing is lost', () => {
    let s = family();
    const before = s.events.find((e) => e.id === 'enlist')!;
    s = upsert(s, 'event', { ...before, title: 'Grandad joins up' }, NOW);
    const last = s.log[s.log.length - 1];
    expect(last.summary).toContain('Edited');
    expect(last.before).toEqual(before);
    s = archive(s, 'event', 'enlist', NOW);
    expect(s.events.find((e) => e.id === 'enlist')).toMatchObject({ archived: true, title: 'Grandad joins up' }); // still there
    expect(spaceToDataset(s, 0).events.map((e) => e.id)).not.toContain(pid('fam', 'enlist')); // but off the river
  });

  it('gives each new space a colour not already in use', () => {
    const a = createSpace('Family', 'family', NOW);
    const b = createSpace('Cousins', 'family', NOW, [a.color]);
    expect(b.color).not.toBe(a.color);
  });
});

describe('a space on the river', () => {
  it('prefixes ids with the space, tags events with their lane, and maps people and sources', () => {
    const d = spaceToDataset(family(), 2);
    const enlist = d.events.find((e) => e.id === pid('fam', 'enlist'))!;
    expect(enlist.space).toMatchObject({ id: 'fam', name: 'Family', lane: 2 });
    expect(enlist.peopleIds).toEqual([pid('fam', 'grandad')]);
    expect(enlist.date.sources).toEqual([pid('fam', 'cert')]);
    expect(parsePid(enlist.id)).toEqual({ spaceId: 'fam', localId: 'enlist' });
    expect(d.entities.find((e) => e.name === 'Nan')!.space!.undated).toBe(true); // no birth date: not drawn
    expect(d.sources.find((s) => s.title === 'Letter home')!.publishedAt).toBeNaN();
    expect(d.stories[0]).toMatchObject({ eventId: enlist.id, toldBy: 'Nan', toldById: pid('fam', 'nan') });
  });

  it('hidden spaces are left out entirely; visible ones get lanes in order', () => {
    const a = family();
    const b = { ...createSpace('Work', 'work', NOW, [], 'job'), hidden: false };
    expect(withSpaces(seed, [{ ...a, hidden: true }])).toBe(seed);
    const merged = withSpaces(seed, [{ ...a, hidden: true }, b]);
    expect(merged.events.some((e) => e.space?.id === 'fam')).toBe(false);
    const both = withSpaces(seed, [a, b]);
    expect(both.events.find((e) => e.space?.id === 'fam')!.space!.lane).toBe(0);
    expect(both.events.length).toBe(seed.events.length + 3);
  });

  it('a personal event linked to a world event shows up in that world event’s topic river', () => {
    const data = withSpaces(seed, [family()]);
    const graph = buildGraph(data);
    const ww2 = topicRiver('ev_ww2', data, graph, 0.4);
    expect(ww2.stops.map((s) => s.eventId)).toContain(pid('fam', 'enlist'));
    // …and only on this device: without the space, it isn't there.
    expect(topicRiver('ev_ww2', seed, buildGraph(seed), 0.4).stops.some((s) => s.eventId.startsWith('p:'))).toBe(false);
    const link = data.links.find((l) => l.origin === 'personal')!;
    expect(linkStrength(link).factors[0].label).toContain('only on this device');
  });

  it('events sharing a person form a topic river of that person’s life', () => {
    const data = withSpaces(seed, [family()]);
    const life = topicRiver(pid('fam', 'wedding'), data, buildGraph(data), 0.4);
    const ids = life.stops.map((s) => s.eventId);
    expect(ids).toEqual(expect.arrayContaining([pid('fam', 'enlist'), pid('fam', 'wedding'), pid('fam', 'move')]));
    expect(life.stops.map((s) => s.year)).toEqual([...life.stops.map((s) => s.year)].sort((a, b) => a - b)); // oldest first
  });

  it('the world’s own topic rivers are unchanged when no space is shown', () => {
    const before = topicRiver('ev_ww2', seed, buildGraph(seed), 0.4);
    const hidden = withSpaces(seed, [{ ...family(), hidden: true }]);
    expect(topicRiver('ev_ww2', hidden, buildGraph(hidden), 0.4)).toEqual(before);
  });

  it('personal events are always bubbles on the full river, with an explained reason', () => {
    const data = withSpaces(seed, [family()]);
    const imp = importanceMap(data).get(pid('fam', 'wedding'))!;
    expect(imp.score).toBeGreaterThanOrEqual(25);
    expect(imp.factors.map((f) => f.label).join()).toContain('personal space');
  });
});

describe('date disputes in a space work like public ones', () => {
  it('two unsupported proposals change nothing: the recorded date stands', () => {
    let s = family();
    s = upsert(s, 'proposal', { ...s.proposals.find((p) => p.id === 'mum-says')!, evidence: [] }, NOW);
    const data = withSpaces(seed, [s]);
    const r = resolveEventDate(data.events.find((e) => e.id === pid('fam', 'move'))!, data);
    expect(r.disputed).toBe(false);
    expect(r.contenders.map((c) => c.status)).toEqual(['Fringe', 'Fringe']);
    expect(r.date.best).toBe(1963.5);
  });

  it('evidence earns a proposal its status; "agree" never does', () => {
    let s = family();
    // Mum's proposal gets a second document, so it is well enough evidenced to be Established.
    s = upsert(s, 'source', { id: 'deeds', title: 'House deeds', type: 'primary_document', year: 1964 }, NOW);
    const mum = s.proposals.find((p) => p.id === 'mum-says')!;
    s = upsert(s, 'proposal', { ...mum, evidence: [...mum.evidence, { id: 'ev2', sourceId: 'deeds', direction: 'for', note: '', wellSourced: votes() }] }, NOW);
    // Lots of people "agree" with Uncle Ray — it must make no difference.
    for (let i = 0; i < 50; i++) s = votePersonal([s], pid('fam', 'ray-says'), 'agree', 1, 1, NOW)!;
    const data = withSpaces(seed, [s]);
    const r = resolveEventDate(data.events.find((e) => e.id === pid('fam', 'move'))!, data);
    expect(r.contenders.find((c) => c.claim.id === pid('fam', 'mum-says'))!.status).toBe('Established');
    expect(r.contenders.find((c) => c.claim.id === pid('fam', 'ray-says'))!.status).toBe('Fringe');
    expect(r.date.best).toBe(1964.5); // the river uses Mum's date
    expect(data.claims.find((c) => c.id === pid('fam', 'ray-says'))!.agree.up).toBe(50);
  });

  it('votes land in the right space and are logged; unknown ids are ignored', () => {
    const s = family();
    const v = votePersonal([s], pid('fam', 'l1'), 'well_sourced', 1, 10, NOW)!;
    expect(v.links[0].wellSourced.up).toBe(10);
    expect(v.log[v.log.length - 1].summary).toContain('well sourced');
    expect(votePersonal([s], 'ev_ww2', 'agree', 1, 1, NOW)).toBeNull();
    expect(votePersonal([s], pid('other', 'l1'), 'agree', 1, 1, NOW)).toBeNull();
  });
});

describe('export and import', () => {
  it('round-trips a space exactly, history included', () => {
    const s = family();
    const back = importSpace(exportSpace(s, NOW), [], NOW);
    expect({ ...back, log: back.log.slice(0, -1), updatedAt: s.updatedAt }).toEqual(s);
    expect(back.log[back.log.length - 1].summary).toBe('Imported from a file');
  });

  it('imports a second copy under a new id, so the two never clash on the river', () => {
    const s = family();
    const copy = importSpace(exportSpace(s, NOW), [s], NOW);
    expect(copy.id).not.toBe(s.id);
    expect(copy.name).toBe('Family (copy)');
    const data = withSpaces(seed, [s, copy]);
    expect(new Set(data.events.map((e) => e.id)).size).toBe(data.events.length);
  });

  it('refuses broken or foreign files with a plain-English reason', () => {
    expect(() => importSpace('not json', [], NOW)).toThrow('valid JSON');
    expect(() => importSpace('{"hello":1}', [], NOW)).toThrow('personal space file');
    const bad = JSON.parse(exportSpace(family(), NOW));
    bad.space.events[0].date.best = 3000;
    expect(() => importSpace(JSON.stringify(bad), [], NOW)).toThrow('earliest ≤ best ≤ latest');
    bad.space.events[0].date.best = 1940.5;
    bad.space.events[1].id = bad.space.events[0].id;
    expect(spaceErrors(bad.space).join()).toContain('used twice');
  });
});
