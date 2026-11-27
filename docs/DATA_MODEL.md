# Data Model

Everything is a node in one graph; every node is versioned. TypeScript types live in `src/types.ts`.

## Dates: `FuzzyDate`
Every date says how sure we are:

```ts
{ earliest: Year, latest: Year, best: Year,
  precision: 'day' | 'month' | 'year' | 'decade' | 'century' | 'millennium',
  method: 'documented' | 'contemporary_accounts' | 'archaeological' | 'radiocarbon'
        | 'scholarly_estimate' | 'wikidata' | 'community',
  sources: string[] }   // Source ids; empty = not cited yet
```
`Year` is a decimal year (negative = BCE). Rule: `earliest ≤ best ≤ latest`. `best` positions the item on the river; when `earliest..latest` is wider than the precision explains, the river draws a glowing span. Helpers: `src/lib/dates.ts`. Used by `Event.date`, `Event.end` and `Entity.founded`. Other timestamps (penalties, publication years, poll points, status history) are still plain `Year`s and can move to `FuzzyDate` when they need uncertainty.

### Date disputes
A **Topic** with `dateOf: <eventId>` is a dispute about *when* that event happened. Each of its claims carries a `proposedDate: FuzzyDate` and evidence like any claim, and earns a status the usual way (agree votes never count). `src/lib/dateDispute.ts → resolveEventDate()` turns those statuses into the date the river shows:
- an **Established** proposal wins outright;
- otherwise, if any are **Contested**, the span widens to cover the recorded date and every Contested proposal (marker stays on the recorded date) and is flagged `disputed`;
- **Fringe / Disproven** proposals don't move anything.
Each result includes a plain-English `reason`, shown in the event's "Explain this date" box.

## Core nodes
- **Entity** — person, institution, company, government, funder, publication. Has `founded: FuzzyDate` (its position on the river), `field`, links to funders.
- **Event** — something that happened: `date: FuzzyDate`, optional `end: FuzzyDate` for things that lasted. Sits on the river in a field lane. Events loaded from `data/` carry `provenance` (where they came from, Wikidata id, whether a person has edited them by hand).
- **Topic** — a debate/fork hanging off an event ("Did the UK win WW2?"). Topics can nest. `dateOf` marks a date dispute.
- **Claim** — a statement under a topic. Has a `stance` toward its parent (supports / opposes / refines) and a computed `status`. Date-dispute claims also have a `proposedDate`.
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

## Storage today: JSON files + pull requests
Until the backend exists, real data is one JSON file per item in `data/` (`events/<collection>/`, `entities/`, `sources/`), validated by `scripts/validate-data.mjs` against the rules in `data/schema/`, and loaded at build time by `src/data/repoData.ts`. Git history is the edit log; pull requests are the review step. Source ids of the form `wikidata:Q123` are created automatically from the Wikidata item. Real data may not reference demo seed entities.

## Storage plan
- Postgres with adjacency tables for the graph (Apache AGE or recursive CTEs for traversal).
- Event log table as the source of truth; materialised current-state tables for speed.
- Nightly public data dump (JSON + SQL) for forkability.
- Seed import from Wikidata (dates + links for millions of entities), OpenAlex/ORCID (papers, authors, grants), and public enforcement databases for penalties.
