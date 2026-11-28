// The "My spaces" drawer: personal timelines (Family, Friends, Work, your own) that only live
// in this browser. Create a space, add people, events and sources, import a family tree
// (GEDCOM), show or hide each space's lane, and export / import a space as a file.
//
// All editing goes through the pure functions in src/lib/personal.ts, which keep every
// earlier version in the space's history. Nothing here uploads anything.
import { useMemo, useState, type ReactNode } from 'react';
import type { FuzzyDate, SourceType } from '../types';
import { formatDate } from '../lib/dates';
import { parseDateText } from '../lib/dateInput';
import { importGedcom } from '../lib/gedcom';
import {
  addMany,
  archive,
  createSpace,
  exportFileName,
  exportSpace,
  importSpace,
  newId,
  pid,
  SPACE_KIND_LABEL,
  SPACE_KINDS,
  updateSpace,
  upsert,
  type PersonalSpace,
  type SpaceKind,
} from '../lib/personal';

const now = () => new Date().toISOString();

/** Source types people are likely to have at home, in plain words. */
export const PERSONAL_SOURCE_TYPES: { type: SourceType; label: string }[] = [
  { type: 'primary_document', label: 'Certificate, letter, record or photo' },
  { type: 'book', label: 'Book or written family history' },
  { type: 'journalism', label: 'Newspaper or magazine' },
  { type: 'reference_work', label: 'Family-tree website or index' },
  { type: 'social_post', label: 'Social media post' },
];

interface Props {
  spaces: PersonalSpace[];
  storageError: string | null;
  onAdd: (space: PersonalSpace) => void;
  onUpdate: (id: string, change: (s: PersonalSpace) => PersonalSpace) => void;
  onRemove: (id: string) => void;
  /** Fly to an event on the river (river-wide id). */
  onShowEvent: (eventId: string) => void;
  /** Slide the camera over to a space's lane. */
  onGoToLane: (spaceId: string) => void;
  onClose: () => void;
}

export function SpacesPanel({ spaces, storageError, onAdd, onUpdate, onRemove, onShowEvent, onGoToLane, onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = spaces.find((s) => s.id === openId);
  return (
    <div className="panel spaces-panel" role="dialog" aria-label="My spaces">
      <button className="close" onClick={onClose} aria-label="Close">✕</button>
      {open ? (
        <SpaceDetail space={open} onBack={() => setOpenId(null)} onUpdate={(fn) => onUpdate(open.id, fn)} onRemove={() => { onRemove(open.id); setOpenId(null); }} onShowEvent={onShowEvent} onGoToLane={() => onGoToLane(open.id)} />
      ) : (
        <SpaceList spaces={spaces} onAdd={onAdd} onOpen={setOpenId} onUpdate={onUpdate} onGoToLane={onGoToLane} />
      )}
      <p className="privacy-note">
        🔒 Stored only in this browser, on this device. Nothing is uploaded — no account, no analytics. Export a
        space to keep a backup or move it to another device.
      </p>
      {storageError && <p className="form-error">{storageError}</p>}
    </div>
  );
}

function SpaceList({ spaces, onAdd, onOpen, onUpdate, onGoToLane }: {
  spaces: PersonalSpace[];
  onAdd: (s: PersonalSpace) => void;
  onOpen: (id: string) => void;
  onUpdate: Props['onUpdate'];
  onGoToLane: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SpaceKind>('family');
  const [error, setError] = useState<string | null>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      onAdd(importSpace(await file.text(), spaces, now()));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="kicker">Personal spaces · only on this device</div>
      <h3>My spaces</h3>
      <p className="muted small">Each space is its own lane beside the main river. Its events cluster, expand and link to world history like any other.</p>
      {spaces.length === 0 && <p className="muted">No spaces yet — make one below.</p>}
      <ul className="space-list">
        {spaces.map((s) => (
          <li key={s.id}>
            <i className="space-dot" style={{ background: s.color }} />
            <button className="space-name" onClick={() => onOpen(s.id)}>
              <b>{s.name}</b>
              <small>{SPACE_KIND_LABEL[s.kind]} · {count(s.events, 'event')} · {count(s.people, 'person', 'people')}</small>
            </button>
            <label className="toggle" title="Show this space's lane on the river">
              <input type="checkbox" checked={!s.hidden} onChange={(e) => onUpdate(s.id, (sp) => updateSpace(sp, { hidden: !e.target.checked }, now()))} />
              Show
            </label>
            {!s.hidden && <button onClick={() => onGoToLane(s.id)} title="Slide over to this lane">Go to lane</button>}
          </li>
        ))}
      </ul>

      <form className="space-form" onSubmit={(e) => { e.preventDefault(); onAdd(createSpace(name || SPACE_KIND_LABEL[kind], kind, now(), spaces.map((s) => s.color))); setName(''); }}>
        <h4>New space</h4>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as SpaceKind)} aria-label="Kind of space">
            {SPACE_KINDS.map((k) => <option key={k} value={k}>{SPACE_KIND_LABEL[k]}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'custom' ? 'Name, e.g. “Football club”' : SPACE_KIND_LABEL[kind]} aria-label="Space name" />
          <button type="submit" className="primary">Create</button>
        </div>
      </form>

      <div className="space-form">
        <h4>Import a space from a file</h4>
        <input type="file" accept=".json,application/json" onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} aria-label="Space file to import" />
        {error && <p className="form-error">{error}</p>}
      </div>
    </>
  );
}

