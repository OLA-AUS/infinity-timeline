// The side panel for a personal event's mind map (ClaimMap.tsx shows it when the event in the
// middle comes from one of your spaces). From here you can:
//   • Story mode — type a memory, with who told it and when
//   • Link it to world history ("Grandad enlists" —part of→ "World War II begins"), using the
//     same typed links as public events; the link only exists on this device
//   • Propose a different date ("Uncle Ray says 1962") and add evidence for or against —
//     the same rules as public date disputes: evidence decides, agreeing never does
//   • Add sources, edit or remove the event (removing archives it; history keeps every version)
import { useMemo, useState } from 'react';
import type { Dataset, LinkType, TimelineEvent } from '../types';
import { LINK_TYPES } from '../types';
import { formatDate } from '../lib/dates';
import { parseDateText } from '../lib/dateInput';
import { LINK_WORDS } from '../lib/related';
import { search } from '../lib/search';
import { archive, newId, parsePid, upsert, type PersonalSpace } from '../lib/personal';
import { AddSource, DateField } from './SpacesPanel';

const now = () => new Date().toISOString();

/** What the map needs to let you edit personal events (App.tsx owns the spaces). */
export interface PersonalControls {
  spaces: PersonalSpace[];
  onUpdate: (spaceId: string, change: (s: PersonalSpace) => PersonalSpace) => void;
}

interface Props {
  data: Dataset;
  event: TimelineEvent; // the river-wide personal event
  personal: PersonalControls;
  onOpenStory: (storyId: string) => void;
}

