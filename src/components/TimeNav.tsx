// Controls on top of the main river:
//   • ScaleBar    — "Full river · Period · Years · Months · Weeks · Days" under the big date,
//                   with the current level as a highlighted pill. Click a level to jump there
//                   (rules in src/lib/viewStack.ts). "Period" is greyed out until a period
//                   has been expanded from a cluster of events.
//   • Breadcrumb  — the trail of expansions: "Full river › May 1939 – Jun 1943 › …".
//                   Click a step to go back to it.
//   • OverviewBar — a thin bar showing all of history, with the expanded window highlighted
//                   and a marker for where you are. Tap or drag along it to travel.
import type { ScaleLevel, TimeWindow } from '../lib/timeScale';
import { LEVEL_LABEL, SCALE_LEVELS, windowLabel, YEAR_MAX, YEAR_MIN } from '../lib/timeScale';
import { yearToS } from '../lib/time';
import { formatYear } from '../lib/dates';

interface ScaleBarProps {
  level: ScaleLevel;
  periodAvailable: boolean;
  onChoose: (level: ScaleLevel) => void;
}

export function ScaleBar({ level, periodAvailable, onChoose }: ScaleBarProps) {
  return (
    <div className="scale-bar" role="radiogroup" aria-label="Time scale">
      {SCALE_LEVELS.map((l) => {
        const disabled = l === 'period' && !periodAvailable;
        return (
          <button
            key={l}
            role="radio"
            aria-checked={l === level}
            className={l === level ? 'on' : ''}
            disabled={disabled}
            title={disabled ? 'Expand a cluster of events first: click overlapping bubbles, then "Expand these events"' : undefined}
            onClick={() => l !== level && onChoose(l)}
          >
            {LEVEL_LABEL[l]}
          </button>
        );
      })}
    </div>
  );
}

interface CrumbProps {
  labels: string[];
  onGoTo: (index: number) => void;
}

export function Breadcrumb({ labels, onGoTo }: CrumbProps) {
  if (labels.length < 2) return null; // just "Full river": nothing to go back to
  return (
    <nav className="view-crumbs" aria-label="Expanded periods">
      <ol>
        {labels.map((label, i) => (
          <li key={i}>
            {i > 0 && <span className="sep" aria-hidden>›</span>}
            <button className={i === labels.length - 1 ? 'active' : ''} aria-current={i === labels.length - 1 ? 'true' : undefined} onClick={() => i < labels.length - 1 && onGoTo(i)}>
              {label}
            </button>
          </li>
        ))}
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
  // Tap to jump, or keep your finger down and drag along the bar to travel.
  const travelTo = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onTravel(fromPct(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    travelTo(e);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) travelTo(e);
  };
  const w = window ? { left: pct(window.start), width: Math.max(0.6, pct(window.end) - pct(window.start)) } : null;

  return (
    <div className="overview" role="slider" aria-label="Where you are in all of history" aria-valuetext={formatYear(year)} aria-valuenow={Math.round(year)} aria-valuemin={YEAR_MIN} aria-valuemax={YEAR_MAX} tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
      {OVERVIEW_TICKS.map((t) => (
        <span key={t} className={`ov-tick ${MINOR_TICKS.has(t) ? 'minor' : ''}`} style={{ left: `${pct(t)}%` }}>{formatYear(t)}</span>
      ))}
      {w && <div className="ov-window" style={{ left: `${w.left}%`, width: `${w.width}%` }} title={`Expanded: ${windowLabel(window)}`} />}
      <div className="ov-here" style={{ left: `${pct(year)}%` }} />
    </div>
  );
}
