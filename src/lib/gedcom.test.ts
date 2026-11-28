// Tests for the GEDCOM importer, on a small made-up family tree (not real people).
import { describe, expect, it } from 'vitest';
import { importGedcom, parseGedcomTree } from './gedcom';
import { yearToYmd } from './dates';

const TREE = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @S1@ SOUR
1 TITL Parish register, St Example's
1 PUBL 1921
0 @I1@ INDI
1 NAME Albert /Example/
1 BIRT
2 DATE 12 MAR 1920
2 PLAC Exampletown
2 SOUR @S1@
1 DEAT
2 DATE ABT 1995
0 @I2@ INDI
1 NAME Edith /Sample/
1 BIRT
2 DATE BET 1922 AND 1924
1 NOTE Loved the sea.
2 CONT Kept a diary.
0 @I3@ INDI
1 NAME Young /Example/
1 BIRT
2 DATE 1990
0 @I4@ INDI
1 NAME Mystery /Example/
1 BURI
2 DATE sometime
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE JUN 1946
2 PLAC Seaside
1 CHIL @I3@
0 TRLR`;

describe('GEDCOM import', () => {
  it('parses the line format, joining CONT lines', () => {
    const roots = parseGedcomTree(TREE);
    expect(roots.map((r) => r.tag)).toEqual(['HEAD', 'SOUR', 'INDI', 'INDI', 'INDI', 'INDI', 'FAM', 'TRLR']);
    const edith = roots.find((r) => r.xref === '@I2@')!;
    expect(edith.children.find((c) => c.tag === 'NOTE')!.value).toBe('Loved the sea.\nKept a diary.');
  });

  it('turns births, deaths and marriages into events and people', () => {
    const r = importGedcom(TREE, 2026);
    expect(r.people.map((p) => p.name)).toEqual(['Albert Example', 'Edith Sample', 'Young Example', 'Mystery Example']);
    expect(r.events.map((e) => e.title)).toEqual([
      'Birth of Albert Example',
      'Death of Albert Example',
      'Birth of Edith Sample',
      'Birth of Young Example',
      'Marriage of Albert Example and Edith Sample',
    ]);
    const albert = r.people[0];
    expect(yearToYmd(albert.born!.best + 1e-7)).toEqual({ y: 1920, m: 3, d: 12 });
    const marriage = r.events.find((e) => e.kind === 'marriage')!;
    expect(marriage.peopleIds).toEqual([r.people[0].id, r.people[1].id]);
    expect(marriage.summary).toBe('At Seaside.');
    expect(marriage.date.precision).toBe('month');
  });

  it('keeps fuzzy GEDCOM dates fuzzy, so they glow as spans', () => {
    const r = importGedcom(TREE, 2026);
    expect(r.people[0].died).toMatchObject({ earliest: 1993, latest: 1998, method: 'scholarly_estimate' });
    expect(r.people[1].born).toMatchObject({ earliest: 1922, latest: 1925 });
  });

  it('links citations to sources', () => {
    const r = importGedcom(TREE, 2026);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({ title: "Parish register, St Example's", type: 'primary_document', year: 1921 });
    const birth = r.events.find((e) => e.title === 'Birth of Albert Example')!;
    expect(birth.sourceIds).toEqual([r.sources[0].id]);
    expect(birth.date.sources).toEqual([r.sources[0].id]);
  });

  it('marks people with no death record born in the last 100 years as living', () => {
    const r = importGedcom(TREE, 2026);
    const living = Object.fromEntries(r.people.map((p) => [p.name, p.living]));
    expect(living).toEqual({ 'Albert Example': false, 'Edith Sample': false, 'Young Example': true, 'Mystery Example': true });
  });

  it('notes what it skipped instead of guessing', () => {
    const r = importGedcom(TREE, 2026);
    expect(r.skipped.join()).toContain('couldn’t read the date “sometime”');
    expect(r.events.some((e) => e.title.includes('Mystery'))).toBe(false);
  });

  it('rejects files that are not GEDCOM', () => {
    expect(() => importGedcom('hello world', 2026)).toThrow('GEDCOM');
  });
});
