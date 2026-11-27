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

## Layout
- `src/types.ts` — data model types
- `src/data/seed.ts` — demo data
- `src/lib/trust.ts` — trust scoring + funding propagation; `src/lib/status.ts` — claim status
- `src/components/River.tsx` — 3D timeline; `ClaimMap.tsx` — mind map; `SourcePanel.tsx` — provenance; `OpinionChart.tsx`; `AISnapshots.tsx`

## Commands
`npm run dev` · `npm test` · `npm run build`

## Next tasks (Phase 1)
1. Add backend (Postgres + append-only edit log) and API.
2. Voting with separate agree / well-sourced signals.
3. Edit history UI and "view as of date".
4. Wikidata + OpenAlex importers.
