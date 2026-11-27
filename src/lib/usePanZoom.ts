// Pan (drag) and zoom (pinch, wheel, buttons) for an SVG, without any library.
//
// The view is a simple transform: screen = world × k + (x, y).
//   • one finger / mouse drag  → pan
//   • two fingers              → pinch-zoom around the point between them (and pan)
//   • mouse wheel / trackpad   → zoom around the cursor (trackpad pinch arrives as ctrl+wheel)
//                                — unless `onPlainWheel` is given: then a plain scroll is handed to
//                                it (the claim map uses that to glide along the topic river) and
//                                only Ctrl+scroll / pinch zooms
// Clicks still work: if the pointer moved more than a few pixels it counts as a drag,
// and `wasDrag()` tells click handlers to ignore that click.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface View {
  x: number;
  y: number;
  k: number; // zoom: 1 = one world unit per screen pixel
}

export interface PanZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  onPlainWheel?: (deltaY: number) => void;
}

const DRAG_THRESHOLD_PX = 6;

export function usePanZoom(ref: RefObject<SVGSVGElement>, initial: View, { minZoom = 0.2, maxZoom = 4, onPlainWheel }: PanZoomOptions = {}) {
  const plainWheel = useRef(onPlainWheel);
  plainWheel.current = onPlainWheel;
  const [view, setView] = useState<View>(initial);
  const viewRef = useRef(view);
  viewRef.current = view;

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);
  const travelled = useRef(0);

  const clampK = useCallback((k: number) => Math.max(minZoom, Math.min(maxZoom, k)), [minZoom, maxZoom]);

  /** Zoom by a factor while keeping the screen point (sx, sy) fixed under the finger/cursor. */
  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      setView((v) => {
        const k = clampK(v.k * factor);
        const f = k / v.k;
        return { k, x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f };
      });
    },
    [clampK],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const down = (e: PointerEvent) => {
      if (pointers.current.size === 0) {
        dragged.current = false;
        travelled.current = 0;
      }
      pointers.current.set(e.pointerId, local(e));
    };

    const move = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const now = local(e);
      const pts = [...pointers.current.entries()];

      if (pts.length === 1) {
        // Pan.
        const dx = now.x - prev.x;
        const dy = now.y - prev.y;
        travelled.current += Math.hypot(dx, dy);
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      } else if (pts.length >= 2) {
        // Pinch: compare the two-finger distance and midpoint before and after this move.
        const other = pts.find(([id]) => id !== e.pointerId)![1];
        const before = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
        const after = Math.hypot(now.x - other.x, now.y - other.y) || 1;
        const midBefore = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
        const midAfter = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
        travelled.current += DRAG_THRESHOLD_PX; // a pinch is never a tap
        setView((v) => {
          const k = clampK(v.k * (after / before));
          const f = k / v.k;
          return {
            k,
            x: midAfter.x - (midBefore.x - v.x) * f,
            y: midAfter.y - (midBefore.y - v.y) * f,
          };
        });
      }
      if (travelled.current > DRAG_THRESHOLD_PX) dragged.current = true;
      pointers.current.set(e.pointerId, now);
    };

    const up = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (plainWheel.current && !e.ctrlKey && !e.metaKey) {
        plainWheel.current(e.deltaY);
        return;
      }
      const p = local(e);
      // ctrl+wheel is how trackpads report a pinch; it needs a stronger factor.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(factor, p.x, p.y);
    };

    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [ref, clampK, zoomAt]);

  /** True if the pointer gesture that just ended was a drag/pinch rather than a tap. */
  const wasDrag = useCallback(() => dragged.current, []);

  /** Zoom around the middle of the SVG (for the + / − buttons). */
  const zoomBy = useCallback(
    (factor: number) => {
      const el = ref.current;
      if (!el) return;
      zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
    },
    [ref, zoomAt],
  );

  return { view, setView, wasDrag, zoomBy };
}
