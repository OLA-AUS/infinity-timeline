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

## Event importance (what shows when the river is crowded)
Computed, never stored: `src/lib/importance.ts → eventImportance()` returns a score plus its factors, shown under "River importance" beside each event.

`importance = 10 × debates + 3 × opinion charts linking to it + 2 × distinct date sources + 4 × log2(1 + sitelinks) + 25 if hand-picked`

`provenance.sitelinks` (how many Wikipedia language editions cover an item) is written by the Wikidata importer. `LOD_THRESHOLD` sets the minimum importance for a bubble at each level of expansion: 25 on the full river; at any other level (a period, years, months, weeks or days), everything gets one. Below it an event is a faint dot. Like trust weights, changing these is a governance decision.

## Time scale and expanded periods
`src/lib/timeScale.ts` defines the levels and their scale.
- **Levels:** `full` · `period` · `years` · `months` · `weeks` · `days`. Except for the full river, each shows a **window** `{ level, start, end, tick }`: Years a decade, Months a calendar year, Weeks a calendar quarter, Days a calendar month, and a period whatever span was expanded.
- **Scale:** inside the window, time is linear over `WINDOW_LENGTH` river units. Outside it the normal log scale continues, squeezed by `OUTSIDE_SQUEEZE`.
- **Placing things:** `makeScale(window)` gives `toS(year)` / `toYear(s)` for placing everything in 3D. `blendScales(a, b, u)` gives the in-between scales for the 500ms ease-out animation.

`src/lib/viewStack.ts` holds the breadcrumb, a stack of steps starting at the full river:
- **Expanding a cluster** pushes a period from its first to last event with 5% padding each side, anchored on the first event. Expanding inside a period pushes another.
- **Choosing a level** from the scale bar: Full river resets the stack; Period goes back to the innermost period; Years/Months/Weeks/Days replace any unit step on top. The anchor is the selected event's date if there is one, otherwise the start of the current unit (`unitStart`).
- **Going back** (a breadcrumb step, Collapse) keeps the camera at the same moment. **Continue** slides the top window by its own length and moves the camera by the same amount.

`src/lib/cameraAnchor.ts` animates the camera between levels:
- **No jumps:** the first frame is exactly where the camera already was; each frame the anchor moment slides towards its target and the distance between camera and anchor shrinks to nothing.
- **Sideways:** the river's wiggle depends only on the year. The camera and the point it looks at carry small sideways corrections (`latC`, `latL`) from where they started, which ease to zero, so the camera ends centred on the river at its anchor.
- **Tested:** cluster expansion lands on the first event; scale-bar levels land on their anchors; nested expand and collapse end at the right moment; Continue shifts by exactly the window's length.

## Links between events
**EventLink** — `{ id, from, to, type, note?, sources[], origin, claimantId?, wellSourced, agree, demo? }` in `Dataset.links`. Read it as *FROM type TO*:

| type | meaning |
|---|---|
| `caused` | the first caused the second |
| `led_to` | the first came before and helped bring about the second (weaker than caused) |
| `part_of` | the first is part of the second |
| `response_to` | the first happened in response to the second |

Links are claims in their own right. Their **strength** (0–1, `src/lib/related.ts → linkStrength`, with an Explain breakdown) is:
- a starting value by `origin`: curated 0.75, Wikidata 0.7, community 0.5;
- plus 0.05 per source, up to 0.15;
- times the same capped "well sourced" vote factor used for evidence.

"Agree" votes are opinion and never change it.

In data files a link is written inside the event it starts from: `"links": [{ "to": "wd_Q123", "type": "part_of", "note": "…", "sources": ["…"] }]`. The loader gives it the id `from>type>to`. The Wikidata importer writes these from P361 *part of*, P828/P1478 *has (immediate) cause*, P1542/P1536 *has effect / immediate cause of* and P155/P156 *follows / followed by*, and only between events it imported.

## Topic rivers
`src/lib/related.ts`. An anchor event's **topic river** is the anchor plus the events related enough to it, in date order.
- **The graph:** events are joined by links (both directions) and by **shared entities** — the people and organisations involved in both events' debates (claimants, authors, institutions, funders). Shared entities are a loose connection: 0.15 each, capped at 0.35.
- **Scoring:** a path's score is the product of its step strengths, × 0.75 for each hop after the first.
- **Relevance slider (0–1):** sets the weakest score shown (0.6 down to 0.1) and the number of hops walked (1, 2 or 3).
- **Branch points:** a stop that has related events *not* on the current river is a branch point (another topic river crosses there).

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
