// The shapes of every piece of data in the app. If you are new, start here.
// The prose version of this file is docs/DATA_MODEL.md — keep the two in sync.

/**
 * A moment in time as a decimal year. Negative numbers are BCE.
 * Example: 1939.67 is roughly 1 September 1939 (two-thirds of the way through 1939).
 * We use plain numbers so time maths (distances, sorting, scaling) stays simple.
 */
export type Year = number;

/** How finely a date is actually known. "day" = we know the exact day; "century" = only the century. */
export type DatePrecision = 'day' | 'month' | 'year' | 'decade' | 'century' | 'millennium';

/**
 * How a date was worked out. Shown to readers so they can judge it themselves.
 * Add new methods here (and a description in src/lib/dates.ts) rather than overloading old ones.
 */
export type DateMethod =
  | 'documented' // written down at the time (a dated letter, treaty, newspaper)
  | 'contemporary_accounts' // eyewitness accounts that roughly agree
  | 'archaeological' // dated from digs, layers or artefacts
  | 'radiocarbon' // carbon-14 or another lab dating technique
  | 'scholarly_estimate' // historians' best estimate from indirect clues
  | 'wikidata' // copied from Wikidata by an importer — check it against a primary source
  | 'community'; // proposed by an editor here, still to be backed by a source

/**
 * A date that admits how sure we are.
 * - `best` is the single most likely moment — it is where the event sits on the river.
 * - `earliest`/`latest` bound the honest range. When they are far apart the river draws a glowing span.
 * - `sources` are Source ids that back this date up. Empty means "nobody has cited this yet".
 * Rule: earliest <= best <= latest. The data validator (scripts/validate-data.mjs) checks this.
 */
export interface FuzzyDate {
  earliest: Year;
  latest: Year;
  best: Year;
  precision: DatePrecision;
  method: DateMethod;
  sources: string[];
}

/** The parallel strands ("lanes") of the river. Each event and entity lives in one lane. */
export type Field =
  | 'politics'
  | 'science'
  | 'medicine'
  | 'economics'
  | 'technology'
  | 'culture';

export const FIELDS: Field[] = ['politics', 'science', 'medicine', 'economics', 'technology', 'culture'];

export type EntityKind = 'person' | 'institution' | 'company' | 'government' | 'funder' | 'publication';

/** Anyone or anything that can make a claim, write a source, or fund someone. */
export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  field: Field;
  founded: FuzzyDate; // born / founded — its position on the river
  description: string;
  demo?: boolean; // true = fictional placeholder; the UI says so
}

export type PenaltyType = 'criminal_fraud' | 'civil_settlement' | 'regulatory_fine' | 'warning' | 'retraction';

/** A fine, settlement, warning or retraction against an entity. Lowers its trust score. */
export interface Penalty {
  id: string;
  entityId: string;
  type: PenaltyType;
  amountUSD: number;
  at: Year;
  regulator: string;
  summary: string;
  url?: string;
}

/** "Funder paid recipient." Trust flows (damped) along these edges. See docs/TRUST_MODEL.md §2. */
export interface FundingEdge {
  funderId: string;
  recipientId: string;
  share?: number; // 0..1 of recipient's funding, if known
  disclosed: boolean; // false = discovered after the fact
  from?: Year;
  to?: Year;
}

/** Where an event came from, when it was loaded from a file in data/ rather than the demo seed. */
export interface EventProvenance {
  importedFrom: 'wikidata' | 'manual';
  qid?: string; // Wikidata item id, e.g. "Q8641370"
  retrievedAt?: string; // ISO date the importer ran
  wikipedia?: string; // English Wikipedia article, if any
  /** How many Wikipedia language editions cover it — one input to its importance score. */
  sitelinks?: number;
  /** Set to true when a person edits the file by hand, so the importer won't overwrite it. */
  manualEdits?: boolean;
  /** Wikidata itself listed more than one value for this date. The span covers all of them. */
  conflictingValues?: string[];
  /** Repo-relative path of the JSON file (added by the loader, not stored in the file). */
  file?: string;
}

/** Something that happened. A glowing node on the river. */
export interface TimelineEvent {
  id: string;
  title: string;
  date: FuzzyDate; // when it happened (or began)
  end?: FuzzyDate; // when it finished, for things that lasted a while (a battle, a war)
  field: Field;
  summary: string;
  topicIds: string[]; // debates hanging off this event
  provenance?: EventProvenance;
  /**
   * Links from this event to others, as written in a data file (data/events/…).
   * The loader turns these into EventLink records in Dataset.links.
   */
  links?: EventLinkSpec[];
}

/**
 * How two events are related. Read it as "FROM <type> TO":
 *   caused       — the first event caused the second
 *   led_to       — the first came before and helped bring about the second (weaker than caused)
 *   part_of      — the first is a part of the second (a battle that is part of a campaign)
 *   response_to  — the first happened in response to the second
 */
