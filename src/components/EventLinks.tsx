// The links touching an event, shown in the claim map's side panel.
// Each link reads as a sentence ("Indian independence — led to → Suez Crisis"), with its
// strength and an "Explain" breakdown, and two separate votes:
//   • "Well sourced?" — moves the link's strength (and so what appears on topic rivers)
//   • "Agree?"        — public opinion, shown but never used
// Tapping the other event makes it the centre and swaps in its topic river.
import type { Dataset } from '../types';
import { LINK_WORDS, linkStrength, type RelatedEvent } from '../lib/related';
import { LINK_COLOR } from './TopicRiver';

interface Props {
  data: Dataset;
  eventId: string;
  /** Why this event is on the current topic river (empty for the river's start). */
  onRiver?: RelatedEvent;
  onSwitchEvent: (id: string) => void;
  onVoteLink: (id: string, kind: 'agree' | 'well_sourced', value: 1 | -1) => void;
}

export function EventLinks({ data, eventId, onRiver, onSwitchEvent, onVoteLink }: Props) {
  const links = data.links
    .filter((l) => l.from === eventId || l.to === eventId)
    .map((l) => ({ l, s: linkStrength(l) }))
    .sort((a, b) => b.s.score - a.s.score);
  const title = (id: string) => data.events.find((e) => e.id === id)?.title;

  return (
    <section className="event-links">
      {onRiver && onRiver.path.length > 0 && (
        <p className="small why-here">
          <b>Why it’s on this river:</b> {onRiver.path.join(' → ')} <span className="muted">(relevance {onRiver.score.toFixed(2)})</span>
        </p>
      )}
      <h4>Links ({links.length})</h4>
      {links.length === 0 && <p className="muted small">No links yet. Add one in this event’s data file (see CONTRIBUTING.md).</p>}
      <ul className="plain link-list">
        {links.map(({ l, s }) => {
          const outgoing = l.from === eventId;
          const other = outgoing ? l.to : l.from;
          if (!title(other)) return null; // the other end isn't loaded
          return (
            <li key={l.id}>
              <div className="link-line">
                <span className="link-type" style={{ color: LINK_COLOR[l.type] }}>{outgoing ? `${LINK_WORDS[l.type].out} →` : `← ${LINK_WORDS[l.type].in}`}</span>{' '}
                <a onClick={() => onSwitchEvent(other)}>{title(other)}</a>
                {l.demo && <span className="demo-flag">demo</span>}
              </div>
              {l.note && <small className="muted">{l.note}</small>}
              <details>
                <summary>Strength {s.score.toFixed(2)} — explain</summary>
                <ul className="factors">
                  {s.factors.map((f, i) => (
                    <li key={i}><span>{f.label}</span><b className={f.delta < 0 ? 'neg' : 'pos'}>{f.delta > 0 ? '+' : ''}{f.delta}</b></li>
                  ))}
                </ul>
              </details>
              <div className="link-votes">
                <span className="muted">Well sourced?</span>
                <button onClick={() => onVoteLink(l.id, 'well_sourced', 1)} aria-label="Link is well sourced">👍 {l.wellSourced.up}</button>
                <button onClick={() => onVoteLink(l.id, 'well_sourced', -1)} aria-label="Link is not well sourced">👎 {l.wellSourced.down}</button>
                <span className="muted">Agree?</span>
                <button onClick={() => onVoteLink(l.id, 'agree', 1)} aria-label="Agree with this link">✓ {l.agree.up}</button>
                <button onClick={() => onVoteLink(l.id, 'agree', -1)} aria-label="Disagree with this link">✗ {l.agree.down}</button>
              </div>
            </li>
          );
        })}
      </ul>
      <small className="muted">Only “well sourced” votes change a link’s strength; agreeing is opinion and never does.</small>
    </section>
  );
}
