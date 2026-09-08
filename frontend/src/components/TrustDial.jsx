import { useMemo } from 'react';
import { riskColor } from '../utils/format';

const START_ANGLE = -130;
const END_ANGLE = 130;
const SWEEP = END_ANGLE - START_ANGLE;

function polar(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, a0, a1) {
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

export default function TrustDial({ score = null, riskLevel = 'LOW', analyzing = false, size = 260 }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  const value = score ?? 0;
  const valueAngle = START_ANGLE + (SWEEP * Math.min(100, Math.max(0, value))) / 100;
  const color = riskColor(riskLevel);

  const ticks = useMemo(() => {
    const arr = [];
    for (let i = 0; i <= 10; i++) {
      const angle = START_ANGLE + (SWEEP * i) / 10;
      const major = i % 5 === 0;
      const outer = polar(cx, cy, r + 6, angle);
      const inner = polar(cx, cy, r + (major ? -2 : 2), angle);
      arr.push({ key: i, outer, inner, major });
    }
    return arr;
  }, [cx, cy, r]);

  const needleTip = polar(cx, cy, r - 14, valueAngle);
  const needleBase = polar(cx, cy, 10, valueAngle - 180);

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="dial-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FF4757" />
            <stop offset="50%" stopColor="#F5A623" />
            <stop offset="100%" stopColor="#2BD97C" />
          </linearGradient>
        </defs>

        {/* background track */}
        <path
          d={arcPath(cx, cy, r, START_ANGLE, END_ANGLE)}
          fill="none"
          stroke="var(--border-hairline)"
          strokeWidth={10}
          strokeLinecap="round"
        />

        {/* value arc */}
        <path
          d={arcPath(cx, cy, r, START_ANGLE, valueAngle)}
          fill="none"
          stroke="url(#dial-gradient)"
          strokeWidth={10}
          strokeLinecap="round"
          style={{ transition: 'd 0.6s cubic-bezier(.4,1.4,.4,1)' }}
        />

        {/* ticks */}
        {ticks.map((t) => (
          <line
            key={t.key}
            x1={t.inner.x}
            y1={t.inner.y}
            x2={t.outer.x}
            y2={t.outer.y}
            stroke="var(--text-muted)"
            strokeWidth={t.major ? 2 : 1}
          />
        ))}

        {/* needle */}
        {score !== null && (
          <g style={{ transition: 'transform 0.6s cubic-bezier(.4,1.4,.4,1)' }}>
            <line
              x1={needleBase.x}
              y1={needleBase.y}
              x2={needleTip.x}
              y2={needleTip.y}
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r={6} fill={color} />
            <circle cx={cx} cy={cy} r={10} fill="none" stroke={color} strokeOpacity={0.4} strokeWidth={1.5} />
          </g>
        )}

        {analyzing && (
          <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'vox-sweep 1.4s linear infinite' }}>
            <line x1={cx} y1={cy} x2={cx} y2={cy - r} stroke="var(--signal-cyan)" strokeWidth={2} opacity={0.55} />
          </g>
        )}
      </svg>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: size * 0.12,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: size * 0.19,
            fontWeight: 600,
            color: score === null ? 'var(--text-muted)' : color,
            lineHeight: 1,
            letterSpacing: '-0.02em',
          }}
        >
          {score === null ? '--' : score}
          <span style={{ fontSize: size * 0.08, color: 'var(--text-muted)' }}>/100</span>
        </div>
        <div
          className="display"
          style={{
            marginTop: 8,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.12em',
            color: score === null ? 'var(--text-muted)' : color,
          }}
        >
          {analyzing ? 'ANALYZING…' : score === null ? 'AWAITING AUDIO' : riskLevel === 'HIGH' ? 'HIGH RISK' : riskLevel}
        </div>
      </div>

      <style>{`
        @keyframes vox-sweep {
          0% { opacity: 0; }
          10% { opacity: 0.7; }
          100% { opacity: 0; transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
