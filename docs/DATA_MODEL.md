# Data Model

Everything is a node in one graph; every node is versioned. TypeScript types live in `src/types.ts`.

## Core nodes
- **Entity** — person, institution, company, government, funder, publication. Has `foundedAt` (its position on the river), `field`, links to funders.
- **Event** — something that happened at a time (or range). Sits on the river in a field lane.
- **Topic** — a debate/fork hanging off an event ("Did the UK win WW2?"). Topics can nest.
- **Claim** — a statement under a topic. Has a `stance` toward its parent (supports / opposes / refines) and a computed `status`.
- **Evidence** — links a Source to a Claim with a direction (for / against) and relevance.
- **Source** — paper, article, dataset, video, post. Has authors (Entities), institution, funders, type, `conflictOfInterest`, `retracted`.
- **Penalty** — fine, settlement, sanction, retraction against an Entity: amount, date, type, regulator, link.
- **FundingEdge** — funder → recipient, amount/share if known, date range, disclosed or discovered.

## Signals
- **Vote** — `{ userId, targetId, kind: 'agree' | 'well_sourced', value: +1 | -1, at }`
- **ExternalPoll** — results imported from other platforms/pollsters, with link, method, sample size.
- **OpinionSeries** — time series for a topic (polls + on-platform votes), with linked events for correlation.

## AI snapshots
**AISnapshot** — `{ claimId, provider, model, version, askedAt, prompts[], output, threadUrl?, submittedBy, reproductions[] }`
- `reproductions` are other users re-asking the same prompts: match / partial / differs.
- Lets us graph how AI answers on a claim drift over time and across models.

## Versioning
Append-only **EditEvent** log: `{ id, nodeId, userId, at, before, after, summary }`.
- Any node can be viewed "as of" any date.
- Edit history is itself browsable: an "edit war" becomes something you can open and study.

## Storage plan
- Postgres with adjacency tables for the graph (Apache AGE or recursive CTEs for traversal).
- Event log table as the source of truth; materialised current-state tables for speed.
- Nightly public data dump (JSON + SQL) for forkability.
- Seed import from Wikidata (dates + links for millions of entities), OpenAlex/ORCID (papers, authors, grants), and public enforcement databases for penalties.
