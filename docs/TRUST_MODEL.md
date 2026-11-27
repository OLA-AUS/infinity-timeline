# Trust Model

Goal: weigh sources and evidence by **who produced them, who paid, and their track record** — and always show the user *why* a score is what it is. No black boxes.

## 1. Entity trust (people, institutions, companies, funders)
Every entity starts at a neutral **baseline (50/100)**. Adjustments:

| Factor | Effect | Notes |
|---|---|---|
| **Penalties** (fines, settlements, sanctions) | − per penalty, scaled by severity (log of amount) and decayed by age | A $3B fraud settlement 2 years ago hurts more than a $50k fine 20 years ago |
| **Retractions** | − per retraction | Strong signal for researchers and journals |
| **Replication record** | + replicated findings, − failed replications | |
| **Undisclosed conflicts** | − large | Discovered after the fact = worse than disclosed |
| **Community "well-sourced" votes on their past evidence** | ± small, reputation-weighted | Capped so mobs can't swing it |
| **Inherited funder trust** | blended in with damping | See §2 |

Penalty severity: `severity = log10(amountUSD + 1) × typeWeight × recencyDecay`
- `typeWeight`: criminal fraud 1.5, civil settlement 1.0, regulatory fine 0.8, warning 0.3
- `recencyDecay = 0.5 ^ (yearsAgo / halfLife)` with `halfLife = 10` years

Scores are clamped to 0–100.

## 2. Funding chain propagation
Trust flows along the funding graph with **damping**:

`effective(entity) = (1 − d) × own(entity) + d × weightedAvg(effective(funders))`

- `d = 0.3` by default (funders matter, but don't fully define you)
- Weighted by share of funding where known; equal weights otherwise
- Depth limit (default 3) and cycle protection
- **Unknown funding is shown as unknown**, and adds a small "opacity" penalty, never silently ignored

## 3. Source trust
A source (paper, article, dataset, video) combines:
- Author(s) effective trust
- Institution effective trust
- Funder(s) effective trust
- Source type quality (peer-reviewed RCT > observational > preprint > op-ed > social post)
- **Conflict of interest flag**: if the funder benefits from the conclusion, apply a penalty and highlight it
- Retracted → score capped at 5

## 4. Evidence weight
Evidence attached to a claim = `sourceTrust × relevance × wellSourcedVoteFactor`.
"Well-sourced" votes are reputation-weighted (per field) and capped.

## 5. Claim status (earned labels)
`support = Σ weight(supporting evidence)`, `oppose = Σ weight(counter evidence)`, `ratio = support / (support + oppose)`

| Status | Rule (initial, tunable) |
|---|---|
| **Established** | ratio ≥ 0.8 and total weight ≥ threshold |
| **Disproven** | ratio ≤ 0.2 and total weight ≥ threshold |
| **Contested** | in between, with enough weight |
| **Fringe** | not enough total weight either way |
| **Later confirmed** | was Fringe/Disproven at some past snapshot, now Established |

Status is recomputed on every change and **snapshotted over time**, so the "swing graph" is automatic.

## 6. Public opinion (separate signal)
Agree/disagree, likes, imported poll results from other platforms (with links). **Never** changes status — it's displayed alongside, graphed over time, and compared with the evidence curve. The gap between "what the evidence says" and "what people believe" is one of the most interesting things the platform can show.

## 7. Safeguards
- Every score has an **"Explain"** breakdown listing each factor and its contribution.
- Weights and formulas are public, versioned and changed only by governance votes (see GOVERNANCE.md).
- Funding is context, not proof: the UI always shows the evidence next to the funding, never funding alone.

Reference implementation: `src/lib/trust.ts`, tests in `src/lib/trust.test.ts`.
