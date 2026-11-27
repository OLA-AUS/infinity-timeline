// The top-level screen. Holds the app's state and wires the pieces together:
//   River (3D timeline)  →  click an event  →  ClaimMap (mind map)  →  SourcePanel (provenance)
// plus the time-zoom controls (TimeNav, OverviewBar) and search (SearchBar).
//
// Zoom state lives here as a "window" (the calendar period zoomed into, or null for all
// time). The river's camera position (`targetS`) is a distance along the river *for the
// current zoom*, so whenever the zoom changes we convert it with the new scale.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { seed } from './data/seed';
import { loadRepoData, mergeDatasets } from './data/repoData';
import type { Dataset, FuzzyDate } from './types';
import { FIELDS } from './types';
import { FOCUS_AHEAD, River } from './components/River';
import { ClaimMap, type Focus } from './components/ClaimMap';
import { SourcePanel, type PanelTarget } from './components/SourcePanel';
import { OverviewBar, TimeNav } from './components/TimeNav';
import { SearchBar } from './components/SearchBar';
import { FIELD_COLOR } from './lib/time';
import { resolveEventDate } from './lib/dateDispute';
import {
  deeper,
  formatForLevel,
  levelForPrecision,
  levelOf,
  makeScale,
  shallower,
  windowFor,
  type TimeWindow,
} from './lib/timeScale';
import type { SearchResult } from './lib/search';

/** Screens narrower than this get the mobile "dive" layout and bigger tap targets. */
const MOBILE_WIDTH = 760;

