// "What does AI think?" — saved, timestamped AI answers about a claim: which model,
// the exact prompts, the output, and whether other people got the same answer.
// Over time this becomes a record of how AI answers drift.
import type { Dataset } from '../types';

export function AISnapshots({ data, claimId }: { data: Dataset; claimId: string }) {
  const snaps = data.aiSnapshots.filter((s) => s.claimId === claimId).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  return (
    <section>
      <h4>What does AI think? <small className="muted">(timestamped)</small></h4>
      {snaps.length === 0 && <p className="muted">No AI snapshots yet. Ask a model, paste the full thread, and others can reproduce it.</p>}
      {snaps.map((s) => {
        // Tally how other users' attempts to reproduce this answer went.
        const counts = { match: 0, partial: 0, differs: 0 };
        s.reproductions.forEach((r) => counts[r.result]++);
        return (
          <div key={s.id} className="ai-snap">
            <div className="ai-head">
              <b>{s.provider}</b> · <code>{s.model}</code> · {new Date(s.askedAt).toLocaleString()}
            </div>
            <ol className="prompts">{s.prompts.map((p, i) => <li key={i}>{p}</li>)}</ol>
            <p className="ai-out">{s.output}</p>
            <small>
              Reproduced by users: ✅ {counts.match} match · 〰 {counts.partial} partial · ❌ {counts.differs} differ
            </small>
          </div>
        );
      })}
    </section>
  );
}
