// The claim map: the "mind map" you dive into from an event on the river.
//
// Layout: one bubble in the middle (the event, topic or claim you're looking at) with
// lines out to its children (topics → claims → evidence / counter-claims).
// Positions come from a force layout (src/lib/forceLayout.ts) so labels never sit on a line.
// You can drag to pan, pinch or scroll to zoom, and tap a bubble to go deeper.
// On phones everything is drawn much larger, and you pan around instead of squinting.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Claim, Dataset } from '../types';
import { claimStatus, STATUS_COLOR } from '../lib/status';
import { sourceTrust } from '../lib/trust';
import { formatDate, formatShort } from '../lib/dates';
import { resolveEventDate } from '../lib/dateDispute';
import { DEFAULT_LAYOUT, layoutBounds, layoutStar, type Placed } from '../lib/forceLayout';
import { usePanZoom, type View } from '../lib/usePanZoom';
import { ClaimDetail } from './ClaimDetail';
import { DateExplain } from './DateExplain';
import { OpinionChart } from './OpinionChart';

/** One step of the breadcrumb trail: what kind of thing is in the middle, and its id. */
export type Focus = { kind: 'event' | 'topic' | 'claim'; id: string };

interface Props {
  data: Dataset;
  path: Focus[];
  setPath: (p: Focus[]) => void;
  onClose: () => void;
  onOpenSource: (id: string) => void;
  onOpenEntity: (id: string) => void;
  onVote: (kind: 'agree' | 'well_sourced', id: string, value: 1 | -1) => void;
  mobile: boolean;
}

/** A child bubble before layout. */
interface Node {
  key: string;
  label: string;
  sub?: string;
  color: string;
  ring?: string; // dashed outer ring, used for conflicts of interest
  dashed?: boolean; // dashed line, used for counter-evidence
  size: number; // radius at desktop scale
  onClick: () => void;
}

/** Sizes for desktop and for phones. Phone sizes are deliberately big — you pan around instead. */
const SIZES = {
  desktop: { scale: 1, font: 12, sub: 10.5, lineH: 15, labelW: 170, centerR: 66, centerFont: 12.5, link: 105, minZoom: 0.35 },
  mobile: { scale: 1.35, font: 16, sub: 13, lineH: 20, labelW: 190, centerR: 80, centerFont: 16, link: 70, minZoom: 0.9 },
};
const MAX_LINES = 3;