export function PersonalEventPanel({ data, event, personal, onOpenStory }: Props) {
  const where = parsePid(event.id)!;
  const space = personal.spaces.find((s) => s.id === where.spaceId);
  const local = space?.events.find((e) => e.id === where.localId);
  if (!space || !local) return null;
  const update = (fn: (s: PersonalSpace) => PersonalSpace) => personal.onUpdate(space.id, fn);
  const people = space.people.filter((p) => !p.archived);
  const sources = space.sources.filter((s) => !s.archived);
  const stories = (data.stories ?? []).filter((s) => s.eventId === event.id).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const proposals = space.proposals.filter((p) => !p.archived && p.eventId === local.id);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Someone';

  return (
    <div className="personal-panel">
      <div className="demo-flag personal">{space.name} · personal · only on this device</div>
      {local.peopleIds.length > 0 && <p className="small">With {local.peopleIds.map(nameOf).join(', ')}</p>}

      <h4>Stories</h4>
      {stories.length === 0 && <p className="muted small">No stories yet. What do people remember about this?</p>}
      {stories.map((s) => (
        <blockquote key={s.id} className="story" onClick={() => onOpenStory(s.id)}>
          “{s.text}”
          <footer>— {s.toldBy}{s.toldOn ? `, ${formatDate(s.toldOn)}` : ''}</footer>
        </blockquote>
      ))}
      <AddStory people={people} onAdd={(st) => update((s) => upsert(s, 'story', { ...st, eventId: local.id }, now(), `Added a story told by ${st.toldBy}`))} />

      <details className="space-section">
        <summary>Link to world history</summary>
        <LinkToWorld data={data} space={space} fromId={local.id} onLink={(to, toWorld, type) => update((s) => upsert(s, 'link', { id: newId('link'), from: local.id, to, toWorld, type, sourceIds: [], wellSourced: { up: 0, down: 0 }, agree: { up: 0, down: 0 } }, now(), `Linked “${local.title}” ${LINK_WORDS[type].out} ${data.events.find((e) => e.id === (toWorld ? to : `p:${space.id}:${to}`))?.title ?? to}`))} />
      </details>

      <details className="space-section">
        <summary>Different dates remembered{proposals.length ? ` (${proposals.length})` : ''}</summary>
        <p className="muted small">
          Recorded date: <b>{formatDate(local.date)}</b>. If someone remembers it differently, add their date. As with public events,
          only evidence (sources for or against) can settle it — agreeing with someone never does.
        </p>
        {proposals.map((p) => (
          <div key={p.id} className="proposal">
            <b>{nameOf(p.claimantId)}</b> says {formatDate(p.date)}{p.note ? ` — ${p.note}` : ''}
            <ul className="small">
              {p.evidence.map((ev) => <li key={ev.id}>{ev.direction === 'for' ? '✔' : '✘'} {sources.find((s) => s.id === ev.sourceId)?.title ?? 'missing source'}{ev.note ? ` — ${ev.note}` : ''}</li>)}
            </ul>
            <AddEvidence sources={sources} onAdd={(sourceId, direction, note) => update((s) => upsert(s, 'proposal', { ...p, evidence: [...p.evidence, { id: newId('evid'), sourceId, direction, note, wellSourced: { up: 0, down: 0 } }] }, now(), `Added evidence ${direction} ${nameOf(p.claimantId)}’s date`))} />
          </div>
        ))}
        <ProposeDate people={people} onAdd={(claimantId, date, note, newPerson) => update((s) => {
          let next = newPerson ? upsert(s, 'person', newPerson, now()) : s;
          next = upsert(next, 'proposal', { id: newId('prop'), eventId: local.id, claimantId, date, note, evidence: [], agree: { up: 0, down: 0 } }, now(), `${newPerson?.name ?? nameOf(claimantId)} proposed ${formatDate(date)}`);
          return next;
        })} />
      </details>

      <details className="space-section">
        <summary>Sources ({local.sourceIds.length})</summary>
        <ul className="small">{local.sourceIds.map((id) => <li key={id}>{sources.find((s) => s.id === id)?.title ?? '(removed)'}</li>)}</ul>
        <select value="" onChange={(e) => e.target.value && update((s) => upsert(s, 'event', { ...local, sourceIds: [...local.sourceIds, e.target.value] }, now(), `Attached a source to “${local.title}”`))} aria-label="Attach an existing source">
          <option value="">Attach a source you’ve added…</option>
          {sources.filter((s) => !local.sourceIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <AddSource compact people={people} onAdd={(src) => update((s) => upsert(upsert(s, 'source', src, now()), 'event', { ...local, sourceIds: [...local.sourceIds, src.id] }, now(), `Attached “${src.title}” to “${local.title}”`))} />
      </details>

      <details className="space-section">
        <summary>Edit or remove</summary>
        <EditEvent key={local.id + space.updatedAt} title={local.title} summary={local.summary} onSave={(title, summary, dateText) => {
          const date = dateText.trim() ? parseDateText(dateText) : local.date;
          if (date) update((s) => upsert(s, 'event', { ...local, title, summary, date }, now()));
        }} />
        <button className="danger" onClick={() => update((s) => archive(s, 'event', local.id, now()))}>Remove from the river (kept in history)</button>
      </details>
    </div>
  );
}

function AddStory({ people, onAdd }: { people: { id: string; name: string }[]; onAdd: (s: { id: string; text: string; toldBy: string; toldById?: string; toldOn?: ReturnType<typeof parseDateText> & object; recordedAt: string }) => void }) {
  const [text, setText] = useState('');
  const [teller, setTeller] = useState('');
  const [when, setWhen] = useState('');
  const person = people.find((p) => p.id === teller);
  const toldOn = when.trim() ? parseDateText(when) : undefined;
  const ok = text.trim() && (person || teller.trim()) && toldOn !== null;
  return (
    <form className="space-form" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      onAdd({ id: newId('story'), text: text.trim(), toldBy: person?.name ?? teller.trim(), ...(person ? { toldById: person.id } : {}), ...(toldOn ? { toldOn } : {}), recordedAt: now() });
      setText(''); setWhen('');
    }}>
      <label className="field"><span>A memory</span><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="He always said he lied about his age to get in…" required /></label>
      <div className="row">
        <input list="story-tellers" value={person?.name ?? teller} onChange={(e) => setTeller(people.find((p) => p.name === e.target.value)?.id ?? e.target.value)} placeholder="Told by" aria-label="Told by" required />
        <datalist id="story-tellers">{people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      </div>
      <DateField label="When it was told" value={when} onChange={setWhen} />
      <button type="submit" className="primary" disabled={!ok}>Save story</button>
    </form>
  );
}

function LinkToWorld({ data, space, fromId, onLink }: { data: Dataset; space: PersonalSpace; fromId: string; onLink: (to: string, toWorld: boolean, type: LinkType) => void }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<LinkType>('part_of');
  // World events, plus other events in this space. Never events from another personal space.
  const results = useMemo(() => search(data, q, { limit: 30 })
    .filter((r) => r.kind === 'event')
    .filter((r) => !r.id.startsWith('p:') || (parsePid(r.id)?.spaceId === space.id && parsePid(r.id)?.localId !== fromId))
    .slice(0, 8), [data, q, space.id, fromId]);
  return (
    <div className="space-form">
      <p className="muted small">The link shows this event in the world event’s topic river — on this device only. Rate it “well sourced” to make it stronger.</p>
      <div className="row">
        <span className="small">This event</span>
        <select value={type} onChange={(e) => setType(e.target.value as LinkType)} aria-label="Link type">
          {LINK_TYPES.map((t) => <option key={t} value={t}>{LINK_WORDS[t].out}</option>)}
        </select>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search world events, e.g. World War II" aria-label="Search events to link to" />
      <ul className="item-list">
        {results.map((r) => {
          const p = parsePid(r.id);
          return (
            <li key={r.id}>
              <span>{r.title} <small>{r.detail}</small></span>
              <button onClick={() => { onLink(p ? p.localId : r.id, !p, type); setQ(''); }}>Link</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProposeDate({ people, onAdd }: { people: { id: string; name: string }[]; onAdd: (claimantId: string, date: NonNullable<ReturnType<typeof parseDateText>>, note: string | undefined, newPerson?: { id: string; name: string }) => void }) {
  const [who, setWho] = useState('');
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const date = parseDateText(when);
  const person = people.find((p) => p.name === who.trim());
  const ok = who.trim() && date;
  return (
    <form className="space-form" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      const fresh = person ? undefined : { id: newId('person'), name: who.trim() };
      onAdd(person?.id ?? fresh!.id, date!, note.trim() || undefined, fresh);
      setWho(''); setWhen(''); setNote('');
    }}>
      <h4>Someone remembers a different date</h4>
      <input list="proposers" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who says so (e.g. Uncle Ray)" aria-label="Who says so" required />
      <datalist id="proposers">{people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      <DateField label="Their date" value={when} onChange={setWhen} required />
      <label className="field"><span>Why (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="It was the year of the big flood" /></label>
      <button type="submit" className="primary" disabled={!ok}>Add their date</button>
    </form>
  );
}

function AddEvidence({ sources, onAdd }: { sources: { id: string; title: string }[]; onAdd: (sourceId: string, direction: 'for' | 'against', note: string) => void }) {
  const [src, setSrc] = useState('');
  const [dir, setDir] = useState<'for' | 'against'>('for');
  const [note, setNote] = useState('');
  if (!sources.length) return <p className="muted small">Add a source (below) to use it as evidence.</p>;
  return (
    <form className="row wrap evidence-form" onSubmit={(e) => { e.preventDefault(); if (src) { onAdd(src, dir, note.trim()); setSrc(''); setNote(''); } }}>
      <select value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Evidence source">
        <option value="">Evidence…</option>
        {sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
      </select>
      <select value={dir} onChange={(e) => setDir(e.target.value as 'for' | 'against')} aria-label="For or against">
        <option value="for">supports it</option>
        <option value="against">contradicts it</option>
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" aria-label="Evidence note" />
      <button type="submit" disabled={!src}>Add</button>
    </form>
  );
}

function EditEvent({ title, summary, onSave }: { title: string; summary: string; onSave: (title: string, summary: string, dateText: string) => void }) {
  const [t, setT] = useState(title);
  const [s, setS] = useState(summary);
  const [d, setD] = useState('');
  return (
    <form className="space-form" onSubmit={(e) => { e.preventDefault(); if (t.trim()) onSave(t.trim(), s.trim(), d); }}>
      <label className="field"><span>Title</span><input value={t} onChange={(e) => setT(e.target.value)} required /></label>
      <DateField label="New date (leave blank to keep it)" value={d} onChange={setD} />
      <label className="field"><span>Notes</span><textarea value={s} onChange={(e) => setS(e.target.value)} rows={2} /></label>
      <button type="submit" className="primary">Save changes</button>
    </form>
  );
}
