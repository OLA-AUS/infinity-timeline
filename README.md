# Infinity Timeline (working title)

A 3D, community-edited timeline of human history where **every claim shows who made it, where they got it, and who paid for it.**

You fly along a river of time. Hit an event — "WW2 begins" — and dive into its **claim map**: a mind-map of theories, claims, evidence and counter-claims. Click any source, author, institution or funder and you warp to *their* origin point on the timeline. Every node can be scrutinised, voted on, and traced back through its money.

> Transparency is the product. The platform's own funding is on the timeline too.

## Core principles
1. **Follow the money, then follow the evidence.** Funding is context, not a verdict — a claim still stands or falls on evidence.
2. **Earned labels, not imposed ones.** Claim statuses (Established / Contested / Fringe / Disproven / Later confirmed) are derived from weighted evidence, with the maths shown.
3. **Two separate signals.** *"Is this well sourced?"* moves a claim's status. *"Do I agree?"* is public opinion — tracked, graphed and celebrated, but kept separate.
4. **Nothing is deleted.** Every edit, vote and moderation action is versioned and inspectable.
5. **Open everything.** Open-source code, public data dumps, forkable if it's ever captured.

## What's in this repo
| Path | What |
|---|---|
| `docs/VISION.md` | The full idea and how the experience feels |
| `docs/TRUST_MODEL.md` | How sources/evidence are weighted (funding, fines, retractions, track record) |
| `docs/DATA_MODEL.md` | Entities, claims, evidence, funding graph, versions, AI snapshots |
| `docs/GOVERNANCE.md` | Anti-capture rules, moderation, the few hard lines |
| `docs/ROADMAP.md` | Phased plan from prototype to platform |
| `docs/IDEAS.md` | Parking lot of future ideas |
| `CLAUDE.md` | Context for Claude Code when continuing the build |
| `src/` | Working prototype: 3D river, claim map, source/funding panel, trust scoring, opinion-over-time chart, AI snapshots |

## Run the prototype
```bash
npm install
npm run dev      # open the printed localhost URL
npm test         # trust-scoring and status tests
```

Controls: **scroll / drag** to travel through time, **click** a glowing event to open its claim map, click any source to see its trust breakdown and funding chain, and **"Jump on timeline"** to warp to an entity's founding.
On phones the river becomes a vertical "dive" you swipe through.

> ⚠️ All seed data in `src/data/seed.ts` is **demo data**. Sources, organisations, fines and poll numbers are fictional placeholders to show the mechanics — replace with real, cited data.

## Stack
React 18 · TypeScript · Vite · three.js via React Three Fiber + drei · Vitest.
Planned backend: Postgres (graph via adjacency tables) + an append-only event log for versioning. See `docs/ROADMAP.md`.
