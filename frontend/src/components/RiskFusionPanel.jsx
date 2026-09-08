import { riskColor, severityColor } from '../utils/format';

const BAR_WIDTH = 10;

function bar(pct) {
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  return '█'.repeat(Math.max(0, Math.min(BAR_WIDTH, filled))) + '░'.repeat(Math.max(0, BAR_WIDTH - filled));
}

const CLASSIFICATION_TEXT = {
  HIGH: 'Possible synthetic / cloned voice',
  SUSPICIOUS: 'Uncertain voice characteristics',
  LOW: 'Consistent with natural human speech',
};

export default function RiskFusionPanel({ indicators = [], riskScore, riskLevel, humanProbability, syntheticProbability }) {
  if (!indicators.length || riskScore == null) {
    return <div className="panel-empty">Run an analysis to see the risk fusion breakdown.</div>;
  }

  const color = riskColor(riskLevel);
  const confidence = Math.round(Math.max(humanProbability ?? 0, syntheticProbability ?? 0) * 100);

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 10 }}>
        RISK FUSION
      </div>

      <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
        {indicators.map((ind) => {
          const pct = Math.round(Math.max(0, Math.min(1, ind.raw_score)) * 100);
          return (
            <div key={ind.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 150, flexShrink: 0 }}>
                {ind.name}
              </span>
              <span
                className="mono"
                style={{ fontSize: 13, color: severityColor(ind.severity), letterSpacing: '-1px', flexShrink: 0 }}
              >
                {bar(pct)}
              </span>
              <span className="mono" style={{ fontSize: 12, color: severityColor(ind.severity), width: 30, textAlign: 'right' }}>
                {pct}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-hairline)',
          paddingTop: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>OVERALL RISK</div>
          <div className="display" style={{ fontSize: 20, fontWeight: 700, color }}>
            {riskScore}% — {riskLevel === 'HIGH' ? 'HIGH RISK' : riskLevel}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>CLASSIFICATION</div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{CLASSIFICATION_TEXT[riskLevel] || '—'}</div>
        </div>
      </div>

      <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>
        confidence: ~{confidence}% (prototype estimate, not a calibrated probability)
      </div>
    </div>
  );
}
