// The slide-in panel for a source or an entity: who wrote/paid for it, its penalties,
// and its trust score with the full "Explain this score" breakdown. Funding is always
// shown as context next to the evidence — never as a verdict on its own.
import type { Dataset } from '../types';
import { effectiveTrust, formatMoney, sourceTrust, type TrustResult } from '../lib/trust';
import { formatShort, formatYear } from '../lib/dates';

export type PanelTarget = { kind: 'source' | 'entity'; id: string };

interface Props {
  data: Dataset;
  target: PanelTarget;
  onOpen: (t: PanelTarget) => void;
  onJump: (entityId: string) => void;
  onClose: () => void;
}

/** Big score number plus the list of factors that produced it. */
function TrustBreakdown({ r }: { r: TrustResult }) {
  // Green / amber / red bands are only a reading aid; the factors below are the real answer.
  const color = r.score >= 45 ? '#3ddc97' : r.score >= 30 ? '#f5b83d' : '#ff5c6c';
  return (
    <section>
      <div className="trust-score" style={{ color }}>{Math.round(r.score)}<small>/100 trust</small></div>
      <details open>
        <summary>Explain this score</summary>
        <ul className="factors">
          {r.factors.map((f, i) => (
            <li key={i}><span>{f.label}</span><b className={f.delta < 0 ? 'neg' : 'pos'}>{f.delta > 0 ? '+' : ''}{f.delta}</b></li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function SourcePanel({ data, target, onOpen, onJump, onClose }: Props) {
  const name = (id: string) => data.entities.find((e) => e.id === id)?.name ?? id;
  const link = (id: string) => <a key={id} onClick={() => onOpen({ kind: 'entity', id })}>{name(id)}</a>;

  // ---- A source: paper, book, document, post ----
  if (target.kind === 'source') {
    const s = data.sources.find((x) => x.id === target.id)!;
    return (
      <div className="panel">
        <button className="close" onClick={onClose}>✕</button>
        <div className="kicker">Source · {s.type.replace('_', ' ')} · {formatYear(s.publishedAt)}</div>
        <h3>{s.title}</h3>
        {s.demo && <div className="demo-flag">Demo placeholder source</div>}
        {s.retracted && <div className="demo-flag red">Retracted</div>}
        {s.conflictOfInterest && <div className="demo-flag amber">⚠ Conflict of interest: {s.conflictOfInterest}</div>}
        <TrustBreakdown r={sourceTrust(s, data)} />
        <section><h4>Authors</h4>{s.authorIds.length ? s.authorIds.map(link) : <span className="muted">Institutional / unattributed</span>}</section>
        {s.institutionId && <section><h4>Institution</h4>{link(s.institutionId)}</section>}
        <section><h4>Funded by</h4>{s.funderIds.length ? s.funderIds.map(link) : <span className="muted">Unknown — flagged</span>}</section>
        {s.url && <section><h4>Link</h4><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></section>}
      </div>
    );
  }

  // ---- An entity: person, institution, company, funder ----
  const e = data.entities.find((x) => x.id === target.id)!;
  const penalties = data.penalties.filter((p) => p.entityId === e.id);
  const fundedBy = data.funding.filter((f) => f.recipientId === e.id);
  const funds = data.funding.filter((f) => f.funderId === e.id);
  const authored = data.sources.filter((s) => s.authorIds.includes(e.id) || s.institutionId === e.id || s.funderIds.includes(e.id));
  const totalFines = penalties.reduce((a, p) => a + p.amountUSD, 0);

  return (
    <div className="panel">
      <button className="close" onClick={onClose}>✕</button>
      <div className="kicker">{e.kind} · {e.field} · founded {formatShort(e.founded)}</div>
      <h3>{e.name}</h3>
      <p className="muted">{e.description}</p>
      {e.demo && <div className="demo-flag">Demo placeholder entity</div>}
      <button className="jump" onClick={() => onJump(e.id)}>⤳ Jump on timeline to {formatYear(e.founded.best)}</button>
      <TrustBreakdown r={effectiveTrust(e.id, data)} />

      {penalties.length > 0 && (
        <section>
          <h4>Penalties: {penalties.length} · ${formatMoney(totalFines)} total</h4>
          <ul className="plain">
            {penalties.map((p) => (
              <li key={p.id}><b>{Math.floor(p.at)}</b> {p.type.replace('_', ' ')} {p.amountUSD ? `$${formatMoney(p.amountUSD)}` : ''} — {p.regulator}. <span className="muted">{p.summary}</span></li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4>Funded by</h4>
        {fundedBy.length ? (
          <ul className="plain">
            {fundedBy.map((f) => (
              <li key={f.funderId}>{link(f.funderId)} {f.share ? `· ${Math.round(f.share * 100)}%` : ''} {!f.disclosed && <span className="coi">⚠ undisclosed</span>}</li>
            ))}
          </ul>
        ) : <span className="muted">No funders recorded</span>}
      </section>
      {funds.length > 0 && (
        <section><h4>Funds</h4><ul className="plain">{funds.map((f) => <li key={f.recipientId}>{link(f.recipientId)}</li>)}</ul></section>
      )}
      {authored.length > 0 && (
        <section><h4>Linked sources</h4><ul className="plain">{authored.map((s) => <li key={s.id}><a onClick={() => onOpen({ kind: 'source', id: s.id })}>{s.title}</a></li>)}</ul></section>
      )}
    </div>
  );
}
