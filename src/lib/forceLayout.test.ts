// Tests that the claim-map layout keeps labels off lines and things from overlapping.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, layoutIssues, layoutStar, segmentHitsBox, type LayoutItem } from './forceLayout';

/** Fake bubbles of mixed sizes with labels of mixed widths, like a real map. */
function items(n: number, scale = 1): LayoutItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    r: (22 + ((i * 7) % 20)) * scale,
    labelW: (90 + ((i * 37) % 80)) * scale,
    labelH: (34 + (i % 3) * 15) * scale,
  }));
}

describe('force layout', () => {
  it('detects a line through a box', () => {
    expect(segmentHitsBox(0, 0, 100, 0, { x: 50, y: 0, w: 10, h: 10 }, 0)).toBe(true);
    expect(segmentHitsBox(0, 0, 100, 0, { x: 50, y: 30, w: 10, h: 10 }, 0)).toBe(false);
  });

  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16]) {
    it(`${n} bubbles: no label crosses a line and nothing overlaps (desktop)`, () => {
      const placed = layoutStar(items(n));
      expect(layoutIssues(placed)).toEqual({ labelLineCrossings: 0, overlaps: 0 });
    });

    it(`${n} bubbles: same on mobile sizes`, () => {
      const opts = { ...DEFAULT_LAYOUT, centerR: 80, linkLength: 70, padding: 11 };
      const placed = layoutStar(items(n, 1.35), opts);
      expect(layoutIssues(placed, opts)).toEqual({ labelLineCrossings: 0, overlaps: 0 });
    });
  }

  it('is deterministic', () => {
    expect(layoutStar(items(6))).toEqual(layoutStar(items(6)));
  });
});
