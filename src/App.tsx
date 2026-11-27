// The top-level screen. Holds the app's state and wires the pieces together:
//   River (3D timeline)  →  click an event  →  ClaimMap (mind map)  →  SourcePanel (provenance)
// plus the expand-in-place controls (ExpandNav, OverviewBar) and search (SearchBar).
//
// Expanding time: `expansion` says which period is expanded (a year shown month by month,
// or a month shown day by day, or none) and which moment must stay still on screen while
// it changes. The river does the animation and the camera maths (src/lib/cameraAnchor.ts),
// and when it's done it sets `targetS` — the camera's distance along the river in the new
// scale — so nothing moves afterwards.
//
// Topic rivers: while a claim map is open, the 3D view shows the topic river of an
// "anchor" event (src/lib/related.ts). `topicPos` is where you are along it, in stops;
// gliding changes it, and whichever stop is nearest becomes the map's centre. Clicking a
// linked bubble or a branch point makes a new anchor. `trail` records each centre you've
// visited and how, for the breadcrumb.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { seed } from './data/seed';
import { loadRepoData, mergeDatasets } from './data/repoData';
import type { Dataset, FuzzyDate } from './types';
import { FIELDS } from './types';
import { FOCUS_AHEAD, River, type Expansion } from './components/River';
import { ClaimMap, type Focus, type TrailStep } from './components/ClaimMap';
import { buildGraph, topicRiver, type TopicRiver } from './lib/related';
import { SourcePanel, type PanelTarget } from './components/SourcePanel';
import { ExpandNav, OverviewBar } from './components/TimeNav';
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
  type ExpandLevel,
  type TimeWindow,
} from './lib/timeScale';
import type { SearchResult } from './lib/search';

/** Screens narrower than this get the mobile "dive" layout and bigger tap targets. */
const MOBILE_WIDTH = 760;
/** Where the relevance slider starts: direct links plus strong two-step connections. */
const DEFAULT_RELEVANCE = 0.4;
/** The breadcrumb trail keeps this many steps. */
const MAX_TRAIL = 12;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Which stop an event is on a topic river (the river's start if it isn't on it). */
const stopOf = (r: TopicRiver, id: string) => {
  const i = r.stops.findIndex((s) => s.eventId === id);
  return i >= 0 ? i : Math.max(0, r.stops.findIndex((s) => s.eventId === r.anchorId));
};

