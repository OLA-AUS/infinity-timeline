// Tests for the scale bar's anchoring rules, nested expansion and collapse, and Continue.
import { describe, expect, it } from 'vitest';
import { ymdToYear, yearToYmd } from './dates';
import {
  chooseLevel,
  collapse,
  continueWindow,
  crumbs,
  currentLevel,
  expandCluster,
  FULL_RIVER,
  goToStep,
  periodAvailable,
  periodWindow,
  unitStart,
  type ViewStack,
} from './viewStack';

const ymd = (y: number, m: number, d: number) => ymdToYear(y, m, d, 0);
const camera = ymdToYear(1941, 8, 14); // Thursday 14 Aug 1941, midday
const day = (t: number) => yearToYmd(t + 1e-7);

describe('scale bar anchoring rules', () => {
  it('Years → 1 Jan of the year shown', () => {
    const c = chooseLevel(FULL_RIVER, 'years', camera)!;
    expect(c.anchor).toEqual({ at: ymd(1941, 1, 1) });
    expect(c.stack[1].window).toMatchObject({ level: 'years', start: 1940, end: 1950, tick: 'years' });
  });

  it('Months → the 1st of the month shown', () => {
    const c = chooseLevel(FULL_RIVER, 'months', camera)!;
    expect(c.anchor).toEqual({ at: ymd(1941, 8, 1) });
    expect(c.stack[1].window).toMatchObject({ level: 'months', start: 1941, end: 1942 });
  });

  it('Weeks → that week\'s Monday', () => {
    const c = chooseLevel(FULL_RIVER, 'weeks', camera)!;
    expect(day((c.anchor as { at: number }).at)).toEqual({ y: 1941, m: 8, d: 11 }); // Monday 11 Aug 1941
    const w = c.stack[1].window!;
    expect(day(w.start)).toEqual({ y: 1941, m: 7, d: 1 }); // the quarter Jul–Sep
  });

  it('Days → the 1st of the month in view, or the start of a short expanded period', () => {
    expect(chooseLevel(FULL_RIVER, 'days', camera)!.anchor).toEqual({ at: ymd(1941, 8, 1) });
    const short = expandCluster(FULL_RIVER, [ymd(1941, 8, 10), ymd(1941, 8, 20)]).stack; // ~10 days
    const p = short[1].window!;
    expect(unitStart('days', camera, short)).toBeCloseTo(p.start);
    const c = chooseLevel(short, 'days', camera)!;
    expect(c.stack[2].window).toMatchObject({ level: 'days', start: p.start, end: p.end });
  });

  it('a selected event\'s date wins over the start of the unit', () => {
    const sel = ymdToYear(1941, 12, 7);
    const c = chooseLevel(FULL_RIVER, 'months', camera, sel)!;
    expect(c.anchor).toEqual({ at: sel });
    expect(c.stack[1].window).toMatchObject({ start: 1941 });
  });

  it('switching unit levels replaces the unit step instead of piling them up', () => {
    const a = chooseLevel(FULL_RIVER, 'years', camera)!.stack;
    const b = chooseLevel(a, 'days', camera)!.stack;
    expect(b).toHaveLength(2);
    expect(currentLevel(b)).toBe('days');
  });

  it('Full river and Period go back without moving in time', () => {
    const p = expandCluster(FULL_RIVER, [1939.4, 1943.4]).stack;
    const d = chooseLevel(p, 'days', camera)!.stack;
    expect(chooseLevel(d, 'full', camera)).toEqual({ stack: FULL_RIVER, anchor: { camera: true } });
    expect(chooseLevel(d, 'period', camera)).toEqual({ stack: p, anchor: { camera: true } });
  });

  it('Period is greyed out until a period is expanded', () => {
    expect(periodAvailable(FULL_RIVER)).toBe(false);
    expect(chooseLevel(FULL_RIVER, 'period', camera)).toBeNull();
    expect(periodAvailable(chooseLevel(FULL_RIVER, 'months', camera)!.stack)).toBe(false);
    expect(periodAvailable(expandCluster(FULL_RIVER, [1940, 1941]).stack)).toBe(true);
  });
});

describe('expanding clusters', () => {
  it('expands exactly the span plus about 5% each side, and flies to the first event', () => {
    const first = ymd(1939, 5, 10);
    const last = ymd(1943, 6, 20);
    const c = expandCluster(FULL_RIVER, [last, first, ymd(1941, 1, 1)]);
    const w = c.stack[1].window!;
    const span = last - first;
    expect(w.start).toBeCloseTo(first - 0.05 * span);
    expect(w.end).toBeCloseTo(last + 0.05 * span);
    expect(w.tick).toBe('years');
    expect(c.anchor).toEqual({ at: first });
    expect(crumbs(c.stack)).toEqual(['Full river', 'Feb 1939 – Sep 1943']); // ~2½ months of padding each side
  });

  it('a cluster all on one day still opens up', () => {
    const w = periodWindow(ymd(1944, 6, 6), ymd(1944, 6, 6));
    expect(w.end - w.start).toBeGreaterThan(0);
    expect(w.tick).toBe('days');
  });

  it('nests: expand inside an expanded period, then collapse back out step by step', () => {
    const outer = expandCluster(FULL_RIVER, [1939.4, 1943.4]).stack;
    const inner = expandCluster(outer, [1940.5, 1940.8]).stack;
    const innermost = expandCluster(inner, [ymd(1940, 8, 13), ymd(1940, 8, 18)]).stack;
    expect(innermost).toHaveLength(4);
    expect(innermost[3].window!.tick).toBe('days');
    expect(collapse(innermost).stack).toEqual(inner);
    expect(collapse(collapse(innermost).stack).stack).toEqual(outer);
    expect(collapse(outer).stack).toEqual(FULL_RIVER);
    expect(collapse(FULL_RIVER).stack).toEqual(FULL_RIVER); // can't collapse past the full river
  });

  it('clicking a breadcrumb step goes back to exactly that step, staying in place', () => {
    const outer = expandCluster(FULL_RIVER, [1939.4, 1943.4]).stack;
    const inner = expandCluster(outer, [1940.5, 1940.8]).stack;
    expect(goToStep(inner, 1)).toEqual({ stack: outer, anchor: { camera: true } });
    expect(goToStep(inner, 0).stack).toEqual(FULL_RIVER);
  });
});

describe('Continue', () => {
  it('slides the window by its own length and keeps the camera at the same place within it', () => {
    const stack: ViewStack = expandCluster(FULL_RIVER, [1939.4, 1943.4]).stack;
    const w = stack[1].window!;
    const len = w.end - w.start;
    const fwd = continueWindow(stack, 1)!;
    expect(fwd.stack[1].window!.start).toBeCloseTo(w.start + len);
    expect(fwd.stack[1].window!.end).toBeCloseTo(w.end + len);
    expect(fwd.anchor).toEqual({ camera: true, shift: len });
    const back = continueWindow(fwd.stack, -1)!;
    expect(back.stack[1].window!.start).toBeCloseTo(w.start);
    expect(continueWindow(FULL_RIVER, 1)).toBeNull();
  });
});