export function ClaimMap({ data, path, setPath, onClose, onOpenSource, onOpenEntity, onVote, mobile }: Props) {
  const focus = path[path.length - 1];
  const push = (f: Focus) => setPath([...path, f]);
  const sz = mobile ? SIZES.mobile : SIZES.desktop;

  // ---- 1. Work out what's in the middle and which bubbles hang off it. ----
  const { center, children } = useMemo(() => {
    const kids: Node[] = [];
    let center: { label: string; sub: string; color: string };

    const claimNode = (c: Claim): Node => {
      const st = claimStatus(c, data);
      const stanceTag = c.stance ? `${c.stance} · ` : '';
      const dateTag = c.proposedDate ? `${formatDate(c.proposedDate)} · ` : '';
      return {
        key: c.id,
        label: c.text,
        sub: `${dateTag}${stanceTag}${st.status}`,
        color: STATUS_COLOR[st.status],
        size: 34 + Math.min(20, (c.agree.up + c.agree.down) / 120), // bigger = more public attention
        onClick: () => push({ kind: 'claim', id: c.id }),
      };
    };

    if (focus.kind === 'event') {
      const ev = data.events.find((e) => e.id === focus.id)!;
      const resolved = resolveEventDate(ev, data);
      center = { label: ev.title, sub: `${formatShort(resolved.date)}${resolved.disputed ? ' · disputed' : ''}`, color: '#ffffff' };
      for (const tid of ev.topicIds) {
        const t = data.topics.find((x) => x.id === tid);
        if (!t) continue;
        const isDate = !!t.dateOf;
        kids.push({
          key: t.id,
          label: isDate ? `📅 ${t.title}` : t.title,
          sub: isDate ? `date dispute · ${t.claimIds.length} proposals` : `${t.claimIds.length} claims`,
          color: isDate ? '#f5b83d' : '#7aa2ff',
          size: 46,
          onClick: () => push({ kind: 'topic', id: t.id }),
        });
      }
    } else if (focus.kind === 'topic') {
      const t = data.topics.find((x) => x.id === focus.id)!;
      center = { label: t.title, sub: t.dateOf ? 'date dispute' : 'debate', color: t.dateOf ? '#f5b83d' : '#7aa2ff' };
      for (const cid of t.claimIds) {
        const c = data.claims.find((x) => x.id === cid);
        if (c) kids.push(claimNode(c));
      }
    } else {
      const c = data.claims.find((x) => x.id === focus.id)!;
      const st = claimStatus(c, data);
      center = { label: c.text, sub: st.status, color: STATUS_COLOR[st.status] };
      for (const cid of c.childClaimIds) {
        const child = data.claims.find((x) => x.id === cid);
        if (child) kids.push(claimNode(child));
      }
      for (const e of data.evidence.filter((x) => x.claimId === c.id)) {
        const s = data.sources.find((x) => x.id === e.sourceId);
        if (!s) continue;
        const trust = sourceTrust(s, data).score;
        kids.push({
          key: e.id,
          label: s.title,
          sub: `${e.direction === 'for' ? 'evidence for' : 'counter-evidence'} · trust ${Math.round(trust)}`,
          color: e.direction === 'for' ? '#3ddc97' : '#ff5c6c',
          ring: s.conflictOfInterest ? '#ffcc00' : undefined,
          dashed: e.direction === 'against',
          size: 18 + trust / 4, // bigger = more trusted source
          onClick: () => onOpenSource(s.id),
        });
      }
    }
    return { center: center!, children: kids };
  }, [data, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 2. Wrap labels into lines and run the force layout. ----
  const { placed, lines, centerLines, bounds } = useMemo(() => {
    const charsPerLine = Math.floor(sz.labelW / (sz.font * 0.56));
    const lines = new Map<string, string[]>();
    const items = children.map((n) => {
      const ls = wrapText(n.label, charsPerLine, MAX_LINES);
      lines.set(n.key, ls);
      const labelH = ls.length * sz.lineH + (n.sub ? sz.lineH : 0) + 8;
      // Labels only need to be as wide as their longest line.
      const longest = Math.max(...ls.map((l) => l.length), n.sub ? n.sub.length * (sz.sub / sz.font) : 0);
      const labelW = Math.min(sz.labelW, longest * sz.font * 0.56) + 14;
      return { id: n.key, r: n.size * sz.scale, labelW, labelH };
    });
    const opts = { ...DEFAULT_LAYOUT, centerR: sz.centerR, linkLength: sz.link, padding: 8 * sz.scale };
    const placed = layoutStar(items, opts);
    const centerChars = Math.floor((sz.centerR * 1.5) / (sz.centerFont * 0.56));
    return { placed, lines, centerLines: wrapText(center.label, centerChars, 4), bounds: layoutBounds(placed, sz.centerR) };
  }, [children, center.label, sz]);

  // ---- 3. Pan & zoom. Re-fit the view whenever the map or the window size changes. ----
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useElementSize(svgRef);
  const { view, setView, wasDrag, zoomBy } = usePanZoom(svgRef, { x: 0, y: 0, k: 1 }, { minZoom: sz.minZoom * 0.5, maxZoom: 4 });
  const fit = () => setView(fitView(bounds, size.w, size.h, sz.minZoom));
  useEffect(fit, [bounds, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const placedByKey = new Map<string, Placed>(placed.map((p) => [p.id, p]));
  const tap = (fn: () => void) => () => {
    if (!wasDrag()) fn(); // ignore the "click" at the end of a drag or pinch
  };

  // Breadcrumb labels and the opinion chart for the current topic.
  const crumbLabel = (f: Focus) =>
    f.kind === 'event' ? data.events.find((e) => e.id === f.id)?.title
      : f.kind === 'topic' ? data.topics.find((t) => t.id === f.id)?.title
      : data.claims.find((c) => c.id === f.id)?.text;

  const topicId = focus.kind === 'topic' ? focus.id : focus.kind === 'claim' ? data.claims.find((c) => c.id === focus.id)?.topicId : undefined;
  const series = data.opinions.filter((o) => o.topicId === topicId);
  const focusEvent = focus.kind === 'event' ? data.events.find((e) => e.id === focus.id) : undefined;
  const focusTopic = focus.kind === 'topic' ? data.topics.find((t) => t.id === focus.id) : undefined;
  const dateTopicEvent = focusTopic?.dateOf ? data.events.find((e) => e.id === focusTopic.dateOf) : undefined;

  return (
    <div className="map-overlay">
      <div className="map-header">
        <div className="crumbs">
          {path.map((f, i) => (
            <button key={i} className={i === path.length - 1 ? 'active' : ''} onClick={() => setPath(path.slice(0, i + 1))}>
              {truncate(crumbLabel(f) ?? '', mobile ? 22 : 38)}
            </button>
          ))}
        </div>
        <button className="close" onClick={onClose}>✕ {mobile ? 'River' : 'Back to river'}</button>
      </div>

      <div className="map-body">
        <div className="map-canvas">
          <svg ref={svgRef} className="map-svg" role="img" aria-label={`Claim map for ${center.label}`}>
            <defs>
              <radialGradient id="glow"><stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" /><stop offset="100%" stopColor="#ffffff" stopOpacity="0" /></radialGradient>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {/* Lines first, so bubbles and labels draw on top of them. */}
              {children.map((n) => {
                const p = placedByKey.get(n.key)!;
                return <line key={`l-${n.key}`} x1={0} y1={0} x2={p.x} y2={p.y} stroke={n.color} strokeOpacity={0.45} strokeWidth={2 * sz.scale} strokeDasharray={n.dashed ? '6 5' : undefined} />;
              })}

              {/* The bubble in the middle. */}
              <circle r={sz.centerR * 1.75} fill="url(#glow)" />
              <circle r={sz.centerR} fill="#0d1324" stroke={center.color} strokeWidth={3 * sz.scale} />
              <text className="node-text center" fontSize={sz.centerFont} textAnchor="middle">
                {centerLines.map((l, i) => (
                  <tspan key={i} x={0} y={(i - (centerLines.length - 1) / 2) * sz.centerFont * 1.25 - sz.centerFont * 0.4} fontWeight={700}>{l}</tspan>
                ))}
                <tspan x={0} y={((centerLines.length + 1) / 2) * sz.centerFont * 1.25 - sz.centerFont * 0.2} fontSize={sz.sub} fill="#aab4c8">{truncate(center.sub, Math.floor((sz.centerR * 1.8) / (sz.sub * 0.56)))}</tspan>
              </text>

              {/* The child bubbles and their labels. */}
              {children.map((n) => {
                const p = placedByKey.get(n.key)!;
                const ls = lines.get(n.key)!;
                const top = p.label.y - p.label.h / 2;
                return (
                  <g
                    key={n.key}
                    className="map-node"
                    role="button"
                    tabIndex={0}
                    aria-label={`${n.label}. ${n.sub ?? ''}`}
                    onClick={tap(n.onClick)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n.onClick(); } }}
                  >
                    {n.ring && <circle cx={p.x} cy={p.y} r={p.r + 6 * sz.scale} fill="none" stroke={n.ring} strokeWidth={2} strokeDasharray="4 3" />}
                    <circle cx={p.x} cy={p.y} r={p.r} fill="#0d1324" stroke={n.color} strokeWidth={2.5 * sz.scale} />
                    {/* A soft backing so text stays readable over the glow. */}
                    <rect x={p.label.x - p.label.w / 2} y={top} width={p.label.w} height={p.label.h} rx={6} fill="#0b1020" fillOpacity={0.72} />
                    <text className="node-text" fontSize={sz.font} textAnchor="middle">
                      {ls.map((l, i) => (
                        <tspan key={i} x={p.label.x} y={top + 4 + sz.lineH * (i + 0.8)} fontWeight={600}>{l}</tspan>
                      ))}
                      {n.sub && <tspan x={p.label.x} y={top + 4 + sz.lineH * (ls.length + 0.8)} fontSize={sz.sub} fill={n.color}>{n.sub}</tspan>}
                    </text>
                  </g>
                );
              })}
              {children.length === 0 && (
                <text y={sz.centerR + 40} textAnchor="middle" fill="#8892a6" fontSize={sz.font}>No forks yet — add the first claim.</text>
              )}
            </g>
          </svg>

          <div className="zoom-controls" aria-label="Map zoom">
            <button onClick={() => zoomBy(1.3)} aria-label="Zoom in">＋</button>
            <button onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">－</button>
            <button onClick={fit} aria-label="Fit map to screen">⤢</button>
          </div>
          <p className="map-help">{mobile ? 'Drag to move · pinch to zoom · tap a bubble' : 'Drag to move · scroll or pinch to zoom · click a bubble'}</p>
        </div>

        <aside className="map-side">
          {focus.kind === 'claim' ? (
            <ClaimDetail data={data} claimId={focus.id} onOpenSource={onOpenSource} onOpenEntity={onOpenEntity} onVote={onVote} />
          ) : (
            <div className="hint">
              <h3>{center.label}</h3>
              {focusEvent && <p className="muted">{focusEvent.summary}</p>}
              {focusEvent && <DateExplain data={data} event={focusEvent} onOpenSource={onOpenSource} onOpenTopic={(id) => push({ kind: 'topic', id })} />}
              {dateTopicEvent && (
                <p>
                  Each bubble proposes a date for <b>{dateTopicEvent.title}</b>. They earn a status from evidence like any claim,
                  and the river’s glowing span follows the proposals that are still standing.
                </p>
              )}
              <p>Tap a bubble to go deeper. Claims are coloured by their <b>earned status</b>; bubble size shows how much public attention they get.</p>
              <Legend />
            </div>
          )}
          {series.map((s) => <OpinionChart key={s.id} series={s} data={data} />)}
        </aside>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      {Object.entries(STATUS_COLOR).map(([k, c]) => (
        <span key={k}><i style={{ background: c }} />{k}</span>
      ))}
      <span><i style={{ background: '#3ddc97' }} />Evidence for</span>
      <span><i style={{ background: '#ff5c6c' }} />Counter-evidence</span>
      <span><i style={{ border: '2px dashed #ffcc00', background: 'transparent' }} />Conflict of interest</span>
      <span><i style={{ background: '#f5b83d' }} />Date dispute</span>
    </div>
  );
}

/** Choose a starting view that fits the whole map, but never zooms out so far that text is tiny. */
function fitView(b: { minX: number; minY: number; maxX: number; maxY: number }, w: number, h: number, minZoom: number): View {
  if (!w || !h) return { x: w / 2, y: h / 2, k: 1 };
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const fitK = Math.min(w / bw, h / bh) * 0.92;
  const k = Math.max(minZoom, Math.min(1.25, fitK));
  // If it fits, centre the whole map; if not (small phones), centre on the middle bubble.
  const cx = fitK >= minZoom ? (b.minX + b.maxX) / 2 : 0;
  const cy = fitK >= minZoom ? (b.minY + b.maxY) / 2 : 0;
  return { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
}

/** Track an element's size in CSS pixels (so SVG units = screen pixels at zoom 1). */
function useElementSize(ref: RefObject<Element>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Break text into lines of at most `maxChars`, adding "…" if it runs past `maxLines`. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  const out = lines.map((l) => truncate(l, maxChars));
  if (out.length > maxLines) {
    out.length = maxLines;
    out[maxLines - 1] = truncate(out[maxLines - 1] + '…', maxChars);
  }
  return out;
}

export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
