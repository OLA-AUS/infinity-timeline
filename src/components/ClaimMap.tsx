import { useMemo } from 'react';
import type { Claim, Dataset } from '../types';
import { claimStatus, STATUS_COLOR } from '../lib/status';
import { sourceTrust } from '../lib/trust';
import { formatYear } from '../lib/time';
import { ClaimDetail } from './ClaimDetail';
import { OpinionChart } from './OpinionChart';

export type Focus = { kind: 'event' | 'topic' | 'claim'; id: string };

interface Props {
  data: Dataset;
  path: Focus[];
  setPath: (p: Focus[]) => void;
  onClose: () => void;
  onOpenSource: (id: string) => void;
  onOpenEntity: (id: string) => void;
  onVote: (kind: 'agree' | 'well_sourced', id: string, value: 1 | -1) => void;
}

interface Node {
  key: string;
  label: string;
  sub?: string;
  color: string;
  ring?: string;
  size: number;
  onClick: () => void;
}

const W = 760;
const H = 560;

export function ClaimMap({ data, path, setPath, onClose, onOpenSource, onOpenEntity, onVote }: Props) {
  const focus = path[path.length - 1];
  const push = (f: Focus) => setPath([...path, f]);

  const { center, children } = useMemo(() => {
    const kids: Node[] = [];
    let center: { label: string; sub: string; color: string };

    const claimNode = (c: Claim): Node => {
      const st = claimStatus(c, data);
      const stanceTag = c.stance ? `${c.stance} · ` : '';
      return {
        key: c.id,
        label: c.text,
        sub: `${stanceTag}${st.status}`,
        color: STATUS_COLOR[st.status],
        size: 34 + Math.min(20, (c.agree.up + c.agree.down) / 120),
        onClick: () => push({ kind: 'claim', id: c.id }),
      };
    };

    if (focus.kind === 'event') {
      const ev = data.events.find((e) => e.id === focus.id)!;
      center = { label: ev.title, sub: formatYear(ev.at), color: '#ffffff' };
      for (const tid of ev.topicIds) {
        const t = data.topics.find((x) => x.id === tid)!;
        kids.push({ key: t.id, label: t.title, sub: `${t.claimIds.length} claims`, color: '#7aa2ff', size: 46, onClick: () => push({ kind: 'topic', id: t.id }) });
      }
    } else if (focus.kind === 'topic') {
      const t = data.topics.find((x) => x.id === focus.id)!;
      center = { label: t.title, sub: 'debate', color: '#7aa2ff' };
      for (const cid of t.claimIds) kids.push(claimNode(data.claims.find((c) => c.id === cid)!));
    } else {
      const c = data.claims.find((x) => x.id === focus.id)!;
      const st = claimStatus(c, data);
      center = { label: c.text, sub: st.status, color: STATUS_COLOR[st.status] };
      for (const cid of c.childClaimIds) kids.push(claimNode(data.claims.find((x) => x.id === cid)!));
      for (const e of data.evidence.filter((x) => x.claimId === c.id)) {
        const s = data.sources.find((x) => x.id === e.sourceId)!;
        const trust = sourceTrust(s, data).score;
        kids.push({
          key: e.id,
          label: s.title,
          sub: `${e.direction === 'for' ? 'evidence for' : 'counter-evidence'} · trust ${Math.round(trust)}`,
          color: e.direction === 'for' ? '#3ddc97' : '#ff5c6c',
          ring: s.conflictOfInterest ? '#ffcc00' : undefined,
          size: 18 + trust / 4,
          onClick: () => onOpenSource(s.id),
        });
      }
    }
    return { center: center!, children: kids };
  }, [data, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) * 0.36;
  const placed = children.map((n, i) => {
    const a = (i / Math.max(1, children.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...n, x: cx + Math.cos(a) * R * (children.length === 1 ? 0.8 : 1), y: cy + Math.sin(a) * R };
  });

  const crumbLabel = (f: Focus) =>
    f.kind === 'event' ? data.events.find((e) => e.id === f.id)?.title
      : f.kind === 'topic' ? data.topics.find((t) => t.id === f.id)?.title
      : data.claims.find((c) => c.id === f.id)?.text;

  const topicId = focus.kind === 'topic' ? focus.id : focus.kind === 'claim' ? data.claims.find((c) => c.id === focus.id)?.topicId : undefined;
  const series = data.opinions.filter((o) => o.topicId === topicId);

  return (
    <div className="map-overlay">
      <div className="map-header">
        <div className="crumbs">
          {path.map((f, i) => (
            <button key={i} className={i === path.length - 1 ? 'active' : ''} onClick={() => setPath(path.slice(0, i + 1))}>
              {truncate(crumbLabel(f) ?? '', 38)}
            </button>
          ))}
        </div>
        <button className="close" onClick={onClose}>✕ Back to river</button>
      </div>

      <div className="map-body">
        <svg viewBox={`0 0 ${W} ${H}`} className="map-svg">
          <defs>
            <radialGradient id="glow"><stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" /><stop offset="100%" stopColor="#ffffff" stopOpacity="0" /></radialGradient>
          </defs>
          {placed.map((n) => (
            <line key={`l-${n.key}`} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke={n.color} strokeOpacity={0.45} strokeWidth={2} strokeDasharray={n.sub?.startsWith('counter') ? '6 5' : undefined} />
          ))}
          <circle cx={cx} cy={cy} r={110} fill="url(#glow)" />
          <circle cx={cx} cy={cy} r={62} fill="#0d1324" stroke={center.color} strokeWidth={3} />
          <foreignObject x={cx - 58} y={cy - 46} width={116} height={92}>
            <div className="node-text center"><b>{truncate(center.label, 70)}</b><small>{center.sub}</small></div>
          </foreignObject>
          {placed.map((n) => (
            <g key={n.key} className="map-node" onClick={n.onClick}>
              {n.ring && <circle cx={n.x} cy={n.y} r={n.size + 6} fill="none" stroke={n.ring} strokeWidth={2} strokeDasharray="4 3" />}
              <circle cx={n.x} cy={n.y} r={n.size} fill="#0d1324" stroke={n.color} strokeWidth={2.5} />
              <foreignObject x={n.x - 80} y={n.y + n.size + 4} width={160} height={70}>
                <div className="node-text"><b>{truncate(n.label, 64)}</b><small style={{ color: n.color }}>{n.sub}</small></div>
              </foreignObject>
            </g>
          ))}
          {placed.length === 0 && <text x={cx} y={cy + 110} textAnchor="middle" fill="#8892a6">No forks yet — add the first claim.</text>}
        </svg>

        <aside className="map-side">
          {focus.kind === 'claim' ? (
            <ClaimDetail data={data} claimId={focus.id} onOpenSource={onOpenSource} onOpenEntity={onOpenEntity} onVote={onVote} />
          ) : (
            <div className="hint">
              <h3>{center.label}</h3>
              <p>Click a bubble to go deeper. Claims are coloured by their <b>earned status</b>; bubble size shows how much public attention they get.</p>
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
    </div>
  );
}

export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
