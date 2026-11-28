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
| `docs/PERSONAL_SPACES.md` | Personal spaces (Family / Friends / Work): on-device storage today, and the plan for encrypted sync, invites, consent rules and paid media |
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

Controls:
- **Scroll / drag** to travel through time.
- **Click** a glowing event to select it. Its menu opens the claim map; with it selected, a scale-bar level expands time around it.
- **Click any source** to see its trust breakdown and funding chain.
- **"Jump on timeline"** warps to an entity's founding.

In the claim map, **drag** to move, **pinch or Ctrl+scroll** to zoom, and tap a bubble to go deeper. On phones the river becomes a vertical "dive" you swipe through, and the map's bubbles and labels are drawn much larger.

**Uncertain dates** glow as a span on the river from the earliest to the latest possible moment, brightest at the best guess. **Disputed dates** glow amber, with a marker for each proposal still standing — try *"When did WW2 actually begin?"*.

**Time scale.** Under the big date (top right) is a scale bar: **Full river · Period · Years · Months · Weeks · Days**, with the current level highlighted. The big date always shows the time where the camera is.
- **Choosing a level:** click it (or press **+** / **−**). Years shows a decade, Months a year, Weeks a quarter, Days a month, as an evenly spaced stretch of river with ticks. The rest of history stays visible but squeezed.
- **Where you land:** on the selected event's date if one is selected. Otherwise at the start of the current unit: Years → 1 Jan of the year shown, Months → the 1st of the month shown, Weeks → that week's Monday, Days → the first day of the current month (or period, if it's short).
- **Period** is greyed out until you expand a cluster of events (below); it then takes you back to that period.
- **Nothing jumps:** every change animates over about half a second and ends exactly on its anchor (`src/lib/cameraAnchor.ts`).
- **Overview:** a bar above the slider shows where the expanded stretch sits in all of history.

**Crowded spots.** Every event has its own bubble.
- **Overlapping bubbles:** clicking where several overlap **fans them out in a labelled ring**, sorted by date clockwise from the top, and dims everything else. Pick any one, or click the dimmed scene to close it.
- **Expanding a cluster:** the floating **Expand these N events · May 1939 – Jun 1943** button above the ring spreads exactly that span (plus about 5% each side) evenly along the river and puts the camera on the first event. Clusters inside it can be expanded again.
- **Breadcrumb:** each expansion adds a step (**Full river › May 1939 – Jun 1943 › …**); click a step to go back to it.
- **Edges of a period:** everything outside fades and loses its labels. Each edge has an end cap (*End of period · Jun 1943*) with **Continue →** (slide the period on by its own length) and **Collapse**.
- **Hover (desktop):** bubbles under the cursor swell up and show their labels.
- **Importance:** each event has an explainable score (debates, links, cited sources, and for Wikidata imports how many Wikipedias cover it). On the normal river, less important events are faint dots until you expand time around them.

**Search** (the 🔍 button on phones) matches events, people/organisations and claims as you type, with field filters. Picking a result flies there, expands time as far as the date's precision deserves, and highlights it. Everything you can tap on a phone is at least 44px.

**Topic rivers.** Opening a claim map hides the main river and shows a single *topic river* behind the map, holding only the events related to the one in the middle.
- **What counts as related:** typed links between events (*caused*, *led to*, *part of*, *response to*), people and organisations shared by their debates, and relations imported from Wikidata.
- **Relevance slider:** widens the river from direct links only to looser connections.
- **Gliding:** scroll, or drag the strip at the bottom of the map, to glide along the river. The map's centre switches to the nearest event with a soft fade.
- **Switching rivers:** tap a linked-event bubble to make it the centre and swap in its own topic river. Where another topic river crosses there's a **⑂ branch point** you can switch onto.
- **Trail:** the breadcrumb shows each event you've moved through (*WW2 begins → Operation Sea Lion ⑂ Bengal famine ↪ WW2 ends*).
- **Getting back:** **Back to main river** lands you on the main river at the event you were on.
- **Voting on links:** links are voted on like claims. "Well sourced" changes a link's strength; "agree" is opinion only. Try the demo chain: *WW2 begins → Battle of Britain → Bengal famine → WW2 ends → Indian independence → Suez Crisis*.

**Personal spaces.** **🔒 My spaces** (top left) makes private timelines, such as Family, Friends, Work or your own. They're stored **only in this browser**: no server, no account, no analytics. See [docs/PERSONAL_SPACES.md](docs/PERSONAL_SPACES.md).
- **Lanes:** each space is its own lane beside the main river, with a toggle to show or hide it. On phones, tap its chip in the legend to slide over to it.
- **Behaves like any event:** personal events cluster, fan out, expand and follow the scale bar like public ones.
- **Dates:** type them the way you'd say them (*around 1920*, *May 1962*, *Christmas 2019*); vague ones glow as spans.
- **Disputed dates:** when two people remember different dates (*Uncle Ray says 1962, Mum says 1964*), each is a proposal that only evidence can settle, exactly as on public events.
- **Links to world history:** link a personal event to a world event (*Grandad enlists → part of → World War II begins*), and it appears in that event's topic river. Only on your device.
- **Mind maps:** open a personal event to see its people, stories and sources, and glide along the life of anyone in it.
- **Story mode:** keep memories, with who told them and when.
- **Import and export:** import a family tree from a GEDCOM file, and export or import a space as a file.

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
