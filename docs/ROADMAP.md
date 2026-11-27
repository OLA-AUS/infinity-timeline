# Roadmap

## Phase 0 — Prototype (this repo) ✅
- 3D river with field lanes and events; mobile "dive" mode
- Claim map (event → topics → claims → evidence / counter-claims)
- Source panel: authors, institution, funders, penalties, trust breakdown
- "Jump on timeline" to any entity's founding
- Trust scoring + earned status labels (tested)
- Opinion-over-time chart with correlated events
- AI snapshot viewer
- Demo seed data only

## Phase 0.5 — Open data workflow ✅
- Uncertain dates (`FuzzyDate`) with glowing spans on the river; dates disputable like claims
- Claim map: force layout (labels never on lines), drag / pinch / scroll zoom, large mobile sizing
- Real data as JSON files in `data/`, edited through pull requests, validated in CI
- Wikidata importer: 250 WW2 events; monthly re-import opens a pull request
- Static site on Render, built from `main` (GitHub Pages available as a manual alternative)
- CONTRIBUTING.md, issue templates (bug, idea, data correction, date dispute), PR template

## Phase 1 — Real data, one field
- Pick a launch field (suggestion: WW2 & its aftermath, or history of medicine)
- Backend: Postgres + append-only edit log + REST/GraphQL API
- Auth (pseudonymous accounts), voting (agree vs well-sourced), edit history UI
- Importers: Wikidata (events/entities), OpenAlex (papers, authors, funders), public enforcement records (penalties)
- ~500 hand-checked entities and claims

## Phase 2 — Community
- Open editing with versioning and "view as of date"
- Reputation per field, brigading detection, vote cluster visualisation
- Public moderation log and appeals
- ✅ Topic rivers: typed, votable event links (+ Wikidata relations), relevance slider, branch points, trail breadcrumb
- Shareable rabbit-hole trails (the trail exists; next: a shareable URL for it)
- AI snapshot submission + reproduction workflow

## Phase 3 — Time & opinion
- Status snapshots → automatic "swing" graphs per claim
- External poll imports with methodology
- Correlation tooling (lagged correlation between opinion series and events) with explicit "correlation ≠ causation" framing and causal-claim templates

## Phase 4 — Scale
- ✅ Expand time in place (normal → months → days) with the chosen moment anchored on screen; overlapping bubbles fan out; hover magnifier; importance-based level of detail; search
- Level-of-detail *streaming* (load data per expanded period) and cosmic-time zoom
- More fields, translations
- Public data dumps, API for researchers
- Governance votes on model weights
