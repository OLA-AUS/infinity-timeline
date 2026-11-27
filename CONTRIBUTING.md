# Contributing

Thanks for helping build a timeline of history where every claim shows its sources, its authors and its money. You don't need to be a programmer: fixing a date, citing a source or suggesting an idea all count.

**Contents:** [Ground rules](#ground-rules) · [Suggesting ideas](#suggesting-ideas) · [Reporting problems](#reporting-problems) · [Editing data](#editing-data) · [Working on the code](#working-on-the-code) · [Code style](#code-style) · [Reviews](#how-reviews-work)

---

## Ground rules

These come from the project's core principles ([`docs/VISION.md`](docs/VISION.md), [`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md)). Pull requests that break them won't be merged, however good they are otherwise.

1. **Every score can be explained.** If something produces a number or a label, it also produces the list of reasons ("factors") behind it. No hidden weights.
2. **Evidence and opinion are separate.** "Well sourced" votes can move a claim's status. "Agree" votes are public opinion and never do.
3. **Nothing is deleted.** Data changes go through pull requests, so git keeps every version. Removing something is a visible, explained change.
4. **Funding is context, not proof.** Always show the evidence next to who paid for it — never funding on its own.
5. **Never invent real-world facts.** No made-up citations, fines, quotes or poll numbers. Demo data stays clearly labelled as demo (`demo: true`, `[Demo]` in titles) until it's replaced with real, cited data.
6. **Be kind.** Disagree with claims, not people. No harassment, no doxxing. See [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md).

---

## Suggesting ideas

- Open an issue with the **💡 Suggest an idea** template: [new idea](https://github.com/OLA-AUS/infinity-timeline/issues/new?template=idea.yml).
- Say what problem it solves and who for. A rough sketch or screenshot is worth a thousand words.
- Check [`docs/IDEAS.md`](docs/IDEAS.md) (the parking lot) and open issues first — adding your voice to an existing idea is just as useful.
- Ideas that change **trust weights or status thresholds** are governance changes: they need a public proposal and a comment period ([`docs/GOVERNANCE.md`](docs/GOVERNANCE.md)). An idea issue is the right place to start.

## Reporting problems

Pick the template that fits when you [open an issue](https://github.com/OLA-AUS/infinity-timeline/issues/new/choose):

| Template | Use it when |
|---|---|
| 🐞 **Report a bug** | The site is broken or behaves strangely. Say which device and browser. |
| 📚 **Correct a fact or source** | An event, person, organisation or source is wrong or badly cited. Include a real source. |
| 📅 **Dispute a date** | You think something happened at a different time, or its date is more or less certain than shown. |
| 💡 **Suggest an idea** | Anything new. |

---

## Editing data

All real (non-demo) data lives as small JSON files in [`data/`](data/), one item per file. **Every change is a pull request**: it gets checked automatically, reviewed by a person, and kept in history forever. When it's merged, the live site rebuilds within a few minutes.

```
data/
  events/ww2/Q8641370.json   one event per file (imported ones are named by their Wikidata id)
  entities/e_wikidata.json   people and organisations
  sources/<id>.json          books, papers, archive records — the things dates and claims cite
  schema/                    the rules each kind of file must follow
  import/                    importer settings (e.g. the list of items never to import)
```

### The easy way: edit on GitHub

1. On the site, open an event and click **✎ Suggest an edit (pull request)** — or find the file in [`data/`](data/) on GitHub and click the ✏️ pencil.
2. Make your change in the browser.
3. If you edited an imported file, set `"manualEdits": true` in its `provenance` so the importer never overwrites your fix.
4. Click **Commit changes… → Create a new branch → Propose changes**, then fill in the pull request checklist (especially **Sources**).
5. Automatic checks run. If there's a problem, a red note appears on the exact file explaining what's wrong in plain English.

### Dates

Dates are honest about uncertainty. Each one is a small object:

```json
"date": {
  "earliest": 1436,
  "latest": 1451,
  "best": 1440,
  "precision": "decade",
  "method": "scholarly_estimate",
  "sources": ["some_book_id"]
}
```

| Field | Meaning |
|---|---|
| `best` | The most likely moment. This is where the event sits on the river. |
| `earliest` / `latest` | The honest range. If it's wide, the river draws a **glowing span** instead of a point. |
| `precision` | How finely it's known: `day`, `month`, `year`, `decade`, `century`, `millennium`. |
| `method` | How it was worked out: `documented`, `contemporary_accounts`, `archaeological`, `radiocarbon`, `scholarly_estimate`, `wikidata`, or `community` (not yet sourced). |
| `sources` | Ids of files in `data/sources/` (or `"wikidata:Q123"`). Empty means "nobody has cited this yet" — allowed, but shown as such. |

Years are **decimal years** (1944.43 ≈ 6 June 1944; negative = BCE). You don't need to work these out — the helper does it:

```bash
npm run date -- 1944-06-06                               # known to the day
npm run date -- 1928-09                                  # known to the month
npm run date -- 1436..1451 --best 1440 --method scholarly_estimate
```

It prints a block you can paste straight into a file. Rule of thumb: **`earliest ≤ best ≤ latest`**, always — the checks will tell you if not.

### Disputing a date

Dates can be disputed exactly like claims. Each proposed date becomes a claim with its own evidence; each earns a status (Established / Contested / Fringe / Disproven) from that evidence; and the river follows the result:

- one proposal **Established** → its date is used, the dispute is settled;
- several **Contested** → the glowing span turns amber and stretches to cover all of them, with a marker for each;
- the rest **Fringe/Disproven** → they don't affect the river.

Votes saying "I agree" never settle a date — only evidence does. To start one, use the **📅 Dispute this date** link on the event, or the [date dispute template](https://github.com/OLA-AUS/infinity-timeline/issues/new?template=date_dispute.yml). There's a worked demo on the river: *"When did WW2 actually begin?"* (1 Sep 1939 vs 7 Jul 1937).

### Linking events

Links build the topic rivers you see behind a claim map. Add them inside the event file the link *starts from*:

```json
"links": [
  { "to": "wd_Q154720", "type": "led_to", "note": "One plain sentence on why.", "sources": ["some_book_id"] }
]
```

Read it as *THIS EVENT type OTHER EVENT*. The types are:

| `type` | meaning |
|---|---|
| `caused` | this event caused the other |
| `led_to` | this came first and helped bring the other about (weaker than caused) |
| `part_of` | this event is part of the other |
| `response_to` | this event was a response to the other |

`to` is the other event's id: its file name without `.json`, or `wd_Q…` for imports.

- **Sources:** a link with sources starts stronger.
- **Votes:** on the site, "well sourced" votes make it stronger or weaker, while "agree" votes are just opinion.
- **Strength:** the full rule is in [`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md) §5b.
- **Wikidata:** the importer adds Wikidata's own relations (part of, has cause, followed by…) automatically.

### Adding a source

Create `data/sources/<id>.json` (see [`data/schema/source.schema.json`](data/schema/source.schema.json)). Authors, institution and funders are entity ids in `data/entities/` — add those too if they're new. Unknown funding is fine (`"funderIds": []`); the trust score flags it openly. **Only real, checkable sources.** Real data must never point at demo entities from `src/data/seed.ts`.

### Importing from Wikidata

```bash
npm run import:ww2                    # 250 most notable WW2 events → data/events/ww2/
npm run import:ww2 -- --limit 500     # more
npm run import:ww2 -- --dry-run       # preview, write nothing
```

Re-running is safe: unchanged files stay untouched, files with `"manualEdits": true` are skipped, and nothing is ever deleted. To **remove** an imported item, delete its file *and* add its Q-id with a reason to [`data/import/wikidata-ww2.exclude.txt`](data/import/wikidata-ww2.exclude.txt) in the same pull request. A scheduled workflow re-imports monthly and opens a pull request with any changes, so imported data is reviewed like everything else. Please set `WIKIDATA_USER_AGENT` to something with contact details when you run it yourself ([Wikimedia's policy](https://meta.wikimedia.org/wiki/User-Agent_policy)).

Don't paste text from Wikipedia into summaries (it's under a licence that would need attribution); Wikidata's own short descriptions are public domain and fine.

### Checking your data locally

```bash
npm run validate:data
```

### Conflicts of interest

If you, your employer or your funders have a stake in something you're editing, say so in the pull request. It doesn't stop you contributing — it's shown as context, exactly like every source's funding.

---

## Working on the code

You'll need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm run dev            # start the site locally — open the printed localhost URL
npm test               # run the tests
npm run check          # everything CI runs: data validation + tests + production build
```

Where things live:

| Path | What |
|---|---|
| `src/types.ts` | Every data shape. Start here. |
| `src/lib/` | Pure logic with tests: `trust.ts` (trust scores), `status.ts` (claim status), `dates.ts` + `dateDispute.ts` (uncertain and disputed dates), `forceLayout.ts` (claim map layout), `time.ts` + `timeScale.ts` (where things sit on the river, and time zoom), `importance.ts` + `cluster.ts` (what to show when crowded), `related.ts` (links, relatedness, topic rivers), `search.ts`, `usePanZoom.ts` (drag / pinch / zoom). |
| `src/components/` | React components: `River.tsx` (3D) + `RiverSpans.tsx`, `TimeNav.tsx` (zoom breadcrumb, overview bar), `SearchBar.tsx`, `TopicRiver.tsx` + `TopicStrip.tsx` + `EventLinks.tsx` (topic rivers), `ClaimMap.tsx`, `ClaimDetail.tsx`, `SourcePanel.tsx`, `DateExplain.tsx`, charts. |
| `src/data/seed.ts` | **Demo** data. Fictional except event dates. |
| `src/data/repoData.ts` | Loads the real data in `data/`. |
| `scripts/` | Importers, the data validator, the date helper. Plain Node.js, no build step. |
| `.github/workflows/` | CI for pull requests, monthly Wikidata re-import, optional manual GitHub Pages deploy. |

## Code style

The goal is code a newcomer can read top to bottom.

**Comments**
- Every file starts with a short plain-English comment: what it's for and how it fits in.
- Explain *why*, not *what*. `// Ignore the "click" at the end of a drag` beats `// check flag`.
- Write for someone who knows a bit of programming but not this project, three-dimensional graphics or statistics. Avoid jargon; if you must use a term (e.g. "damping"), say what it means once.
- Exported functions and types get a `/** doc comment */`.

**TypeScript & React**
- TypeScript `strict` mode, no `any` (use `unknown` and narrow it). Prefer `type`-only imports for types.
- Function components and hooks only. Keep state in `App.tsx` unless it's genuinely local.
- Put calculations in `src/lib/` as pure functions (input → output, no side effects) with tests next to them (`thing.ts` → `thing.test.ts`). Components should mostly arrange things on screen.
- Anything that produces a score or label returns its reasons too (see `TrustResult.factors`, `StatusResult.reason`, `ResolvedDate.reason`).
- Mobile is not an afterthought: check anything visual at phone width (the browser dev tools' device mode is fine). Touch targets at least 44 px.

**Formatting**
- 2-space indent, single quotes, semicolons, trailing commas in multi-line lists.
- Lines up to about 140 characters; break long JSX props onto separate lines.
- Names: `camelCase` for values and functions, `PascalCase` for components and types, `SCREAMING_CASE` for constants. Spell words out (`evidenceWeight`, not `evW`).
- Plain-English UI text, British or American spelling both fine — be consistent within a sentence.

**Dependencies**
- Think twice before adding one. Small helpers (a few dozen lines) are usually better written here, with comments and tests. If you do add one, say why in the pull request.

**Commits & pull requests**
- One topic per pull request. Small is beautiful.
- Commit messages in the imperative: "Add date dispute markers to the river", not "added stuff".
- Run `npm run check` before pushing. CI runs the same thing.

## How reviews work

- Every pull request needs one approving review from a maintainer before merging. Data pull requests are checked for sources first and foremost.
- Reviewers explain requested changes in plain language and link the rule they're applying.
- Disagreements about *facts* are settled with evidence (and may become a claim or date dispute on the site). Disagreements about *rules* go through governance.
- Once merged to `main`, the live site (hosted on Render) redeploys automatically.

## Licence

By contributing you agree your code is released under the project's licence (AGPL-3.0-or-later, see `package.json`). Data you add must be yours to give or from a source whose licence allows it (Wikidata is public domain, CC0).
