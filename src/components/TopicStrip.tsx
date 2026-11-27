// The strip along the bottom of the claim map that drives the topic river.
//   • Every stop on the river, in date order. Drag or swipe the strip to glide along it;
//     tap a stop to glide straight there. ◀ ▶ step one stop at a time (arrow keys too).
//   • ⑂ marks a branch point: another topic river crosses here. Tap it to switch rivers.
//   • The relevance slider widens the river from "direct" links only to "loose" connections.
// Everything you can tap is at least 44px on phones.
import { useEffect, useRef } from 'react';
import type { Dataset } from '../types';
import { FIELD_COLOR } from '../lib/time';
import { formatShort } from '../lib/dates';
import { resolveEventDate } from '../lib/dateDispute';
import type { TopicRiver } from '../lib/related';

interface Props {
  data: Dataset;
  river: TopicRiver;
  pos: number;
  relevance: number;
  mobile: boolean;
  onGlide: (deltaStops: number) => void;
  onStop: (index: number) => void;
  onBranch: (eventId: string) => void;
  setRelevance: (r: number) => void;
}

/** Width of one stop on the strip, in pixels. Dragging this far moves one stop. */
const STOP_W = { desktop: 150, mobile: 124 };

export function TopicStrip({ data, river, pos, relevance, mobile, onGlide, onStop, onBranch, setRelevance }: Props) {
  const w = mobile ? STOP_W.mobile : STOP_W.desktop;
  const drag = useRef<{ x: number; moved: number } | null>(null);
  const lastMoved = useRef(0); // how far the last gesture moved (pointer-up fires before click)
  const current = Math.round(pos);
  const branches = new Map(river.branches.map((b) => [b.eventId, b.newEvents]));
  const last = river.stops.length - 1;

  // Arrow keys step along the river (unless you're typing somewhere).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'ArrowRight') onStop(Math.min(last, current + 1));
      if (e.key === 'ArrowLeft') onStop(Math.max(0, current - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [current, last, onStop]);

  // Dragging: every STOP_W pixels moves one stop. A short tap still counts as a tap.
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, moved: 0 };
    lastMoved.current = 0;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    drag.current.x = e.clientX;
    drag.current.moved += Math.abs(dx);
    lastMoved.current = drag.current.moved;
    onGlide(-dx / w);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const tapped = () => lastMoved.current < 6;

  return (
    <div className="topic-strip" aria-label="Topic river">
      <div className="strip-head">
        <span className="strip-title">Topic river · {river.stops.length} event{river.stops.length === 1 ? '' : 's'}{river.branches.length ? ` · ${river.branches.length} branch point${river.branches.length > 1 ? 's' : ''}` : ''}</span>
        <label className="relevance">
          <span>Direct</span>
          <input type="range" min={0} max={1} step={0.05} value={relevance} onChange={(e) => setRelevance(Number(e.target.value))} aria-label="Relevance: direct links only, or loose connections too" />
          <span>Loose</span>
        </label>
      </div>
      <div className="strip-row">
        <button className="strip-step" onClick={() => onStop(Math.max(0, current - 1))} disabled={current <= 0} aria-label="Previous event on this river">◀</button>
        <div className="strip-window" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {/* The track slides so the current position always sits in the middle. */}
          <div className="strip-track" style={{ transform: `translateX(calc(50% - ${(pos + 0.5) * w}px))` }}>
            {river.stops.map((s, i) => {
              const ev = data.events.find((e) => e.id === s.eventId);
              if (!ev) return null;
              const branch = branches.get(s.eventId);
              return (
                <div key={s.eventId} className={`stop ${i === current ? 'current' : ''}`} style={{ width: w }}>
                  <button
                    className="stop-btn"
                    onClick={() => tapped() && onStop(i)}
                    title={s.path.length ? `Why it's here: ${s.path.join(' → ')}` : 'Where this river starts'}
                    aria-current={i === current ? 'true' : undefined}
                  >
                    <i style={{ background: FIELD_COLOR[ev.field] }} />
                    <small>{formatShort(resolveEventDate(ev, data).date)}{s.eventId === river.anchorId ? ' · start' : ''}</small>
                    <span>{ev.title}</span>
                  </button>
                  {branch !== undefined && (
                    <button className="stop-branch" onClick={() => tapped() && onBranch(s.eventId)} aria-label={`Switch to the river through ${ev.title}: ${branch} more events`} title={`Another topic river crosses here: ${branch} more events`}>
                      ⑂{branch}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <button className="strip-step" onClick={() => onStop(Math.min(last, current + 1))} disabled={current >= last} aria-label="Next event on this river">▶</button>
      </div>
    </div>
  );
}
