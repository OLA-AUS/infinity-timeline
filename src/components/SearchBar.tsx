// The search dock along the bottom of the screen.
//
// Closed, it's a single bordered bar ("Search events, people, claims…") so the river gets
// as much room as possible. Tapping it opens a panel upwards:
//   • before you type — "what's hot": the busiest debates, contested claims and disputed
//     dates (src/lib/trending.ts), plus a one-line reminder of how to get around
//   • once you type   — results as you type (src/lib/search.ts), with field filters
// Picking anything flies the river there (App.tsx does the flying) and closes the panel.
// Keyboard: "/" opens it, ↑/↓ move through results, Enter picks, Esc closes.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset, Field } from '../types';
import { FIELDS } from '../types';
import { FIELD_COLOR } from '../lib/time';
import { search, type SearchResult } from '../lib/search';
import { trending } from '../lib/trending';

interface Props {
  data: Dataset;
  mobile: boolean;
  onPick: (r: SearchResult) => void;
  /** Open an event's claim map (used by the "what's hot" lists). */
  onOpenEvent: (eventId: string) => void;
  /** Open a claim inside its event's map. */
  onOpenClaim: (claimId: string, eventId: string) => void;
  /** A short "how to get around" line, shown in the panel instead of taking space on the river. */
  help: string;
}

const KIND_ICON: Record<SearchResult['kind'], string> = { event: '●', entity: '◆', claim: '❝' };

export function SearchBar({ data, mobile, onPick, onOpenEvent, onOpenClaim, help }: Props) {
  const [query, setQuery] = useState('');
  const [fields, setFields] = useState<Field[]>([]); // empty = all fields
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const results = useMemo(() => search(data, query, { fields }), [data, query, fields]);
  // Only worked out while the panel is open, so it costs nothing the rest of the time.
  const hot = useMemo(() => (open ? trending(data) : null), [open, data]);
  useEffect(() => setActive(0), [query, fields]);

  const close = () => {
    setOpen(false);
    input.current?.blur();
  };

  // "/" opens search from anywhere (unless you're already typing); a tap outside closes it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (dock.current && e.target instanceof Node && !dock.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [open]);

  const toggleField = (f: Field) => setFields((fs) => (fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]));
  const pick = (r: SearchResult) => {
    onPick(r);
    close();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && results[active]) pick(results[active]);
    if (e.key === 'Escape') close();
  };

  const typing = query.trim().length > 0;

  return (
    <div ref={dock} className={`search-dock ${open ? 'open' : ''} ${mobile ? 'mobile' : ''}`} role="search">
      {open && (
        <div className="search-panel">
          {/* Field filters apply to typed searches. */}
          {typing && (
            <div className="search-fields" role="group" aria-label="Only show these fields">
              {FIELDS.map((f) => (
                <button
                  key={f}
                  className={fields.includes(f) ? 'on' : ''}
                  aria-pressed={fields.includes(f)}
                  onMouseDown={(e) => e.preventDefault() /* keep focus in the box */}
                  onClick={() => toggleField(f)}
                >
                  <i style={{ background: FIELD_COLOR[f] }} />{f}
                </button>
              ))}
            </div>
          )}

          {typing ? (
            <ul className="search-results" id="search-results" role="listbox">
              {results.length === 0 && <li className="none">No matches{fields.length ? ' in these fields' : ''}.</li>}
              {results.map((r, i) => (
                <li key={`${r.kind}-${r.id}`} id={`sr-${i}`} role="option" aria-selected={i === active}>
                  <button className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)} onMouseEnter={() => setActive(i)}>
                    <span className="kind" style={{ color: FIELD_COLOR[r.field] }} aria-hidden>{KIND_ICON[r.kind]}</span>
                    <span className="text">
                      <b>{r.title}</b>
                      <small>{r.detail}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            hot && (
              <div className="hot">
                {/* Labelled by what it really is: busiest by votes, not "trending this week". */}
                <HotList title="Hot debates" note="most votes" items={hot.hotDebates.map((d) => ({
                  key: d.eventId,
                  text: d.title,
                  detail: `${d.debates} debate${d.debates === 1 ? '' : 's'} · ${d.votes.toLocaleString()} votes`,
                  onClick: () => { onOpenEvent(d.eventId); close(); },
                }))} />
                <HotList title="Contested claims" note="evidence is split" items={hot.contested.map((c) => ({
                  key: c.claimId,
                  text: c.text,
                  detail: `${c.votes.toLocaleString()} votes`,
                  onClick: () => { onOpenClaim(c.claimId, c.eventId); close(); },
                }))} />
                <HotList title="Disputed dates" items={hot.disputedDates.map((d) => ({
                  key: d.eventId,
                  text: d.title,
                  detail: 'date disputed',
                  onClick: () => { onOpenEvent(d.eventId); close(); },
                }))} />
                <p className="help">{help}</p>
              </div>
            )
          )}
        </div>
      )}

      <div className="search-row">
        <span className="search-icon" aria-hidden>🔍</span>
        <input
          ref={input}
          type="search"
          value={query}
          placeholder="Search events, people, claims…"
          aria-label="Search events, people and claims"
          aria-expanded={open}
          aria-controls="search-results"
          aria-activedescendant={open && typing && results[active] ? `sr-${active}` : undefined}
          role="combobox"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {open && <button className="search-close" onClick={close} aria-label="Close search">✕</button>}
      </div>
    </div>
  );
}

function HotList({ title, note, items }: { title: string; note?: string; items: { key: string; text: string; detail: string; onClick: () => void }[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h4>{title}{note && <small> · {note}</small>}</h4>
      <ul className="hot-list">
        {items.map((it) => (
          <li key={it.key}>
            <button onMouseDown={(e) => e.preventDefault()} onClick={it.onClick}>
              <b>{it.text}</b>
              <small>{it.detail}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
