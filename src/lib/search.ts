// Search across events, people/organisations and claims, as you type.
//
// Matching is forgiving: case and accents are ignored, and every word you type must
// appear somewhere in the item (in any order). Results are ranked so that title
// matches beat summary matches, and words that *start* with what you typed beat
// matches in the middle of a word. Ties go to the more important event.
import type { Dataset, Field, FuzzyDate } from '../types';
import { importanceMap } from './importance';
import { resolveEventDate } from './dateDispute';
import { formatDate } from './dates';

export type ResultKind = 'event' | 'entity' | 'claim';

export interface SearchResult {
  kind: ResultKind;
  id: string;
  title: string;
  detail: string; // a short second line: date, kind, or which event it belongs to
  field: Field;
  date: FuzzyDate; // where on the river it lives
  eventId?: string; // for claims: the event its debate hangs off
  score: number;
}

/** Lower-case and strip accents, so "Écrit" matches "ecrit". */
export const normalise = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** How well one piece of text matches the query words (0 = not all words found). */
function matchScore(text: string, words: string[], weight: number): number {
  const t = normalise(text);
  let score = 0;
  for (const w of words) {
    const i = t.indexOf(w);
    if (i < 0) return 0;
    const atWordStart = i === 0 || /[^a-z0-9]/.test(t[i - 1]);
    score += atWordStart ? 2 : 1;
  }
  if (t.startsWith(words.join(' '))) score += 3; // the whole query starts the text
  return score * weight;
}

/** Best match of the query against a title (counts more) and some extra text. */
function score(title: string, extra: string, words: string[]): number {
  const inTitle = matchScore(title, words, 2);
  if (inTitle) return inTitle;
  return matchScore(`${title} ${extra}`, words, 1);
}

export interface SearchOptions {
  fields?: Field[]; // only these lanes (empty or missing = all)
  limit?: number;
}

export function search(data: Dataset, query: string, { fields, limit = 20 }: SearchOptions = {}): SearchResult[] {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const allowed = (f: Field) => !fields?.length || fields.includes(f);
  const importance = importanceMap(data);
  const results: SearchResult[] = [];

  for (const ev of data.events) {
    if (!allowed(ev.field)) continue;
    const s = score(ev.title, ev.summary, words);
    if (!s) continue;
    const date = resolveEventDate(ev, data).date;
    results.push({ kind: 'event', id: ev.id, title: ev.title, detail: `${formatDate(date)} · ${ev.space ? `${ev.space.name} (only on this device)` : 'event'}`, field: ev.field, date, score: s + (importance.get(ev.id)?.score ?? 0) / 100 });
  }

  for (const en of data.entities) {
    if (!allowed(en.field)) continue;
    const s = score(en.name, en.description, words);
    if (s) results.push({ kind: 'entity', id: en.id, title: en.name, detail: en.space ? `person · ${en.space.name}${en.space.undated ? '' : ` · born ${formatDate(en.founded)}`}` : `${en.kind} · founded ${formatDate(en.founded)}`, field: en.field, date: en.founded, score: s });
  }

  for (const c of data.claims) {
    const topic = data.topics.find((t) => t.id === c.topicId);
    const ev = topic && data.events.find((e) => e.id === topic.eventId);
    if (!topic || !ev || !allowed(ev.field)) continue;
    const s = score(c.text, topic.title, words);
    if (s) results.push({ kind: 'claim', id: c.id, title: c.text, detail: `claim · ${ev.title}`, field: ev.field, date: resolveEventDate(ev, data).date, eventId: ev.id, score: s * 0.9 });
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
