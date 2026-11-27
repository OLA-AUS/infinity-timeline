// The top-level screen. Holds the app's state and wires the pieces together:
//   River (3D timeline)  →  click an event  →  ClaimMap (mind map)  →  SourcePanel (provenance)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { seed } from './data/seed';
import { loadRepoData, mergeDatasets } from './data/repoData';
import type { Dataset } from './types';
import { FIELDS } from './types';
import { River } from './components/River';
import { ClaimMap, type Focus } from './components/ClaimMap';
import { SourcePanel, type PanelTarget } from './components/SourcePanel';
import { FIELD_COLOR, formatYear, S_MAX, S_MIN, yearToS } from './lib/time';
import { resolveEventDate } from './lib/dateDispute';

/** Screens narrower than this get the mobile "dive" layout and bigger map bubbles. */
const MOBILE_WIDTH = 760;

export default function App() {
  // Demo seed + real data files from data/, merged once at start-up.
  const initial = useMemo(() => mergeDatasets(seed, loadRepoData()), []);
  const [data, setData] = useState<Dataset>(initial);
  const [targetS, setTargetS] = useState(yearToS(1900)); // where the camera is heading
  const [year, setYear] = useState(1900); // the year currently in view (for the big HUD number)
  const [path, setPath] = useState<Focus[] | null>(null); // open claim map breadcrumb, or null = river
  const [panel, setPanel] = useState<PanelTarget | null>(null); // open source/entity panel
  const [highlight, setHighlight] = useState<string>(); // event/entity to make glow after a jump
  const [mobile, setMobile] = useState(window.innerWidth < MOBILE_WIDTH);
  const [showImported, setShowImported] = useState(true);
  const importedCount = useMemo(() => data.events.filter((e) => e.provenance?.importedFrom === 'wikidata').length, [data.events]);

  useEffect(() => {
    const r = () => setMobile(window.innerWidth < MOBILE_WIDTH);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  /** Fly to where an entity was born/founded (the "rabbit hole" jump). */
  const jumpToEntity = useCallback((id: string) => {
    const e = data.entities.find((x) => x.id === id);
    if (!e) return;
    setPath(null);
    setHighlight(id);
    setTargetS(yearToS(e.founded.best) - 2);
  }, [data]);

  /** Fly to an event, then open its claim map once the camera arrives. */
  const openFromChip = useCallback((id: string) => {
    const e = data.events.find((x) => x.id === id);
    if (!e) return;
    setHighlight(id);
    setTargetS(yearToS(resolveEventDate(e, data).date.best) - 2);
    window.setTimeout(() => setPath([{ kind: 'event', id }]), 1100);
  }, [data]);

  // Local demo voting. In production this posts to the API and is logged in the edit history.
  // Note the two separate signals: "agree" only touches the claim's opinion counts;
  // "well sourced" touches the evidence, which is what moves a claim's status.
  const vote = useCallback((kind: 'agree' | 'well_sourced', id: string, value: 1 | -1) => {
    setData((d) => {
      const key = value === 1 ? 'up' : 'down';
      if (kind === 'agree') {
        return { ...d, claims: d.claims.map((c) => (c.id === id ? { ...c, agree: { ...c.agree, [key]: c.agree[key] + 1 } } : c)) };
      }
      return { ...d, evidence: d.evidence.map((e) => (e.id === id ? { ...e, wellSourced: { ...e.wellSourced, [key]: e.wellSourced[key] + 10 } } : e)) };
    });
  }, []);

  return (
    <div className="app">
      <River
        data={data}
        targetS={targetS}
        setTargetS={setTargetS}
        onYear={setYear}
        onOpenEvent={(id) => { setPath([{ kind: 'event', id }]); setHighlight(id); }}
        onOpenEntity={(id) => setPanel({ kind: 'entity', id })}
        highlightId={highlight}
        mobile={mobile}
        showImported={showImported}
      />

      <header className="hud">
        <div className="brand">∞ Infinity Timeline <span className="demo-tag">prototype · demo data</span></div>
        <div className="year">{formatYear(year)}</div>
      </header>

      {!path && (
        <footer className="hud-bottom">
          <div className="lanes">
            {FIELDS.map((f) => <span key={f}><i style={{ background: FIELD_COLOR[f] }} />{f}</span>)}
            <span><i className="span-swatch" />uncertain date</span>
            <span><i className="span-swatch disputed" />disputed date</span>
            {importedCount > 0 && (
              <label className="toggle">
                <input type="checkbox" checked={showImported} onChange={(e) => setShowImported(e.target.checked)} />
                {importedCount} Wikidata WW2 events
              </label>
            )}
          </div>
          <input
            className="scrubber"
            type="range"
            min={S_MIN}
            max={S_MAX}
            step={0.5}
            value={targetS}
            onChange={(e) => setTargetS(Number(e.target.value))}
            aria-label="Travel through time"
          />
          <div className="chips">
            <span className="muted">Explore debates:</span>
            {data.events.filter((e) => e.topicIds.length).map((e) => (
              <button key={e.id} onClick={() => openFromChip(e.id)}>{e.title}</button>
            ))}
          </div>
          <p className="help">{mobile ? 'Swipe to dive through time · tap a glowing event' : 'Scroll or drag to travel · click a ringed event to open its debates · ◆ = organisations & people'}</p>
        </footer>
      )}

      {path && (
        <ClaimMap
          data={data}
          path={path}
          setPath={setPath}
          onClose={() => setPath(null)}
          onOpenSource={(id) => setPanel({ kind: 'source', id })}
          onOpenEntity={(id) => setPanel({ kind: 'entity', id })}
          onVote={vote}
          mobile={mobile}
        />
      )}

      {panel && (
        <SourcePanel data={data} target={panel} onOpen={setPanel} onJump={(id) => { setPanel(null); jumpToEntity(id); }} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}
