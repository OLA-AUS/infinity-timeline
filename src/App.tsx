import { useCallback, useEffect, useState } from 'react';
import { seed } from './data/seed';
import type { Dataset } from './types';
import { FIELDS } from './types';
import { River } from './components/River';
import { ClaimMap, type Focus } from './components/ClaimMap';
import { SourcePanel, type PanelTarget } from './components/SourcePanel';
import { FIELD_COLOR, formatYear, S_MAX, S_MIN, yearToS } from './lib/time';

export default function App() {
  const [data, setData] = useState<Dataset>(seed);
  const [targetS, setTargetS] = useState(yearToS(1900));
  const [year, setYear] = useState(1900);
  const [path, setPath] = useState<Focus[] | null>(null);
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [highlight, setHighlight] = useState<string>();
  const [mobile, setMobile] = useState(window.innerWidth < 760);

  useEffect(() => {
    const r = () => setMobile(window.innerWidth < 760);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  const jumpToEntity = useCallback((id: string) => {
    const e = data.entities.find((x) => x.id === id);
    if (!e) return;
    setPath(null);
    setHighlight(id);
    setTargetS(yearToS(e.foundedAt) - 2);
  }, [data]);

  const openFromChip = useCallback((id: string) => {
    const e = data.events.find((x) => x.id === id);
    if (!e) return;
    setHighlight(id);
    setTargetS(yearToS(e.at) - 2);
    window.setTimeout(() => setPath([{ kind: 'event', id }]), 1100);
  }, [data]);

  // Local demo voting. In production this posts to the API and is logged in the edit history.
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
      />

      <header className="hud">
        <div className="brand">∞ Infinity Timeline <span className="demo-tag">prototype · demo data</span></div>
        <div className="year">{formatYear(year)}</div>
      </header>

      {!path && (
        <footer className="hud-bottom">
          <div className="lanes">
            {FIELDS.map((f) => <span key={f}><i style={{ background: FIELD_COLOR[f] }} />{f}</span>)}
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
        />
      )}

      {panel && (
        <SourcePanel data={data} target={panel} onOpen={setPanel} onJump={(id) => { setPanel(null); jumpToEntity(id); }} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}