export default function App() {
  // Demo seed + real data files from data/, merged once at start-up.
  const initial = useMemo(() => mergeDatasets(seed, loadRepoData()), []);
  const [data, setData] = useState<Dataset>(initial);
  const [zoom, setZoom] = useState<TimeWindow | null>(null); // null = all time
  const scale = useMemo(() => makeScale(zoom), [zoom]);
  const level = levelOf(zoom);
  const [targetS, setTargetS] = useState(() => makeScale(null).toS(1900) - 2); // where the camera is heading
  const [year, setYear] = useState(1900); // the moment currently in view (for the HUD)
  const yearRef = useRef(year);
  yearRef.current = year;
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

  /** River distance that puts `y` at the focus point (mid-screen) with scale `sc`. */
  const focusS = useCallback((sc: ReturnType<typeof makeScale>, y: number) => {
    const ahead = mobile ? FOCUS_AHEAD.mobile : FOCUS_AHEAD.desktop;
    return Math.max(sc.sMin - ahead, Math.min(sc.sMax, sc.toS(y) - ahead));
  }, [mobile]);

  /** Change zoom, keeping `focusYear` (default: what's in view now) mid-screen. */
  const zoomTo = useCallback((w: TimeWindow | null, focusYear = yearRef.current) => {
    const next = makeScale(w);
    setZoom(w);
    setTargetS(focusS(next, focusYear));
  }, [focusS]);

  /** Pinch, Ctrl+scroll, +/− keys and buttons: one level in or out around what's in view. */
  const zoomStep = useCallback((dir: 1 | -1) => {
    const y = yearRef.current;
    const nextLevel = dir > 0 ? deeper(level) : shallower(level);
    if (!nextLevel) return;
    zoomTo(windowFor(nextLevel, y), y);
  }, [level, zoomTo]);

  /** Fly to a date, zoomed in just enough to see it clearly, and highlight `id`. */
  const flyTo = useCallback((date: FuzzyDate, id: string) => {
    setHighlight(id);
    const lvl = levelForPrecision(date.precision);
    zoomTo(windowFor(lvl, date.best), date.best);
  }, [zoomTo]);

  /** Fly to where an entity was born/founded (the "rabbit hole" jump). */
  const jumpToEntity = useCallback((id: string) => {
    const e = data.entities.find((x) => x.id === id);
    if (!e) return;
    setPath(null);
    flyTo(e.founded, id);
  }, [data, flyTo]);

  /** Fly to an event, then open its claim map (optionally deeper) once the camera arrives. */
  const flyToEvent = useCallback((id: string, openPath?: Focus[]) => {
    const e = data.events.find((x) => x.id === id);
    if (!e) return;
    setPath(null);
    flyTo(resolveEventDate(e, data).date, id);
    if (openPath) window.setTimeout(() => setPath(openPath), 1100);
  }, [data, flyTo]);

  /** A search result was picked. */
  const onPick = useCallback((r: SearchResult) => {
    setPanel(null);
    if (r.kind === 'event') return flyToEvent(r.id);
    if (r.kind === 'entity') {
      jumpToEntity(r.id);
      setPanel({ kind: 'entity', id: r.id });
      return;
    }
    // A claim: fly to its event, then open the map at the claim (via its parent claims).
    const chain: Focus[] = [];
    for (let c = data.claims.find((x) => x.id === r.id); c; c = c.parentClaimId ? data.claims.find((x) => x.id === c!.parentClaimId) : undefined) {
      chain.unshift({ kind: 'claim', id: c.id });
    }
    const claim = data.claims.find((x) => x.id === r.id)!;
    flyToEvent(r.eventId!, [{ kind: 'event', id: r.eventId! }, { kind: 'topic', id: claim.topicId }, ...chain]);
  }, [data, flyToEvent, jumpToEntity]);

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
        scale={scale}
        level={level}
        targetS={targetS}
        setTargetS={setTargetS}
        onYear={setYear}
        onOpenEvent={(id) => { setPath([{ kind: 'event', id }]); setHighlight(id); }}
        onOpenEntity={(id) => setPanel({ kind: 'entity', id })}
        highlightId={highlight}
        mobile={mobile}
        showImported={showImported}
        onZoomStep={zoomStep}
        onZoomTo={(w, focus) => zoomTo(w, focus)}
      />

      <header className="hud">
        <div className="hud-left">
          <div className="brand">∞ Infinity Timeline <span className="demo-tag">prototype · demo data</span></div>
          {!path && <TimeNav window={zoom} level={level} onZoomTo={(w) => zoomTo(w)} onZoomStep={zoomStep} />}
        </div>
        {!path && <SearchBar data={data} mobile={mobile} onPick={onPick} />}
        <div className="year">{formatForLevel(year, level)}</div>
      </header>

      {!path && (
        <footer className="hud-bottom">
          <div className="lanes">
            {FIELDS.map((f) => <span key={f}><i style={{ background: FIELD_COLOR[f] }} />{f}</span>)}
            <span><i className="span-swatch" />uncertain date</span>
            <span><i className="span-swatch disputed" />disputed date</span>
            <span><i className="cluster-swatch" />cluster (tap to zoom)</span>
            {importedCount > 0 && (
              <label className="toggle">
                <input type="checkbox" checked={showImported} onChange={(e) => setShowImported(e.target.checked)} />
                {importedCount} Wikidata WW2 events
              </label>
            )}
          </div>
          <OverviewBar window={zoom} year={year} onTravel={(y) => setTargetS(focusS(scale, y))} />
          <input
            className="scrubber"
            type="range"
            min={scale.sMin}
            max={scale.sMax}
            step={0.25}
            value={Math.max(scale.sMin, Math.min(scale.sMax, targetS))}
            onChange={(e) => setTargetS(Number(e.target.value))}
            aria-label="Travel through time"
          />
          <div className="chips">
            <span className="muted">Explore debates:</span>
            {data.events.filter((e) => e.topicIds.length).map((e) => (
              <button key={e.id} onClick={() => flyToEvent(e.id, [{ kind: 'event', id: e.id }])}>{e.title}</button>
            ))}
          </div>
          <p className="help">
            {mobile
              ? 'Swipe to travel · pinch to zoom time · tap a bubble or cluster'
              : 'Scroll or drag to travel · Ctrl+scroll, pinch or +/− to zoom time · click the water to zoom into a period · ◆ = people & organisations'}
          </p>
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
