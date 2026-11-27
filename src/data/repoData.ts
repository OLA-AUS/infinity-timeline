// Loads the real (non-demo) data that lives as JSON files in the repo's data/ folder.
//
// Why files? Every edit to the data is a pull request: reviewable, discussable, and kept
// forever in git history. See CONTRIBUTING.md → "Editing data".
//
//   data/events/<collection>/<id>.json   one event per file (e.g. data/events/ww2/Q8641370.json)
//   data/entities/<id>.json              one person / organisation per file
//   data/sources/<id>.json               one source (book, paper, archive record) per file
//
// An event file may list "links" to other events ({ to, type, note?, sources? }). They're
// turned into EventLink records here, with no votes yet (votes come from the site).
//
// Vite bundles these at build time (import.meta.glob), so the site stays fully static
// and can be hosted on any static host (Render, GitHub Pages) with no server.
import type { Dataset, Entity, EventLink, Source, TimelineEvent } from '../types';

type EventFile = Omit<TimelineEvent, 'provenance'> & { $schema?: string; provenance?: TimelineEvent['provenance'] };
type EntityFile = Entity & { $schema?: string };
type SourceFile = Source & { $schema?: string };

const eventFiles = import.meta.glob<EventFile>('../../data/events/**/*.json', { eager: true, import: 'default' });
const entityFiles = import.meta.glob<EntityFile>('../../data/entities/*.json', { eager: true, import: 'default' });
const sourceFiles = import.meta.glob<SourceFile>('../../data/sources/*.json', { eager: true, import: 'default' });

/** Turn the bundler's "../../data/x.json" key into the repo path "data/x.json". */
const repoPath = (key: string) => key.replace(/^(\.\.\/)+/, '');

/** Source ids that start with this prefix are made automatically from the Wikidata item id. */
export const WIKIDATA_SOURCE_PREFIX = 'wikidata:';

/** A Source record for a Wikidata item, so it shows up (and is trust-scored) like any other source. */
function wikidataSource(id: string, ev: TimelineEvent): Source {
  const qid = id.slice(WIKIDATA_SOURCE_PREFIX.length);
  const retrieved = ev.provenance?.retrievedAt ? Number(ev.provenance.retrievedAt.slice(0, 4)) : 2026;
  return {
    id,
    title: `Wikidata item ${qid}: ${ev.title}`,
    type: 'reference_work',
    publishedAt: retrieved,
    authorIds: [], // Wikidata is written by many anonymous / pseudonymous editors
    institutionId: 'e_wikidata',
    funderIds: [],
    url: `https://www.wikidata.org/wiki/${qid}`,
  };
}

type RepoData = Pick<Dataset, 'events' | 'entities' | 'sources' | 'links'>;

/** A stable id for a link from a data file, so votes and edits can refer to it. */
export const linkId = (from: string, type: string, to: string) => `${from}>${type}>${to}`;

export function loadRepoData(): RepoData {
  const events: TimelineEvent[] = Object.entries(eventFiles)
    .map(([key, file]) => {
      const { $schema: _schema, ...ev } = file;
      return { ...ev, topicIds: ev.topicIds ?? [], provenance: { importedFrom: 'manual' as const, ...ev.provenance, file: repoPath(key) } };
    })
    .sort((a, b) => a.date.best - b.date.best);

  const entities: Entity[] = Object.values(entityFiles).map(({ $schema: _schema, ...en }) => en);

  // Hand-written sources first, then a Source record for every "wikidata:Q…" id a date or link points to.
  const sources = new Map<string, Source>(Object.values(sourceFiles).map(({ $schema: _schema, ...s }) => [s.id, s]));
  for (const ev of events) {
    for (const id of [...ev.date.sources, ...(ev.end?.sources ?? []), ...(ev.links ?? []).flatMap((l) => l.sources ?? [])]) {
      if (id.startsWith(WIKIDATA_SOURCE_PREFIX) && !sources.has(id)) sources.set(id, wikidataSource(id, ev));
    }
  }

  // Links written inside event files. A link whose only sources are Wikidata came from the importer.
  const links: EventLink[] = events.flatMap((ev) =>
    (ev.links ?? []).map((l) => {
      const srcs = l.sources ?? [];
      const fromWikidata = ev.provenance?.importedFrom === 'wikidata' && srcs.length > 0 && srcs.every((x) => x.startsWith(WIKIDATA_SOURCE_PREFIX));
      return {
        id: linkId(ev.id, l.type, l.to),
        from: ev.id,
        to: l.to,
        type: l.type,
        note: l.note,
        sources: srcs,
        origin: fromWikidata ? ('wikidata' as const) : ('community' as const),
        wellSourced: { up: 0, down: 0 },
        agree: { up: 0, down: 0 },
      };
    }),
  );
  return { events, entities, sources: [...sources.values()], links };
}

/** Add repo data on top of the demo seed. Ids must not clash — the data validator checks this. */
export function mergeDatasets(base: Dataset, extra: RepoData): Dataset {
  return {
    ...base,
    events: [...base.events, ...extra.events],
    entities: [...base.entities, ...extra.entities],
    sources: [...base.sources, ...extra.sources],
    links: [...base.links, ...extra.links],
  };
}
