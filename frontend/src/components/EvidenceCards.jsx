import { severityColor } from '../utils/format';

export default function EvidenceCards({ indicators = [] }) {
  if (!indicators.length) {
    return (
      <div className="panel-empty">No evidence yet — run an analysis to see detection indicators.</div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      {indicators.map((ind) => {
        const color = severityColor(ind.severity);
        return (
          <div
            key={ind.name}
            style={{
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-hairline)',
              borderLeft: `3px solid ${color}`,
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="display" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.02em' }}>
                {ind.name}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color,
                  border: `1px solid ${color}`,
                  borderRadius: 4,
                  padding: '1px 6px',
                }}
              >
                {ind.severity}
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '8px 0 10px' }}>
              {ind.explanation}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 4, background: 'var(--border-hairline)', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, Math.round(ind.raw_score * 100))}%`,
                    height: '100%',
                    background: color,
                  }}
                />
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                +{ind.contribution}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
