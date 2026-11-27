// Search box for events, people/organisations and claims, with field filters.
// Results update as you type (src/lib/search.ts). Picking one flies the river there,
// zooms to a suitable level and highlights it (App.tsx does the flying).
// On phones it's a 🔍 button that opens a full-width panel.
// Keyboard: ↑/↓ to move through results, Enter to pick, Esc to close.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset, Field } from '../types';
import { FIELDS } from '../types';
import { FIELD_COLOR } from '../lib/time';
import { search, type SearchResult } from '../lib/search';

interface Props {
  data: Dataset;
  mobile: boolean;
  onPick: (r: SearchResult) => void;
}

const KIND_ICON: Record<SearchResult['kind'], string> = { event: '●', entity: '◆', claim: '❝' };

export function SearchBar({ data, mobile, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [fields, setFields] = useState<Field[]>([]); // empty = all fields
  const [open, setOpen] = useState(false); // results list (desktop) / whole panel (mobile)
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => search(data, query, { fields }), [data, query, fields]);
  useEffect(() => setActive(0), [query, fields]);

  const toggleField = (f: Field) => setFields((fs) => (fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]));
  const pick = (r: SearchResult) => {
    onPick(r);
    setOpen(false);
    input.current?.blur();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && results[active]) pick(results[active]);
    if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  };

  // On phones, start as a single button.
  if (mobile && !open) {
    return <button className="search-toggle" onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0); }} aria-label="Search">🔍</button>;
  }

  const showList = open && query.trim().length > 0;
  return (
    <div className={`search ${mobile ? 'mobile' : ''}`} role="search">
      <div className="search-row">
        <span className="search-icon" aria-hidden>🔍</span>
        <input
          ref={input}
          type="search"
          value={query}
          placeholder="Search events, people, claims…"
          aria-label="Search events, people and claims"
          aria-expanded={showList}
          aria-controls="search-results"
          aria-activedescendant={showList && results[active] ? `sr-${active}` : undefined}
          role="combobox"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => !mobile && setTimeout(() => setOpen(false), 150) /* let a click on a result land first */}
          onKeyDown={onKey}
        />
        {mobile && <button className="search-close" onClick={() => setOpen(false)} aria-label="Close search">✕</button>}
      </div>
      {(open || mobile) && (
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
      {showList && (
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
      )}
    </div>
  );
}
