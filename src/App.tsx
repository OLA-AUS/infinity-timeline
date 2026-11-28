// The top-level screen. Holds the app's state and wires the pieces together:
//   River (3D timeline)  →  click an event  →  ClaimMap (mind map)  →  SourcePanel (provenance)
// plus the time-scale controls (ScaleBar, Breadcrumb, OverviewBar) and search (SearchBar).
//
// Time scale: `view` holds the stack of steps the river is showing (full river, expanded
// periods, a Years/Months/Weeks/Days window — src/lib/viewStack.ts) and where the camera
// should end up after the latest change. The river does the animation and camera maths
// (src/lib/cameraAnchor.ts); when it's done it sets `targetS` — the camera's distance along
// the river in the new scale — so nothing moves afterwards. `cameraYear` is the time at the
// camera, shown in the big date readout.
//
// Topic rivers: while a claim map is open, the 3D view shows the topic river of an
// "anchor" event (src/lib/related.ts). `topicPos` is where you are along it, in stops;
// gliding changes it, and whichever stop is nearest becomes the map's centre. Clicking a
// linked bubble or a branch point makes a new anchor. `trail` records each centre you've
// visited and how, for the breadcrumb.
//
// Personal spaces: `world` is the public data (seed + data/ files). The spaces on this device
// (IndexedDB, src/lib/usePersonalSpaces.ts) are merged on top of it as extra lanes, so `data`
// is what everything else sees. Votes on personal items are saved back into their space.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { seed } from './data/seed';
import { loadRepoData, mergeDatasets } from './data/repoData';
import type { Dataset, FuzzyDate } from './types';
import { FIELDS } from './types';
import { River, type ViewRequest } from './components/River';
import { ClaimMap, type Focus, type TrailStep } from './components/ClaimMap';
import { buildGraph, topicRiver, type TopicRiver } from './lib/related';
import { SourcePanel, type PanelTarget } from './components/SourcePanel';
import { Breadcrumb, OverviewBar, ScaleBar } from './components/TimeNav';
import { SearchBar } from './components/SearchBar';
import { SpacesPanel } from './components/SpacesPanel';
import { usePersonalSpaces } from './lib/usePersonalSpaces';
import { votePersonal, withSpaces } from './lib/personal';
import { personalLaneOffset } from './lib/time';
import type { SpaceTag } from './types';
import { FIELD_COLOR } from './lib/time';
import { resolveEventDate } from './lib/dateDispute';
import { formatForWindow, makeScale, SCALE_LEVELS, type ScaleLevel } from './lib/timeScale';
import {
  chooseLevel,
  collapse,
  continueWindow,
  crumbs,
  currentLevel,
  currentWindow,
  expandCluster,
  FULL_RIVER,
  goToStep,
  levelForPrecision,
  periodAvailable,
  type ViewChange,
} from './lib/viewStack';
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
  const [world, setWorld] = useState<Dataset>(initial);
  // Personal spaces, only on this device, merged in as extra lanes.
  const personal = usePersonalSpaces();
  const data = useMemo(() => withSpaces(world, personal.spaces), [world, personal.spaces]);
  const laneTags = useMemo<SpaceTag[]>(() => personal.spaces.filter((s) => !s.hidden).map((s, lane) => ({ id: s.id, name: s.name, color: s.color, lane })), [personal.spaces]);
  const [spacesOpen, setSpacesOpen] = useState(false);
  // The lane the camera has been sent to from the legend (a space id), or null = follow the highlight.
  const [laneFocus, setLaneFocus] = useState<string | null>(null);
  const focusTag = laneTags.find((l) => l.id === laneFocus);
  const sideFocus = focusTag ? personalLaneOffset(focusTag.lane) : laneFocus === 'world' ? 0 : null;
  const [view, setView] = useState<ViewRequest>({ change: { stack: FULL_RIVER, anchor: { camera: true } }, seq: 0 });
  const stack = view.change.stack;
  const window_ = currentWindow(stack);
  const scale = useMemo(() => makeScale(window_), [window_]);
  const level = currentLevel(stack);
  const [targetS, setTargetS] = useState(() => makeScale(null).toS(1900)); // where the camera is heading
  const [year, setYear] = useState(1900); // the time at the camera (for the big date readout)
  const yearRef = useRef(year);
  yearRef.current = year;
  const [selected, setSelected] = useState<string | null>(null); // the selected bubble on the main river
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

  /** River distance for a moment with scale `sc` (clamped to the river). */
  const sFor = useCallback((sc: ReturnType<typeof makeScale>, y: number) => Math.max(sc.sMin, Math.min(sc.sMax, sc.toS(y))), []);

  /**
   * Apply a change to what the river shows. The river animates it; the target is also set
   * here, so it still lands in the right place if the 3D river is being re-created (e.g.
   * straight after closing a claim map).
   */
  const apply = useCallback((change: ViewChange | null) => {
    if (!change) return;
    setView((v) => ({ change, seq: v.seq + 1 }));
    const next = makeScale(currentWindow(change.stack));
    const a = change.anchor;
    setTargetS(sFor(next, 'at' in a ? a.at : yearRef.current + (a.shift ?? 0)));
  }, [sFor]);

  const selectedYear = () => {
    const ev = selected ? data.events.find((e) => e.id === selected) : undefined;
    return ev ? resolveEventDate(ev, data).date.best : undefined;
  };

  /** A level on the scale bar. */
  const chooseScale = (l: ScaleLevel) => apply(chooseLevel(stack, l, yearRef.current, selectedYear()));

  /** + / − keys: one step along the scale bar (skipping Period unless one is expanded). */
  const stepScale = (dir: 1 | -1) => {
    const usable = SCALE_LEVELS.filter((l) => l !== 'period' || periodAvailable(stack));
    const next = usable[usable.indexOf(level) + dir];
    if (next) chooseScale(next);
  };

  /** "Expand these N events" on a fanned-out cluster. */
  const onExpandCluster = (ids: string[]) => {
    const years = ids.map((id) => data.events.find((e) => e.id === id)).filter(Boolean).map((e) => resolveEventDate(e!, data).date.best);
    if (years.length) apply(expandCluster(stack, years));
  };

  /** Fly to a date, with the scale its precision deserves, and highlight `id`. */
  const flyTo = useCallback((date: FuzzyDate, id: string) => {
    setHighlight(id);
    setLaneFocus(null); // let the camera follow the highlighted item's lane
    const lvl = levelForPrecision(date.precision);
    apply(lvl === 'full' ? { stack: FULL_RIVER, anchor: { at: date.best } } : chooseLevel(FULL_RIVER, lvl, date.best, date.best));
  }, [apply]);

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

  /** Open a claim inside its event's map, via its parent claims (so the breadcrumb makes sense). */
  const openClaim = useCallback((claimId: string, eventId: string) => {
    const chain: Focus[] = [];
    for (let c = data.claims.find((x) => x.id === claimId); c; c = c.parentClaimId ? data.claims.find((x) => x.id === c!.parentClaimId) : undefined) {
      chain.unshift({ kind: 'claim', id: c.id });
    }
    const claim = data.claims.find((x) => x.id === claimId);
    if (!claim) return;
    flyToEvent(eventId, [{ kind: 'event', id: eventId }, { kind: 'topic', id: claim.topicId }, ...chain]);
  }, [data, flyToEvent]);

  /** A search result was picked. */
  const onPick = useCallback((r: SearchResult) => {
    setPanel(null);
    if (r.kind === 'event') return flyToEvent(r.id);
    if (r.kind === 'entity') {
      jumpToEntity(r.id);
      setPanel({ kind: 'entity', id: r.id });
      return;
    }
    openClaim(r.id, r.eventId!); // a claim: fly to its event, then open the map at the claim
  }, [flyToEvent, jumpToEntity, openClaim]);

  // Local demo voting. In production this posts to the API and is logged in the edit history.
  // Note the two separate signals: "agree" only touches the claim's opinion counts;
  // "well sourced" touches the evidence, which is what moves a claim's status.
  const vote = useCallback((kind: 'agree' | 'well_sourced', id: string, value: 1 | -1) => {
    const mine = votePersonal(personal.spaces, id, kind, value, kind === 'agree' ? 1 : 10, new Date().toISOString());
    if (mine) return personal.put(mine);
    setWorld((d) => {
      const key = value === 1 ? 'up' : 'down';
      if (kind === 'agree') {
        return { ...d, claims: d.claims.map((c) => (c.id === id ? { ...c, agree: { ...c.agree, [key]: c.agree[key] + 1 } } : c)) };
      }
      return { ...d, evidence: d.evidence.map((e) => (e.id === id ? { ...e, wellSourced: { ...e.wellSourced, [key]: e.wellSourced[key] + 10 } } : e)) };
    });
  }, [personal]);

  // Votes on links between events. Same two signals: only "well sourced" changes link strength.
  const voteLink = useCallback((id: string, kind: 'agree' | 'well_sourced', value: 1 | -1) => {
    const mine = votePersonal(personal.spaces, id, kind, value, kind === 'agree' ? 1 : 10, new Date().toISOString());
    if (mine) return personal.put(mine);
    const key = value === 1 ? 'up' : 'down';
    setWorld((d) => ({
      ...d,
      links: d.links.map((l) => {
        if (l.id !== id) return l;
        return kind === 'agree'
          ? { ...l, agree: { ...l.agree, [key]: l.agree[key] + 1 } }
          : { ...l, wellSourced: { ...l.wellSourced, [key]: l.wellSourced[key] + 10 } };
      }),
    }));
  }, [personal]);

  // "Show" on a personal event: it may have only just been added, so wait until it's in the data.
  const [showPending, setShowPending] = useState<string | null>(null);
  useEffect(() => {
    if (!showPending) return;
    const ev = data.events.find((e) => e.id === showPending);
    if (!ev) return;
    setShowPending(null);
    setSpacesOpen(false);
    setPath(null);
    flyTo(resolveEventDate(ev, data).date, ev.id);
  }, [showPending, data, flyTo]);

  // If the event in the middle of the map disappears (a personal event removed, or its space
  // hidden), close the map rather than show something that isn't there.
  useEffect(() => {
    if (path && !data.events.some((e) => e.id === path[0].id)) {
      setPath(null);
      setAnchor(null);
      setTrail([]);
    }
  }, [data, path]);

  return (
    <div className="app">
      <River
        data={data}
        view={view}
        level={level}
        targetS={targetS}
        setTargetS={setTargetS}
        onCameraTime={setYear}
        onOpenEvent={(id) => openMap(id)}
        onOpenEntity={(id) => setPanel({ kind: 'entity', id })}
        highlightId={highlight}
        selectedId={selected}
        onSelect={setSelected}
        mobile={mobile}
        showImported={showImported}
        onExpandCluster={onExpandCluster}
        onContinue={(dir) => apply(continueWindow(stack, dir))}
        onCollapse={() => apply(collapse(stack))}
        onStep={stepScale}
        topic={path && river ? { data, river, pos: topicPos, mobile, onPick: goToStop, onBranch: (id) => switchTo(id, 'branch') } : undefined}
        spaces={laneTags}
        sideFocus={sideFocus}
      />

      {/* The main river's header: brand and the big date on one line, the scale bar under it,
          and the breadcrumb of expanded periods (only when there is one). Kept slim and
          see-through so the river gets the room. Hidden while a claim map is open: the map has
          its own header, and the overlay is see-through so the topic river shows behind it. */}
      {!path && (
        <header className="hud">
          <div className="hud-top">
            <div className="brand">∞ Infinity Timeline <span className="demo-tag">prototype · demo data</span></div>
            <div className="year" aria-live="polite">{formatForWindow(year, window_)}</div>
          </div>
          <ScaleBar level={level} periodAvailable={periodAvailable(stack)} onChoose={chooseScale} />
          <Breadcrumb labels={crumbs(stack)} onGoTo={(i) => apply(goToStep(stack, i))} />
        </header>
      )}

      {/* Bottom: the legend, a thin "where am I in all of history" bar, then the search dock.
          The search dock also holds what used to sit here (hot debates, help text). */}
      {!path && (
        <footer className="hud-bottom">
          <div className="lanes">
            {FIELDS.map((f) => <span key={f}><i style={{ background: FIELD_COLOR[f] }} />{f}</span>)}
            <span><i className="span-swatch" />uncertain date</span>
            <span><i className="span-swatch disputed" />disputed date</span>
            {/* Personal lanes: tap one to slide over to it (on phones they're off to the side). */}
            {laneTags.map((l) => (
              <button key={l.id} className={`lane-chip ${laneFocus === l.id ? 'on' : ''}`} onClick={() => setLaneFocus(laneFocus === l.id ? 'world' : l.id)} title={`${l.name} — only on this device`}>
                <i style={{ background: l.color }} />{l.name}
              </button>
            ))}
            {laneTags.length > 0 && laneFocus && laneFocus !== 'world' && <button className="lane-chip" onClick={() => setLaneFocus('world')}>↩ World</button>}
            {importedCount > 0 && (
              <label className="toggle">
                <input type="checkbox" checked={showImported} onChange={(e) => setShowImported(e.target.checked)} />
                {importedCount} Wikidata WW2 events
              </label>
            )}
          </div>
          <OverviewBar window={window_} year={year} onTravel={(y) => setTargetS(sFor(scale, y))} />
          {/* On big screens a fine slider for travelling inside the current window; phones swipe the river instead. */}
          {!mobile && (
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
          )}
          <div className="dock-row">
            <button className="spaces-btn" onClick={() => setSpacesOpen((o) => !o)} aria-expanded={spacesOpen} aria-label="My spaces (private, on this device)">
              🔒{mobile ? '' : ' My spaces'}{personal.spaces.length ? ` ${personal.spaces.length}` : ''}
            </button>
            <SearchBar
              data={data}
              mobile={mobile}
              onPick={onPick}
              onOpenEvent={(id) => flyToEvent(id, [{ kind: 'event', id }])}
              onOpenClaim={openClaim}
              help={mobile
                ? 'Swipe the river to travel · pick a scale at the top · tap overlapping bubbles to list them and expand their period'
                : 'Scroll or drag to travel · pick a scale under the date (or + / −) · click overlapping bubbles to fan them out and expand them · ◆ = people & organisations · press / to search'}
            />
          </div>
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
          personal={personal.loaded ? { spaces: personal.spaces, onUpdate: personal.update } : undefined}
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

      {spacesOpen && !path && (
        <SpacesPanel
          spaces={personal.spaces}
          storageError={personal.storageError}
          onAdd={personal.add}
          onUpdate={personal.update}
          onRemove={personal.remove}
          onShowEvent={setShowPending}
          onGoToLane={(id) => { setLaneFocus(id); if (mobile) setSpacesOpen(false); }}
          onClose={() => setSpacesOpen(false)}
        />
      )}

      {panel && (
        <SourcePanel data={data} target={panel} onOpen={setPanel} onJump={(id) => { setPanel(null); jumpToEntity(id); }} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}