export default function App() {
  // Demo seed + real data files from data/, merged once at start-up.
  const initial = useMemo(() => mergeDatasets(seed, loadRepoData()), []);
  const [data, setData] = useState<Dataset>(initial);
  const [expansion, setExpansion] = useState<Expansion>({ window: null, anchor: 1900, seq: 0 }); // window null = not expanded
  const scale = useMemo(() => makeScale(expansion.window), [expansion.window]);
  const level = levelOf(expansion.window);
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

  // ---- Topic river state (only used while a claim map is open) ----
  const graph = useMemo(() => buildGraph(data), [data]);
  const [anchor, setAnchor] = useState<string | null>(null); // the event whose topic river is shown
  const [relevance, setRelevance] = useState(DEFAULT_RELEVANCE); // 0 = direct links only, 1 = loose
  const [topicPos, setTopicPos] = useState(0); // where you are along the river, in stops
  const [trail, setTrail] = useState<TrailStep[]>([]);
  const river = useMemo(() => (anchor ? topicRiver(anchor, data, graph, relevance) : null), [anchor, data, graph, relevance]);
  const gliding = useRef(false); // true while the user is gliding (so the nearest stop takes over the centre)
  const snapTimer = useRef<number>();
  const riverRef = useRef(river);
  riverRef.current = river;
  const pathRef = useRef(path);
  pathRef.current = path;

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

  /**
   * Expand (or collapse) to `w`, keeping `anchor` still on screen. With `flyTo`, travel to
   * that moment afterwards. The target is also set here, so it still works if the 3D river
   * is being re-created (e.g. straight after closing a claim map).
   */
  const expandTo = useCallback((w: TimeWindow | null, anchor: number, flyTo?: number) => {
    setExpansion((e) => ({ window: w, anchor, flyTo, seq: e.seq + 1 }));
    if (flyTo !== undefined) setTargetS(focusS(makeScale(w), flyTo));
  }, [focusS]);

  /** Double-click / a bubble's menu: expand to `lvl` around `anchorYear`. */
  const expandAround = useCallback((lvl: ExpandLevel, anchorYear: number) => {
    expandTo(windowFor(lvl, anchorYear), anchorYear);
  }, [expandTo]);

  /** + / − keys and the Collapse control: one level in or out, around the middle of the screen. */
  const expandStep = useCallback((dir: 1 | -1) => {
    const y = yearRef.current;
    const nextLevel = dir > 0 ? deeper(level) : shallower(level);
    if (!nextLevel) return;
    expandTo(windowFor(nextLevel, y), y);
  }, [level, expandTo]);

  /** Fly to a date, expanded just enough to see it clearly, and highlight `id`. */
  const flyTo = useCallback((date: FuzzyDate, id: string) => {
    setHighlight(id);
    const lvl = levelForPrecision(date.precision);
    expandTo(windowFor(lvl, date.best), yearRef.current, date.best); // the view stays still, then flies
  }, [expandTo]);

  /** Fly to where an entity was born/founded (the "rabbit hole" jump). */
  const jumpToEntity = useCallback((id: string) => {
    const e = data.entities.find((x) => x.id === id);
    if (!e) return;
    setPath(null);
    flyTo(e.founded, id);
  }, [data, flyTo]);

  // ---- Topic rivers ----

  /** Open the claim map on an event, with that event's topic river behind it. */
  const openMap = useCallback((eventId: string, openPath?: Focus[]) => {
    const r = topicRiver(eventId, data, graph, relevance);
    gliding.current = false;
    setAnchor(eventId);
    setTopicPos(stopOf(r, eventId));
    setTrail([{ eventId, anchorId: eventId, via: 'start' }]);
    setPath(openPath ?? [{ kind: 'event', id: eventId }]);
    setHighlight(eventId);
  }, [data, graph, relevance]);

  /** Make another event the centre and swap in its topic river (a linked bubble, or a branch point). */
  const switchTo = useCallback((eventId: string, via: 'click' | 'branch') => {
    const r = topicRiver(eventId, data, graph, relevance);
    gliding.current = false;
    setAnchor(eventId);
    setTopicPos(stopOf(r, eventId));
    setTrail((t) => [...t, { eventId, anchorId: eventId, via }].slice(-MAX_TRAIL));
    setPath([{ kind: 'event', id: eventId }]);
    setHighlight(eventId);
  }, [data, graph, relevance]);

  /** Scroll / drag: glide along the river, then settle on the nearest stop once you stop moving. */
  const glide = useCallback((deltaStops: number) => {
    const r = riverRef.current;
    if (!r) return;
    gliding.current = true;
    setTopicPos((p) => clamp(p + deltaStops, 0, r.stops.length - 1));
    window.clearTimeout(snapTimer.current);
    snapTimer.current = window.setTimeout(() => setTopicPos((p) => Math.round(p)), 250);
  }, []);

  /** Tap a stop (or ◀ ▶): glide straight to it. */
  const goToStop = useCallback((i: number) => {
    gliding.current = true;
    setTopicPos(i);
  }, []);

  // While gliding, whichever stop is nearest becomes the map's centre. The trail keeps one
  // "glide" step that updates as you go, rather than one per event passed.
  useEffect(() => {
    const r = riverRef.current;
    const p = pathRef.current;
    if (!r || !p || !gliding.current) return;
    const stop = r.stops[Math.round(topicPos)];
    if (!stop || stop.eventId === p[0].id) return;
    setPath([{ kind: 'event', id: stop.eventId }]);
    setHighlight(stop.eventId);
    setTrail((t) => {
      const step: TrailStep = { eventId: stop.eventId, anchorId: r.anchorId, via: 'glide' };
      return t[t.length - 1]?.via === 'glide' ? [...t.slice(0, -1), step] : [...t, step].slice(-MAX_TRAIL);
    });
  }, [topicPos]);

  // When the river itself changes (relevance slider, a vote), keep the current centre in
  // place if it's still on the river; otherwise go back to where the river starts.
  useEffect(() => {
    const p = pathRef.current;
    if (!river || !p) return;
    gliding.current = false;
    const i = river.stops.findIndex((s) => s.eventId === p[0].id);
    if (i >= 0) {
      setTopicPos((pos) => (Math.round(pos) === i ? pos : i));
    } else {
      setTopicPos(stopOf(river, river.anchorId));
      setPath([{ kind: 'event', id: river.anchorId }]);
    }
  }, [river]);

  /** Tap a step in the breadcrumb trail: go back to that event, on the river you were on then. */
  const trailJump = useCallback((i: number) => {
    const step = trail[i];
    if (!step) return;
    const r = topicRiver(step.anchorId, data, graph, relevance);
    gliding.current = false;
    setAnchor(step.anchorId);
    setTopicPos(stopOf(r, step.eventId));
    setTrail((t) => t.slice(0, i + 1));
    setPath([{ kind: 'event', id: step.eventId }]);
    setHighlight(step.eventId);
  }, [trail, data, graph, relevance]);

  /** "Back to main river": close the map and land on the main river at the event you were on. */
  const backToMain = useCallback(() => {
    const current = pathRef.current?.[0];
    setPath(null);
    setAnchor(null);
    setTrail([]);
    const ev = current && data.events.find((e) => e.id === current.id);
    if (ev) flyTo(resolveEventDate(ev, data).date, ev.id);
  }, [data, flyTo]);

  /** Fly to an event, then open its claim map (optionally deeper) once the camera arrives. */
  const flyToEvent = useCallback((id: string, openPath?: Focus[]) => {
    const e = data.events.find((x) => x.id === id);
    if (!e) return;
    setPath(null);
    flyTo(resolveEventDate(e, data).date, id);
    if (openPath) window.setTimeout(() => openMap(id, openPath), 1100);
  }, [data, flyTo, openMap]);

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

  // Votes on links between events. Same two signals: only "well sourced" changes link strength.
  const voteLink = useCallback((id: string, kind: 'agree' | 'well_sourced', value: 1 | -1) => {
    const key = value === 1 ? 'up' : 'down';
    setData((d) => ({
      ...d,
      links: d.links.map((l) => {
        if (l.id !== id) return l;
        return kind === 'agree'
          ? { ...l, agree: { ...l.agree, [key]: l.agree[key] + 1 } }
          : { ...l, wellSourced: { ...l.wellSourced, [key]: l.wellSourced[key] + 10 } };
      }),
    }));
  }, []);

  return (
    <div className="app">
      <River
        data={data}
        expansion={expansion}
        level={level}
        targetS={targetS}
        setTargetS={setTargetS}
        onYear={setYear}
        onOpenEvent={(id) => openMap(id)}
        onOpenEntity={(id) => setPanel({ kind: 'entity', id })}
        highlightId={highlight}
        mobile={mobile}
        showImported={showImported}
        onExpand={expandAround}
        onExpandStep={expandStep}
        topic={path && river ? { data, river, pos: topicPos, mobile, onPick: goToStop, onBranch: (id) => switchTo(id, 'branch') } : undefined}
      />

      {/* The main river's header. Hidden while a claim map is open: the map has its own header,
          and the overlay is see-through so the topic river shows behind it. */}
      {!path && (
        <header className="hud">
          <div className="hud-left">
            <div className="brand">∞ Infinity Timeline <span className="demo-tag">prototype · demo data</span></div>
            <ExpandNav window={expansion.window} mobile={mobile} onGoTo={(w) => expandTo(w, yearRef.current)} onCollapse={() => expandStep(-1)} />
          </div>
          <SearchBar data={data} mobile={mobile} onPick={onPick} />
          <div className="year">{formatForLevel(year, level)}</div>
        </header>
      )}

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
          <OverviewBar window={expansion.window} year={year} onTravel={(y) => setTargetS(focusS(scale, y))} />
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
              ? 'Swipe to travel · double-tap the river to expand time · tap a bubble (overlapping ones fan out)'
              : 'Scroll or drag to travel · double-click the river or press + / − to expand time · click a bubble (overlapping ones fan out) · ◆ = people & organisations'}
          </p>
        </footer>
      )}

      {path && (
        <ClaimMap
          data={data}
          path={path}
          setPath={setPath}
          onClose={backToMain}
          onOpenSource={(id) => setPanel({ kind: 'source', id })}
          onOpenEntity={(id) => setPanel({ kind: 'entity', id })}
          onVote={vote}
          mobile={mobile}
          topic={river ? {
            river,
            graph,
            pos: topicPos,
            relevance,
            setRelevance,
            onGlide: glide,
            onStop: goToStop,
            onSwitchEvent: switchTo,
            trail,
            onTrailJump: trailJump,
            onVoteLink: voteLink,
          } : undefined}
        />
      )}

      {panel && (
        <SourcePanel data={data} target={panel} onOpen={setPanel} onJump={(id) => { setPanel(null); jumpToEntity(id); }} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}
