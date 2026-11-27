// A small line chart of public opinion over time, with related events marked as
// dashed lines. It shows correlation only — causal claims belong in the claim map.
import type { Dataset, OpinionSeries } from '../types';
import { formatYear } from '../lib/time';

// Chart size and padding, in SVG units (the SVG scales to fit its column).
const W = 340;
const H = 180;
const P = { l: 30, r: 10, t: 14, b: 24 };

export function OpinionChart({ series, data }: { series: OpinionSeries; data: Dataset }) {
  const xs = series.points.map((p) => p.at);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  // Map a year / percentage to chart coordinates.
  const sx = (x: number) => P.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - P.l - P.r);
  const sy = (y: number) => H - P.b - (y / 100) * (H - P.t - P.b);
  const d = series.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.at)},${sy(p.value)}`).join(' ');
  const events = series.linkedEventIds.map((id) => data.events.find((e) => e.id === id)!).filter((e) => e && e.date.best >= x0 && e.date.best <= x1);

  return (
    <section className="chart">
      <h4>Opinion over time</h4>
      <p className="muted">{series.title}</p>
      {series.demo && <div className="demo-flag">Fictional numbers — demo only</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        {[0, 25, 50, 75, 100].map((y) => (
          <g key={y}>
            <line x1={P.l} x2={W - P.r} y1={sy(y)} y2={sy(y)} stroke="#222b3d" />
            <text x={P.l - 6} y={sy(y) + 3} fontSize="9" fill="#6b7590" textAnchor="end">{y}</text>
          </g>
        ))}
        {events.map((e) => (
          <g key={e.id}>
            <line x1={sx(e.date.best)} x2={sx(e.date.best)} y1={P.t} y2={H - P.b} stroke="#f5b83d" strokeDasharray="3 3" strokeOpacity={0.7} />
            <text x={sx(e.date.best) + 2} y={P.t + 8} fontSize="8" fill="#f5b83d">{e.title.slice(0, 18)}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke="#7aa2ff" strokeWidth={2.5} />
        {series.points.map((p) => (
          <circle key={p.at} cx={sx(p.at)} cy={sy(p.value)} r={3} fill="#7aa2ff"><title>{`${formatYear(p.at)}: ${p.value}${series.unit} — ${p.source}`}</title></circle>
        ))}
        <text x={P.l} y={H - 6} fontSize="9" fill="#6b7590">{formatYear(x0)}</text>
        <text x={W - P.r} y={H - 6} fontSize="9" fill="#6b7590" textAnchor="end">{formatYear(x1)}</text>
      </svg>
      <small className="muted">Dashed lines = events that coincide with shifts. Correlation isn’t causation — causal claims go in the map with their own evidence.</small>
    </section>
  );
}
