import type { Dataset } from '../types';
import { claimStatus, STATUS_COLOR } from '../lib/status';
import { formatYear } from '../lib/time';
import { AISnapshots } from './AISnapshots';

interface Props {
  data: Dataset;
  claimId: string;
  onOpenSource: (id: string) => void;
  onOpenEntity: (id: string) => void;
  onVote: (kind: 'agree' | 'well_sourced', id: string, value: 1 | -1) => void;
}

export function ClaimDetail({ data, claimId, onOpenSource, onOpenEntity, onVote }: Props) {
  const c = data.claims.find((x) => x.id === claimId)!;
  const st = claimStatus(c, data);
  const claimant = data.entities.find((e) => e.id === c.claimantId);
  const agreePct = Math.round((c.agree.up / Math.max(1, c.agree.up + c.agree.down)) * 100);

  return (
    <div className="claim-detail">
      <p className="claim-text">“{c.text}”</p>
      <p className="muted">
        Claimed by <a onClick={() => claimant && onOpenEntity(claimant.id)}>{claimant?.name}</a>
      </p>

      <section className="status-box" style={{ borderColor: STATUS_COLOR[st.status] }}>
        <div className="status-pill" style={{ background: STATUS_COLOR[st.status] }}>{st.status}</div>
        <p>{st.reason}</p>
        <div className="bar">
          <div style={{ width: `${st.ratio * 100}%`, background: '#3ddc97' }} />
          <div style={{ width: `${(1 - st.ratio) * 100}%`, background: '#ff5c6c' }} />
        </div>
        <small>Weighted support {st.support.toFixed(2)} vs opposition {st.oppose.toFixed(2)} — status comes from evidence only.</small>
      </section>

      <section>
        <h4>Evidence — is it well sourced?</h4>
        <table className="ev-table">
          <tbody>
            {st.weights.map((w) => {
              const s = data.sources.find((x) => x.id === w.evidence.sourceId)!;
              return (
                <tr key={w.evidence.id}>
                  <td className={w.evidence.direction}>{w.evidence.direction === 'for' ? '▲' : '▼'}</td>
                  <td>
                    <a onClick={() => onOpenSource(s.id)}>{s.title}</a>
                    {s.conflictOfInterest && <span className="coi"> ⚠ COI</span>}
                    <small>trust {Math.round(w.sourceTrust)} × relevance {w.evidence.relevance} × votes ×{w.voteFactor.toFixed(2)} = <b>{w.weight.toFixed(2)}</b></small>
                  </td>
                  <td className="votes">
                    <button onClick={() => onVote('well_sourced', w.evidence.id, 1)}>👍 {w.evidence.wellSourced.up}</button>
                    <button onClick={() => onVote('well_sourced', w.evidence.id, -1)}>👎 {w.evidence.wellSourced.down}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h4>Public opinion — do you agree?</h4>
        <div className="agree-row">
          <button onClick={() => onVote('agree', c.id, 1)}>Agree {c.agree.up}</button>
          <div className="bar small"><div style={{ width: `${agreePct}%`, background: '#7aa2ff' }} /><div style={{ width: `${100 - agreePct}%`, background: '#39425a' }} /></div>
          <button onClick={() => onVote('agree', c.id, -1)}>Disagree {c.agree.down}</button>
        </div>
        <small className="muted">{agreePct}% agree. Opinion is tracked and graphed, but never changes the status above.</small>
      </section>

      {c.steelman && (
        <section><h4>Strongest version (steelman)</h4><p>{c.steelman}</p></section>
      )}
      {c.falsifiableBy && (
        <section><h4>What would prove it wrong?</h4><p>{c.falsifiableBy}</p></section>
      )}

      {c.statusHistory && (
        <section>
          <h4>How the status has swung</h4>
          <div className="history">
            {[...c.statusHistory, { at: 2026.9, status: st.status }].map((h, i) => (
              <span key={i} style={{ borderColor: STATUS_COLOR[h.status] }}>{formatYear(h.at)} · {h.status}</span>
            ))}
          </div>
        </section>
      )}

      <AISnapshots data={data} claimId={c.id} />
    </div>
  );
}