const count = (xs: { archived?: boolean }[], one: string, many = `${one}s`) => {
  const n = xs.filter((x) => !x.archived).length;
  return `${n} ${n === 1 ? one : many}`;
};

/** Text box for a date, with a live preview of how it will be read. */
export function DateField({ label, value, onChange, required = false }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  const parsed = value.trim() ? parseDateText(value) : null;
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="1962 · May 1962 · around 1920 · 1918..1922" required={required} />
      <small className={value.trim() && !parsed ? 'form-error' : 'muted'}>
        {!value.trim() ? (required ? 'Exact or fuzzy — vague dates glow as a span.' : 'Optional.') : parsed ? `Reads as ${formatDate(parsed)}${parsed.latest - parsed.earliest > 1.01 ? ' · glows as a span' : ''}` : 'Can’t read that — try 1962, May 1962, around 1920 or 1918..1922.'}
      </small>
    </label>
  );
}

function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="space-section" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function SpaceDetail({ space, onBack, onUpdate, onRemove, onShowEvent, onGoToLane }: {
  space: PersonalSpace;
  onBack: () => void;
  onUpdate: (fn: (s: PersonalSpace) => PersonalSpace) => void;
  onRemove: () => void;
  onShowEvent: (eventId: string) => void;
  onGoToLane: () => void;
}) {
  const people = space.people.filter((p) => !p.archived);
  const events = useMemo(() => space.events.filter((e) => !e.archived).sort((a, b) => a.date.best - b.date.best), [space.events]);
  const sources = space.sources.filter((s) => !s.archived);
  const [message, setMessage] = useState<string | null>(null);

  const download = () => {
    const blob = new Blob([exportSpace(space, now())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = exportFileName(space);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const gedcom = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = importGedcom(await file.text(), new Date().getFullYear());
      onUpdate((s) => addMany(s, { person: r.people, event: r.events, source: r.sources }, now(), `Imported ${file.name}: ${r.people.length} people, ${r.events.length} events, ${r.sources.length} source(s)`));
      const living = r.people.filter((p) => p.living).length;
      const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
      setMessage(`Imported ${n(r.people.length, 'person', 'people')}, ${n(r.events.length, 'event', 'events')} and ${n(r.sources.length, 'source', 'sources')}.${living ? ` ${living} may be living — they stay private.` : ''}${r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).join(' ')}${r.skipped.length > 3 ? ' …' : ''}` : ''}`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const del = () => {
    const ok = window.confirm(`Permanently delete “${space.name}” from this device? This can’t be undone. Export it first if you want a copy.`);
    if (ok) onRemove();
  };

  return (
    <>
      <button className="back" onClick={onBack}>← All spaces</button>
      <div className="kicker"><i className="space-dot" style={{ background: space.color }} /> {SPACE_KIND_LABEL[space.kind]} · only on this device</div>
      <h3>{space.name}</h3>
      <div className="row wrap">
        <label className="toggle"><input type="checkbox" checked={!space.hidden} onChange={(e) => onUpdate((s) => updateSpace(s, { hidden: !e.target.checked }, now()))} /> Show lane</label>
        {!space.hidden && <button onClick={onGoToLane}>Go to lane</button>}
        <button onClick={download}>Export file</button>
      </div>
      {message && <p className="form-note">{message}</p>}

      <Section title={`Events (${events.length})`} open>
        <AddEvent space={space} onUpdate={onUpdate} onAdded={(id) => !space.hidden && onShowEvent(pid(space.id, id))} />
        <ul className="item-list">
          {events.map((e) => (
            <li key={e.id}>
              <span><small>{formatDate(e.date)}</small> {e.title}</span>
              {!space.hidden && <button onClick={() => onShowEvent(pid(space.id, e.id))}>Show</button>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`People (${people.length})`}>
        <AddPerson onAdd={(p) => onUpdate((s) => upsert(s, 'person', p, now()))} />
        <ul className="item-list">
          {people.map((p) => (
            <li key={p.id}>
              <span>{p.name} {p.born && <small>b. {formatDate(p.born)}</small>} {p.died && <small>d. {formatDate(p.died)}</small>} {p.living && <small className="living">living · private</small>}</span>
              <button onClick={() => onUpdate((s) => archive(s, 'person', p.id, now()))} aria-label={`Remove ${p.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Sources (${sources.length})`}>
        <AddSource people={people} onAdd={(src) => onUpdate((s) => upsert(s, 'source', src, now()))} />
        <ul className="item-list">
          {sources.map((s) => (
            <li key={s.id}>
              <span>{s.title} <small>{PERSONAL_SOURCE_TYPES.find((t) => t.type === s.type)?.label ?? s.type}{s.year ? ` · ${s.year}` : ''}</small></span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Import a family tree (GEDCOM)">
        <p className="muted small">A .ged file from Ancestry, FamilySearch, MyHeritage, Gramps and others. Births, marriages and deaths become events; everyone becomes a person. It stays on this device.</p>
        <input type="file" accept=".ged,.gedcom,text/plain" onChange={(e) => { void gedcom(e.target.files?.[0]); e.target.value = ''; }} aria-label="GEDCOM file to import" />
      </Section>

      <Section title={`History (${space.log.length} changes)`}>
        <p className="muted small">Every change is kept, with the version before it. Removing something archives it.</p>
        <ol className="history">
          {[...space.log].reverse().slice(0, 30).map((l, i) => (
            <li key={i}><small>{new Date(l.at).toLocaleString()}</small> {l.summary}</li>
          ))}
        </ol>
      </Section>

      <button className="danger" onClick={del}>Delete this space from this device…</button>
    </>
  );
}

function AddEvent({ space, onUpdate, onAdded }: { space: PersonalSpace; onUpdate: (fn: (s: PersonalSpace) => PersonalSpace) => void; onAdded: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [summary, setSummary] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [newPerson, setNewPerson] = useState('');
  const people = space.people.filter((p) => !p.archived);
  const date = parseDateText(when);

  const submit = () => {
    if (!title.trim() || !date) return;
    const id = newId('event');
    const added = newPerson.trim() ? { id: newId('person'), name: newPerson.trim() } : null;
    onUpdate((s) => {
      let next = added ? upsert(s, 'person', added, now()) : s;
      next = upsert(next, 'event', { id, title: title.trim(), date, summary: summary.trim(), peopleIds: [...who, ...(added ? [added.id] : [])], sourceIds: [] }, now());
      return next;
    });
    setTitle(''); setWhen(''); setSummary(''); setWho([]); setNewPerson('');
    onAdded(id);
  };

  return (
    <form className="space-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h4>Add an event</h4>
      <label className="field"><span>What happened</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Grandad enlists" required /></label>
      <DateField label="When" value={when} onChange={setWhen} required />
      <fieldset className="field">
        <legend>Who was there</legend>
        <div className="chip-picks">
          {people.map((p) => (
            <label key={p.id} className="toggle"><input type="checkbox" checked={who.includes(p.id)} onChange={(e) => setWho((w) => (e.target.checked ? [...w, p.id] : w.filter((x) => x !== p.id)))} />{p.name}</label>
          ))}
        </div>
        <input value={newPerson} onChange={(e) => setNewPerson(e.target.value)} placeholder="Someone new (name)" aria-label="New person" />
      </fieldset>
      <label className="field"><span>Notes</span><textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} /></label>
      <button type="submit" className="primary" disabled={!title.trim() || !date}>Add event</button>
    </form>
  );
}

function AddPerson({ onAdd }: { onAdd: (p: { id: string; name: string; born?: FuzzyDate; died?: FuzzyDate; living?: boolean }) => void }) {
  const [name, setName] = useState('');
  const [born, setBorn] = useState('');
  const [died, setDied] = useState('');
  const [living, setLiving] = useState(false);
  const b = born.trim() ? parseDateText(born) : undefined;
  const d = died.trim() ? parseDateText(died) : undefined;
  const ok = !!name.trim() && b !== null && d !== null;
  return (
    <form className="space-form" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      onAdd({ id: newId('person'), name: name.trim(), ...(b ? { born: b } : {}), ...(d ? { died: d } : {}), living: living && !d });
      setName(''); setBorn(''); setDied(''); setLiving(false);
    }}>
      <h4>Add a person</h4>
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Uncle Ray" required /></label>
      <DateField label="Born" value={born} onChange={setBorn} />
      <DateField label="Died" value={died} onChange={setDied} />
      <label className="toggle"><input type="checkbox" checked={living} onChange={(e) => setLiving(e.target.checked)} disabled={!!d} /> Still living (always kept private)</label>
      <button type="submit" className="primary" disabled={!ok}>Add person</button>
    </form>
  );
}

export function AddSource({ people, onAdd, compact = false }: { people: { id: string; name: string }[]; onAdd: (s: { id: string; title: string; type: SourceType; year?: number; authorId?: string; note?: string }) => void; compact?: boolean }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<SourceType>('primary_document');
  const [year, setYear] = useState('');
  const [author, setAuthor] = useState('');
  const [note, setNote] = useState('');
  const y = Number(year);
  return (
    <form className="space-form" onSubmit={(e) => {
      e.preventDefault();
      if (!title.trim()) return;
      onAdd({ id: newId('src'), title: title.trim(), type, ...(year && Number.isFinite(y) ? { year: y } : {}), ...(author ? { authorId: author } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      setTitle(''); setYear(''); setAuthor(''); setNote('');
    }}>
      {!compact && <h4>Add a source</h4>}
      <label className="field"><span>Source</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Marriage certificate" required /></label>
      <div className="row">
        <select value={type} onChange={(e) => setType(e.target.value as SourceType)} aria-label="Kind of source">
          {PERSONAL_SOURCE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
        <input value={year} onChange={(e) => setYear(e.target.value.replace(/[^\d-]/g, ''))} placeholder="Year" aria-label="Year of the source" inputMode="numeric" style={{ width: 80 }} />
      </div>
      {!compact && (
        <>
          <select value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Written or kept by">
            <option value="">Written or kept by… (optional)</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="field"><span>Notes</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where it is kept, what it says" /></label>
        </>
      )}
      <button type="submit" className="primary" disabled={!title.trim()}>Add source</button>
    </form>
  );
}
