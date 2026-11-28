// Import a family tree from a GEDCOM file (.ged — what Ancestry, FamilySearch, MyHeritage,
// Gramps and most family-tree programs export) into a personal space.
//
// What comes across:
//   • every person (INDI) → a person, with birth and death dates
//   • births, christenings/baptisms, deaths and burials → events for that person
//   • marriages and divorces (FAM) → events for both partners
//   • source records (SOUR) → sources; a citation under an event backs that event
// Dates use GEDCOM's own words (ABT, BEF, AFT, BET … AND, EST, CAL), which src/lib/dateInput.ts
// already understands, so "ABT 1920" glows as a span like any uncertain date.
//
// Living people: anyone with no death record, born within the last LIVING_YEARS years (or with
// no birth date at all), is marked `living`. Everything stays on this device either way, but the
// flag matters later: living people stay hidden in any public space unless they approve.
//
// GEDCOM is a simple line format: "<level> [@ID@] <TAG> [value]". Level 0 starts a record;
// deeper levels belong to the line above them.
import type { FuzzyDate } from '../types';
import { parseDateText } from './dateInput';
import { newId, type PersonalEvent, type PersonalPerson, type PersonalSource } from './personal';

/** No death record and born within this many years → treated as living. */
export const LIVING_YEARS = 100;

interface Line {
  level: number;
  xref?: string;
  tag: string;
  value: string;
  children: Line[];
}