export type LinkType = 'caused' | 'led_to' | 'part_of' | 'response_to';
export const LINK_TYPES: LinkType[] = ['caused', 'led_to', 'part_of', 'response_to'];

/** A link as written inside an event's data file: always outgoing, from that event. */
export interface EventLinkSpec {
  to: string; // the other event's id
  type: LinkType;
  note?: string;
  sources?: string[]; // Source ids (or "wikidata:Q…") backing the link
}

/**
 * A typed link between two events — the river's "this is connected to that".
 * Links are claims in their own right: "well sourced" votes change how strong the link
 * is (src/lib/related.ts → linkStrength), "agree" votes are public opinion and never do.
 */
export interface EventLink {
  id: string;
  from: string; // event id
  to: string; // event id
  type: LinkType;
  note?: string;
  sources: string[];
  origin: 'curated' | 'wikidata' | 'community'; // who drew it: hand-picked, importer, or an editor
  claimantId?: string; // entity that proposed the link, if known
  wellSourced: { up: number; down: number }; // moves strength
  agree: { up: number; down: number }; // public opinion — never moves strength
  demo?: boolean;
}

/**
 * A debate hanging off an event ("Did the UK win WW2?").
 * If `dateOf` is set, the debate is about *when* that event happened, and its
 * claims each propose a date (see Claim.proposedDate).
 */
export interface Topic {
  id: string;
  eventId: string;
  title: string;
  claimIds: string[];
  dateOf?: string; // event id whose date this topic disputes
}

export type Stance = 'supports' | 'opposes' | 'refines';

export type ClaimStatus = 'Established' | 'Contested' | 'Fringe' | 'Disproven' | 'Later confirmed';

/** A statement someone made. Its status is *earned* from evidence — see src/lib/status.ts. */
export interface Claim {
  id: string;
  topicId: string;
  parentClaimId?: string;
  stance?: Stance; // relative to parent claim
  text: string;
  claimantId: string; // who made the claim
  steelman?: string;
  falsifiableBy?: string;
  childClaimIds: string[];
  evidenceIds: string[];
  agree: { up: number; down: number }; // public opinion — never moves status
  statusHistory?: { at: Year; status: ClaimStatus }[];
  edits?: EditEvent[];
  /** For date-dispute topics: the date this claim says the event happened. */
  proposedDate?: FuzzyDate;
}

export type SourceType =
  | 'meta_analysis'
  | 'rct'
  | 'peer_reviewed'
  | 'book'
  | 'preprint'
  | 'journalism'
  | 'op_ed'
  | 'social_post'
  | 'primary_document'
  | 'reference_work'; // encyclopedias and knowledge bases such as Wikidata

/** A paper, book, article, dataset or post that evidence points to. */
export interface Source {
  id: string;
  title: string;
  type: SourceType;
  publishedAt: Year;
  authorIds: string[];
  institutionId?: string;
  funderIds: string[];
  conflictOfInterest?: string; // set when a funder benefits from the conclusion
  retracted?: boolean;
  url?: string;
  demo?: boolean;
}

/** Links a source to a claim: "this source supports / opposes this claim, this much". */
export interface Evidence {
  id: string;
  claimId: string;
  sourceId: string;
  direction: 'for' | 'against';
  relevance: number; // 0..1
  note: string;
  wellSourced: { up: number; down: number }; // moves status
}

/** A saved, timestamped answer from an AI model about a claim, which others can try to reproduce. */
export interface AISnapshot {
  id: string;
  claimId: string;
  provider: string;
  model: string;
  askedAt: string; // ISO timestamp
  prompts: string[];
  output: string;
  submittedBy: string;
  reproductions: { by: string; at: string; result: 'match' | 'partial' | 'differs' }[];
}

/** Public opinion over time for a topic (polls, on-site votes). Shown, never used to decide truth. */
export interface OpinionSeries {
  id: string;
  topicId: string;
  title: string;
  unit: string;
  points: { at: Year; value: number; source: string }[];
  linkedEventIds: string[];
  demo?: boolean;
}

/** One entry in the append-only edit log. Nothing is ever deleted; edits are added. */
export interface EditEvent {
  id: string;
  userId: string;
  at: string;
  summary: string;
}

/** Everything the app knows, in one bundle. Seed data and repo data files are merged into this. */
export interface Dataset {
  entities: Entity[];
  penalties: Penalty[];
  funding: FundingEdge[];
  events: TimelineEvent[];
  topics: Topic[];
  claims: Claim[];
  sources: Source[];
  evidence: Evidence[];
  aiSnapshots: AISnapshot[];
  opinions: OpinionSeries[];
  links: EventLink[];
}
