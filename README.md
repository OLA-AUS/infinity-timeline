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
| `CONTRIBUTING.md` | How to suggest ideas, edit data through pull requests, and the code style |
| `CLAUDE.md` | Context for Claude Code when continuing the build |
| `src/` | Working prototype: 3D river, claim map, source/funding panel, trust scoring, uncertain & disputed dates, opinion-over-time chart, AI snapshots |
| `data/` | Real data as one JSON file per item — edited through pull requests. Starts with 250 WW2 events imported from Wikidata |
| `scripts/` | Wikidata importer, data validator, date helper |

## Run the prototype
```bash
npm install
npm run dev            # open the printed localhost URL
npm test               # trust, status, dates, layout, importer and data tests
npm run check          # everything CI runs: validate data + tests + production build
```

Controls: **scroll / drag** to travel through time, **click** a glowing event to open its claim map, click any source to see its trust breakdown and funding chain, and **"Jump on timeline"** to warp to an entity's founding.
In the claim map, **drag** to move, **pinch or scroll** to zoom, and tap a bubble to go deeper. On phones the river becomes a vertical "dive" you swipe through, and the map's bubbles and labels are drawn much larger.

**Uncertain dates** glow as a span on the river from the earliest to the latest possible moment, brightest at the best guess. **Disputed dates** glow amber, with a marker for each proposal still standing — try *"When did WW2 actually begin?"*.

> ⚠️ All seed data in `src/data/seed.ts` is **demo data**. Sources, organisations, fines and poll numbers are fictional placeholders to show the mechanics — replace with real, cited data. Real data lives in `data/`.

## Data & editing
Every real item is a small JSON file in `data/`, and every change to it is a pull request: checked automatically (`npm run validate:data`), reviewed by a person, kept in git history forever. Each imported event on the site has a **"Suggest an edit"** link that opens its file in GitHub's editor. See [CONTRIBUTING.md](CONTRIBUTING.md#editing-data).

```bash
npm run import:ww2     # (re-)import WW2 events from Wikidata into data/events/ww2/
npm run date -- 1944-06-06   # print a date block ready to paste into a data file
```

## Deploying
The site is fully static and hosted on **Render** as a static site built from `main`:
- **Build command:** `npm ci && npm run build`
- **Publish directory:** `dist`

Merging a pull request into `main` triggers a Render redeploy. Every pull request is checked first by `.github/workflows/ci.yml` (data validation, tests, build).

For the monthly Wikidata re-import pull requests, tick **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"** in the GitHub repository.

GitHub Pages is an optional alternative (useful for forks): enable **Settings → Pages → Source: GitHub Actions**, then run the **Deploy to GitHub Pages (manual)** workflow from the Actions tab.

## Stack
React 18 · TypeScript · Vite · three.js via React Three Fiber + drei · Vitest · hosted on Render.
For now the data is versioned by git (JSON files + pull requests). Planned backend: Postgres (graph via adjacency tables) + an append-only event log for versioning. See `docs/ROADMAP.md`.
