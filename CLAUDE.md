# CLAUDE.md — context for continuing this build

## What this is
A 3D community-edited timeline of human history. Every claim shows who made it, the source, the author, their institution and who funded them, with an explainable trust score. Read `docs/VISION.md` and `docs/TRUST_MODEL.md` first.

## Non-negotiables
- 3D is core (React Three Fiber). Mobile gets its own 3D "dive" interaction, not a flat fallback.
- Transparency: every score must have an "Explain" breakdown. No hidden weights.
- "Well sourced" votes move claim status; "agree" votes are public opinion and never move status.
- Nothing is deleted; everything is versioned.
- Funding is context, not proof — always show evidence next to funding.
- Seed data must be clearly marked as demo until replaced with real cited data. Never invent real-world citations, fines or poll numbers.

- Dates are `FuzzyDate` {earliest, latest, best, precision, method, sources}. Disputed dates go through claims + evidence (`Topic.dateOf`, `Claim.proposedDate`), never votes.
- Real data lives in `data/` as one JSON file per item and changes only via pull requests. Real data must not reference demo seed entities. Imported files edited by hand get `provenance.manualEdits: true`.
- Code style and comment conventions: `CONTRIBUTING.md` (plain-English comments, pure logic in `src/lib` with tests).

## Layout
- `src/types.ts` — data model types
- `src/data/seed.ts` — demo data; `src/data/repoData.ts` — loads `data/**.json` at build time
- `src/lib/trust.ts` — trust scoring + funding propagation; `src/lib/status.ts` — claim status
- `src/lib/dates.ts` — FuzzyDate helpers/formatting; `src/lib/dateDispute.ts` — resolve disputed dates
- `src/lib/forceLayout.ts` — claim map layout (labels off lines); `src/lib/usePanZoom.ts` — drag/pinch/wheel
- `src/components/River.tsx` — 3D timeline (spans, imported-event instancing); `ClaimMap.tsx` — mind map; `DateExplain.tsx`; `SourcePanel.tsx` — provenance; `OpinionChart.tsx`; `AISnapshots.tsx`
- `scripts/` — `import-wikidata-ww2.mjs` (+ `lib/wikidata.mjs`), `validate-data.mjs` (+ `lib/validate.mjs`), `make-date.mjs`
- `.github/workflows/` — `ci.yml` (PRs), `deploy.yml` (Pages), `import-wikidata.yml` (monthly re-import PR)

## Commands
`npm run dev` · `npm test` · `npm run build` · `npm run check` (validate + test + build) · `npm run validate:data` · `npm run import:ww2` · `npm run date -- 1944-06-06`
On Windows Git Bash, set `MSYS_NO_PATHCONV=1` when passing `BASE_PATH=/repo/` to a build, or the path gets mangled.

## Next tasks (Phase 1)
1. Add backend (Postgres + append-only edit log) and API.
2. Voting with separate agree / well-sourced signals.
3. Edit history UI and "view as of date".
4. OpenAlex importer (Wikidata WW2 importer done); topics/claims as data files so date disputes can be opened by PR.
5. Zoom levels on the river — imported WW2 events crowd into ~3 river units at the current log scale.
