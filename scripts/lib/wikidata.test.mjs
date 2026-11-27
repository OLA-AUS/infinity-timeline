// Tests for the Wikidata importer's conversion logic, using small hand-made answers
// shaped like the real SPARQL results (no network needed).
import { describe, expect, it } from 'vitest';
import { filterEvents, groupDetails, itemToEvent, mergeValues, parseExcludeList, valueToRange, ymdToYear } from './wikidata.mjs';
import { checkEvent, checkReferences } from './validate.mjs';

const lit = (value) => ({ type: 'literal', value });
const uri = (q) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${q}` });

describe('Wikidata dates', () => {
  it('a day-precision value is a one-day range with midday as best guess', () => {
    const r = valueToRange('1944-06-06T00:00:00Z', 11);
    expect(r.precision).toBe('day');
    expect(r.best).toBeCloseTo(ymdToYear(1944, 6, 6));
    expect(r.latest - r.earliest).toBeCloseTo(1 / 366, 4); // 1944 is a leap year
  });

  it('a month-precision value covers the whole month', () => {
    const r = valueToRange('1940-04-01T00:00:00Z', 10);
    expect(r.precision).toBe('month');
    expect(r.earliest).toBeCloseTo(ymdToYear(1940, 4, 1, 0));
    expect(r.latest).toBeCloseTo(ymdToYear(1940, 5, 1, 0));
  });

  it('earliest/latest qualifiers widen the range', () => {
    const r = valueToRange('1943-01-01T00:00:00Z', 9, '1942-11-01T00:00:00Z', '1943-03-31T00:00:00Z');
    expect(r.earliest).toBeLessThan(1943);
    expect(r.latest).toBeGreaterThan(1944 - 1e-9);
  });

  it('conflicting values become one wider range and are recorded', () => {
    const m = mergeValues([valueToRange('1941-12-08T00:00:00Z', 11), valueToRange('1941-12-07T00:00:00Z', 11)], 'Q184425');
    expect(m.conflicting).toEqual(['1941-12-07', '1941-12-08']);
    expect(m.date.best).toBeCloseTo(ymdToYear(1941, 12, 7)); // tie → earliest value
    expect(m.date.latest).toBeGreaterThan(ymdToYear(1941, 12, 8));
  });
});

describe('Wikidata rows → event file', () => {
  // "Battle of Britain"-style item: a coarse point in time plus precise start/end.
  const rows = [
    {
      item: uri('Q154720'),
      itemLabel: lit('Battle of Britain'),
      itemDescription: lit('air campaign over Britain'),
      enwiki: { type: 'uri', value: 'https://en.wikipedia.org/wiki/Battle_of_Britain' },
      pointTime: lit('1940-01-01T00:00:00Z'),
      pointPrec: lit('9'),
      startTime: lit('1940-07-10T00:00:00Z'),
      startPrec: lit('11'),
      endTime: lit('1940-10-31T00:00:00Z'),
      endPrec: lit('11'),
    },
  ];

  it('prefers the more precise start date and keeps the end date', () => {
    const ev = itemToEvent(groupDetails(rows).get('Q154720'), { retrievedAt: '2026-11-27' });
    expect(ev.id).toBe('wd_Q154720');
    expect(ev.date.precision).toBe('day');
    expect(ev.date.best).toBeCloseTo(ymdToYear(1940, 7, 10));
    expect(ev.end.best).toBeCloseTo(ymdToYear(1940, 10, 31));
    expect(ev.date.sources).toEqual(['wikidata:Q154720']);
    expect(ev.provenance).toMatchObject({ importedFrom: 'wikidata', qid: 'Q154720', manualEdits: false });
  });

  it('records how many Wikipedias cover it (for the importance score)', () => {
    const ev = itemToEvent(groupDetails(rows).get('Q154720'), { retrievedAt: '2026-11-27', sitelinks: 77 });
    expect(ev.provenance.sitelinks).toBe(77);
    expect(checkEvent(ev, 'Q154720')).toEqual([]);
    expect(checkEvent({ ...ev, provenance: { ...ev.provenance, sitelinks: -1 } }, 'Q154720')[0]).toContain('sitelinks');
  });

  it('produces files that pass the data validator', () => {
    const ev = itemToEvent(groupDetails(rows).get('Q154720'), { retrievedAt: '2026-11-27' });
    expect(checkEvent(ev, 'Q154720')).toEqual([]);
    expect(checkReferences([{ path: 'x', kind: 'event', data: ev }])).toEqual([]);
  });

  it('skips items with no English label', () => {
    const noLabel = [{ ...rows[0], itemLabel: lit('Q154720') }];
    expect(itemToEvent(groupDetails(noLabel).get('Q154720'), { retrievedAt: '2026-11-27' })).toBeNull();
  });
});

describe('filtering', () => {
  it('keeps occurrences, drops people and units', () => {
    const classInfo = { occurrence: new Set(['Q178561']), excluded: new Set(['Q176799', 'Q5']) };
    const kept = filterEvents(
      [
        { qid: 'Q1', classes: ['Q178561'] }, // battle
        { qid: 'Q2', classes: ['Q5'] }, // human
        { qid: 'Q3', classes: ['Q178561', 'Q176799'] }, // battle + military unit: excluded
        { qid: 'Q4', classes: ['Q11424'] }, // film: not an occurrence
      ],
      classInfo,
    );
    expect(kept.map((k) => k.qid)).toEqual(['Q1']);
  });

  it('reads the exclude list, ignoring comments', () => {
    expect([...parseExcludeList('# header\nQ12  # not an event\n\nQ34\r\nnot-a-qid\n')]).toEqual(['Q12', 'Q34']);
  });
});

describe('validator', () => {
  const good = {
    id: 'battle_x',
    title: 'Battle X',
    summary: '',
    field: 'politics',
    date: { earliest: 1940, latest: 1941, best: 1940.5, precision: 'year', method: 'community', sources: [] },
  };

  it('accepts a minimal hand-written event', () => {
    expect(checkEvent(good, 'battle_x')).toEqual([]);
  });

  it('catches the usual mistakes in plain English', () => {
    const bad = { ...good, field: 'war', summery: 'typo', date: { ...good.date, best: 1950 } };
    const errs = checkEvent(bad, 'wrong_name');
    expect(errs.some((e) => e.includes('field must be one of'))).toBe(true);
    expect(errs.some((e) => e.includes('earliest ≤ best ≤ latest'))).toBe(true);
    expect(errs.some((e) => e.includes('unknown field "summery"'))).toBe(true);
    expect(errs.some((e) => e.includes('file name should be battle_x.json'))).toBe(true);
  });

  it('requires cited sources to exist', () => {
    const cites = { ...good, date: { ...good.date, sources: ['made_up_book'] } };
    const errs = checkReferences([{ path: 'data/events/x/battle_x.json', kind: 'event', data: cites }]);
    expect(errs[0].message).toContain('made_up_book');
  });
});
