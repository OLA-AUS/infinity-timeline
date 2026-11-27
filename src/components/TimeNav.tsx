// Controls on top of the main river:
//   • ExpandNav   — shown while time is expanded: "1939 › Sep 1939 › Collapse". Tap the year
//                   to step back out to months, or Collapse to step out one level. Both keep
//                   the moment in the middle of the screen still (same anchoring as expanding).
//                   When not expanded it shows a one-line hint instead.
//   • OverviewBar — a thin bar showing all of history, with the expanded period highlighted
//                   and a marker for where you are. Tap it to travel there.
import type { TimeWindow } from '../lib/timeScale';
import { expandCrumbs, windowLabel, YEAR_MAX, YEAR_MIN } from '../lib/timeScale';
import { yearToS } from '../lib/time';
import { formatYear } from '../lib/dates';

interface NavProps {
  window: TimeWindow | null;
  mobile: boolean;
  onGoTo: (w: TimeWindow | null) => void; // step out to this period (or null = normal)
  onCollapse: () => void; // step out one level
}

export function ExpandNav({ window, mobile, onGoTo, onCollapse }: NavProps) {
  if (!window) {
    return <p className="expand-hint">{mobile ? 'Double-tap the river to expand time' : 'Double-click the river (or press +) to expand time'}</p>;
  }
  const crumbs = expandCrumbs(window);
  return (
    <nav className="expand-nav" aria-label="Expanded time">
      <ol>
        {crumbs.map((c, i) => (
          <li key={c.label}>
            {i > 0 && <span className="sep" aria-hidden>›</span>}
            <button
              className={i === crumbs.length - 1 ? 'active' : ''}
              aria-current={i === crumbs.length - 1 ? 'true' : undefined}
              onClick={() => i < crumbs.length - 1 && onGoTo(c.window)}
              title={i < crumbs.length - 1 ? `Step back out to ${c.label}, month by month` : `Expanded: ${c.label}`}
            >
              {c.label}
            </button>
          </li>
        ))}
        <li>
          <span className="sep" aria-hidden>›</span>
          <button className="collapse" onClick={onCollapse}>Collapse</button>
        </li>
      </ol>
    </nav>
  );
}

interface OverviewProps {
  window: TimeWindow | null;
  year: number; // where the camera is
  onTravel: (year: number) => void;
}

/** Overview ticks: a few landmark years along the full (log-scaled) history. "minor" ones hide on phones. */
const OVERVIEW_TICKS = [-3000, -1000, 0, 1000, 1500, 1800, 1900, 1950, 2000];
const MINOR_TICKS = new Set([-1000, 0, 1000, 1800, 1950]);

export function OverviewBar({ window, year, onTravel }: OverviewProps) {
  // Positions use the plain log scale, so the bar never changes shape when you expand time.
  const s0 = yearToS(YEAR_MIN);
  const s1 = yearToS(YEAR_MAX);
  const pct = (y: number) => ((Math.min(Math.max(yearToS(y), s0), s1) - s0) / (s1 - s0)) * 100;
  const fromPct = (p: number) => {
    // Inverse of pct, by bisection (the log scale has no neat inverse at the clamped end).
    let lo = YEAR_MIN;
    let hi = YEAR_MAX;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (pct(mid) < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onTravel(fromPct(((e.clientX - r.left) / r.width) * 100));
  };
  const w = window ? { left: pct(window.start), width: Math.max(0.6, pct(window.end) - pct(window.start)) } : null;

  return (
    <div className="overview" role="slider" aria-label="Where you are in all of history" aria-valuetext={formatYear(year)} aria-valuenow={Math.round(year)} aria-valuemin={YEAR_MIN} aria-valuemax={YEAR_MAX} tabIndex={0} onClick={onClick}>
      {OVERVIEW_TICKS.map((t) => (
        <span key={t} className={`ov-tick ${MINOR_TICKS.has(t) ? 'minor' : ''}`} style={{ left: `${pct(t)}%` }}>{formatYear(t)}</span>
      ))}
      {w && <div className="ov-window" style={{ left: `${w.left}%`, width: `${w.width}%` }} title={`Expanded: ${windowLabel(window)}`} />}
      <div className="ov-here" style={{ left: `${pct(year)}%` }} />
    </div>
  );
}
