// Core data model. See docs/DATA_MODEL.md.

/** Time is a decimal year. Negative = BCE. e.g. 1939.67 ≈ 1 Sep 1939 */
export type Year = number;

export type Field =
  | 'politics'
  | 'science'
  | 'medicine'
  | 'economics'
  | 'technology'
  | 'culture';

export const FIELDS: Field[] = ['politics', 'science', 'medicine', 'economics', 'technology', 'culture'];

export type EntityKind = 'person' | 'institution' | 'company' | 'government' | 'funder' | 'publication';

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  field: Field;
  foundedAt: Year; // born / founded — its position on the river
  description: string;
  demo?: boolean;
}

export type PenaltyType = 'criminal_fraud' | 'civil_settlement' | 'regulatory_fine' | 'warning' | 'retraction';

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

export interface FundingEdge {
  funderId: string;
  recipientId: string;
  share?: number; // 0..1 of recipient's funding, if known
  disclosed: boolean; // false = discovered after the fact
  from?: Year;
  to?: Year;
}

export interface TimelineEvent {
  id: string;
  title: string;
  at: Year;
  field: Field;
  summary: string;
  topicIds: string[];
}

export interface Topic {
  id: string;
  eventId: string;
  title: string;
  claimIds: string[];
}

export type Stance = 'supports' | 'opposes' | 'refines';

export type ClaimStatus = 'Established' | 'Contested' | 'Fringe' | 'Disproven' | 'Later confirmed';

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
}

export type SourceType = 'meta_analysis' | 'rct' | 'peer_reviewed' | 'book' | 'preprint' | 'journalism' | 'op_ed' | 'social_post' | 'primary_document';

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

export interface Evidence {
  id: string;
  claimId: string;
  sourceId: string;
  direction: 'for' | 'against';
  relevance: number; // 0..1
  note: string;
  wellSourced: { up: number; down: number }; // moves status
}

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

export interface OpinionSeries {
  id: string;
  topicId: string;
  title: string;
  unit: string;
  points: { at: Year; value: number; source: string }[];
  linkedEventIds: string[];
  demo?: boolean;
}

export interface EditEvent {
  id: string;
  userId: string;
  at: string;
  summary: string;
}

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
}
