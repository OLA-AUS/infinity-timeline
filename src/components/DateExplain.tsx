// The "Explain this date" box shown beside an event.
// It says what the date is, how sure we are, how it was worked out, which sources back it,
// and — if the date is disputed — which proposals are still standing and why. It also
// explains the event's "river importance" (what decides if it's shown when zoomed out).
import type { Dataset, FuzzyDate, TimelineEvent } from '../types';
import { formatAt, formatDate, hasWideRange, METHOD_LABEL, PRECISION_LABEL } from '../lib/dates';
import { resolveEventDate } from '../lib/dateDispute';
import { STATUS_COLOR } from '../lib/status';
import { editFileUrl, newIssueUrl, viewFileUrl } from '../config';
import { eventImportance, LOD_THRESHOLD } from '../lib/importance';
import { ZOOM_LEVELS } from '../lib/timeScale';

interface Props {
  data: Dataset;
  event: TimelineEvent;
  onOpenSource: (id: string) => void;
  onOpenTopic: (topicId: string) => void;
}

export function DateExplain({ data, event, onOpenSource, onOpenTopic }: Props) {
  const r = resolveEventDate(event, data);
  const file = event.provenance?.file;

  return (
    <section className={`date-box ${r.disputed ? 'disputed' : ''}`}>
      <h4>When {r.disputed && <span className="pill amber">disputed</span>}</h4>
      <div className="date-main">{formatDate(r.date)}</div>
      <DateFacts date={r.date} data={data} onOpenSource={onOpenSource} />
      <details open={r.contenders.length > 0}>
        <summary>Explain this date</summary>
        <p className="small">{r.reason}</p>
        {r.contenders.length > 0 && (
          <ul className="contenders">
            {r.contenders.map((c) => (
              <li key={c.claim.id}>
                <span className="status-dot" style={{ background: STATUS_COLOR[c.status] }} />
                <b>{formatDate(c.date)}</b> — {c.status}
                <small> (support {c.support.toFixed(2)} vs {c.oppose.toFixed(2)})</small>
              </li>
            ))}
          </ul>
        )}
        {event.provenance?.conflictingValues && (
          <p className="small amber">Wikidata itself lists {event.provenance.conflictingValues.length} different values for this date: {event.provenance.conflictingValues.join(', ')}.</p>
        )}
      </details>
      <div className="date-actions">
        {r.topicId ? (
          <button onClick={() => onOpenTopic(r.topicId!)}>📅 Open the date debate</button>
        ) : (
          <a href={newIssueUrl('date_dispute.yml', `Date dispute: ${event.title}`)} target="_blank" rel="noreferrer">📅 Dispute this date</a>
        )}
        {file && (
          <>
            <a href={editFileUrl(file)} target="_blank" rel="noreferrer">✎ Suggest an edit (pull request)</a>
            <a href={viewFileUrl(file)} target="_blank" rel="noreferrer">History</a>
          </>
        )}
      </div>
      {event.provenance?.importedFrom === 'wikidata' && event.provenance.qid && (
        <p className="small muted">
          Imported from <a href={`https://www.wikidata.org/wiki/${event.provenance.qid}`} target="_blank" rel="noreferrer">Wikidata {event.provenance.qid}</a>
          {event.provenance.retrievedAt && ` on ${event.provenance.retrievedAt}`}
          {event.provenance.manualEdits ? ' and edited by hand since.' : '.'}
        </p>
      )}
      {event.end && <p className="small muted">Ended: {formatDate(event.end)}</p>}
      <ImportanceExplain data={data} event={event} />
    </section>
  );
}

/** Why this event gets a labelled bubble (or only a faint dot) when you zoom out. */
function ImportanceExplain({ data, event }: { data: Dataset; event: TimelineEvent }) {
  const imp = eventImportance(event, data);
  const shownFrom = ZOOM_LEVELS.find((l) => imp.score >= LOD_THRESHOLD[l]) ?? 'year';
  return (
    <details className="importance">
      <summary>River importance: {imp.score}</summary>
      <p className="small muted">
        Decides what's shown when the river is crowded. This event gets its own bubble from the <b>{shownFrom === 'all' ? 'all-time' : shownFrom}</b> zoom level inwards; further out it's a faint dot.
      </p>
      <ul className="factors">
        {imp.factors.map((f, i) => (
          <li key={i}><span>{f.label}</span><b className="pos">+{f.delta}</b></li>
        ))}
      </ul>
    </details>
  );
}

/** Precision, method, range and sources for any FuzzyDate. Reused for proposed dates on claims. */
export function DateFacts({ date, data, onOpenSource }: { date: FuzzyDate; data: Dataset; onOpenSource: (id: string) => void }) {
  return (
    <ul className="date-facts">
      <li>{PRECISION_LABEL[date.precision]}{hasWideRange(date) && <> · range {formatAt(date.earliest, 'day')} – {formatAt(date.latest - 1e-6, 'day')}</>}</li>
      <li>{METHOD_LABEL[date.method]}</li>
      <li>
        Sources:{' '}
        {date.sources.length === 0 ? (
          <span className="muted">none cited yet</span>
        ) : (
          date.sources.map((id) => {
            const s = data.sources.find((x) => x.id === id);
            return <a key={id} onClick={() => onOpenSource(id)}>{s?.title ?? id}</a>;
          })
        )}
      </li>
    </ul>
  );
}