/** Parse GEDCOM text into a tree of records. CONC / CONT continuation lines are joined. */
export function parseGedcomTree(text: string): Line[] {
  const roots: Line[] = [];
  const stack: Line[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const m = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/.exec(raw);
    if (!m) continue;
    const line: Line = { level: +m[1], xref: m[2], tag: m[3].toUpperCase(), value: (m[4] ?? '').trim(), children: [] };
    while (stack.length && stack[stack.length - 1].level >= line.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (line.tag === 'CONC' && parent) { parent.value += line.value; continue; }
    if (line.tag === 'CONT' && parent) { parent.value += `\n${line.value}`; continue; }
    if (parent) parent.children.push(line);
    else roots.push(line);
    stack.push(line);
  }
  return roots;
}

const child = (l: Line, tag: string) => l.children.find((c) => c.tag === tag);
const children = (l: Line, tag: string) => l.children.filter((c) => c.tag === tag);

/** "John /Smith/" → "John Smith". */
const cleanName = (n: string) => n.replace(/\//g, ' ').replace(/\s+/g, ' ').trim() || 'Unknown';

export interface GedcomResult {
  people: PersonalPerson[];
  events: PersonalEvent[];
  sources: PersonalSource[];
  /** Plain-English notes about anything skipped (e.g. an unreadable date). */
  skipped: string[];
}

const INDI_EVENTS: Record<string, { kind: PersonalEvent['kind']; verb: string }> = {
  BIRT: { kind: 'birth', verb: 'Birth of' },
  CHR: { kind: 'other', verb: 'Christening of' },
  BAPM: { kind: 'other', verb: 'Baptism of' },
  DEAT: { kind: 'death', verb: 'Death of' },
  BURI: { kind: 'other', verb: 'Burial of' },
};
const FAM_EVENTS: Record<string, { kind: PersonalEvent['kind']; verb: string }> = {
  MARR: { kind: 'marriage', verb: 'Marriage of' },
  DIV: { kind: 'other', verb: 'Divorce of' },
};

/**
 * Turn GEDCOM text into people, events and sources for a space (with fresh local ids).
 * `thisYear` decides who counts as living. Nothing is fetched — media files are not imported.
 */
export function importGedcom(text: string, thisYear: number): GedcomResult {
  const roots = parseGedcomTree(text);
  if (!roots.some((r) => r.tag === 'HEAD') && !roots.some((r) => r.tag === 'INDI')) throw new Error('That doesn’t look like a GEDCOM file (no HEAD or INDI records).');
  const skipped: string[] = [];

  // Sources first, so events can point at them.
  const sources: PersonalSource[] = [];
  const sourceByXref = new Map<string, string>();
  for (const r of roots.filter((x) => x.tag === 'SOUR' && x.xref)) {
    const id = newId('src');
    sourceByXref.set(r.xref!, id);
    const year = Number(/\b(\d{4})\b/.exec(child(r, 'PUBL')?.value ?? child(r, 'DATA')?.value ?? '')?.[1]);
    sources.push({
      id,
      title: child(r, 'TITL')?.value || child(r, 'ABBR')?.value || r.value || 'Untitled source',
      type: 'primary_document',
      ...(Number.isFinite(year) && year > 0 ? { year } : {}),
      note: [child(r, 'AUTH')?.value && `Author: ${child(r, 'AUTH')!.value}`, child(r, 'PUBL')?.value].filter(Boolean).join(' · ') || undefined,
      gedcomId: r.xref,
    });
  }
  const citations = (l: Line) => children(l, 'SOUR').map((s) => sourceByXref.get(s.value)).filter((x): x is string => !!x);

  /** The date under an event line, or null (with a note) if it can't be read. */
  const dateOf = (l: Line, what: string): FuzzyDate | null => {
    const raw = child(l, 'DATE')?.value;
    if (!raw) return null;
    const d = parseDateText(raw.replace(/\bAND\b/i, 'and'), undefined, citations(l));
    if (!d) skipped.push(`${what}: couldn’t read the date “${raw}”.`);
    return d;
  };
  const place = (l: Line) => child(l, 'PLAC')?.value;

  const people: PersonalPerson[] = [];
  const personByXref = new Map<string, PersonalPerson>();
  const events: PersonalEvent[] = [];

  for (const r of roots.filter((x) => x.tag === 'INDI' && x.xref)) {
    const name = cleanName(child(r, 'NAME')?.value ?? '');
    const person: PersonalPerson = { id: newId('person'), name, gedcomId: r.xref };
    for (const [tag, info] of Object.entries(INDI_EVENTS)) {
      const ev = child(r, tag);
      if (!ev) continue;
      const date = dateOf(ev, `${info.verb} ${name}`);
      if (tag === 'BIRT' && date) person.born = date;
      if (tag === 'DEAT' && date) person.died = date;
      if (!date) {
        if (!child(ev, 'DATE')) skipped.push(`${info.verb} ${name}: no date, so it isn’t on the river.`);
        continue;
      }
      events.push({
        id: newId('event'),
        title: `${info.verb} ${name}`,
        date,
        summary: [place(ev) && `At ${place(ev)}.`, child(ev, 'NOTE')?.value].filter(Boolean).join(' '),
        peopleIds: [person.id],
        sourceIds: date.sources,
        kind: info.kind,
        gedcomId: r.xref,
      });
    }
    const died = !!child(r, 'DEAT');
    person.living = !died && (!person.born || person.born.latest > thisYear - LIVING_YEARS);
    const note = child(r, 'NOTE')?.value;
    if (note && !note.startsWith('@')) person.note = note;
    people.push(person);
    personByXref.set(r.xref!, person);
  }

  for (const r of roots.filter((x) => x.tag === 'FAM')) {
    const partners = ['HUSB', 'WIFE'].map((t) => personByXref.get(child(r, t)?.value ?? '')).filter((p): p is PersonalPerson => !!p);
    if (!partners.length) continue;
    const names = partners.map((p) => p.name).join(' and ');
    for (const [tag, info] of Object.entries(FAM_EVENTS)) {
      const ev = child(r, tag);
      if (!ev) continue;
      const date = dateOf(ev, `${info.verb} ${names}`);
      if (!date) {
        if (!child(ev, 'DATE')) skipped.push(`${info.verb} ${names}: no date, so it isn’t on the river.`);
        continue;
      }
      events.push({
        id: newId('event'),
        title: `${info.verb} ${names}`,
        date,
        summary: place(ev) ? `At ${place(ev)}.` : '',
        peopleIds: partners.map((p) => p.id),
        sourceIds: date.sources,
        kind: info.kind,
        gedcomId: r.xref,
      });
    }
  }
  return { people, events, sources, skipped };
}
