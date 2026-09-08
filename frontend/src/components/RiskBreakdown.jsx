const LABELS = {
  acoustic_score: 'Acoustic & spectral',
  speaker_consistency_score: 'Speaker consistency',
  context_score: 'Contextual risk',
};

export default function RiskBreakdown({ breakdown }) {
  if (!breakdown) return null;

  const rows = Object.entries(LABELS)
    .filter(([key]) => breakdown[key] !== null && breakdown[key] !== undefined)
    .map(([key, label]) => ({ label, value: breakdown[key], weight: breakdown.weights_used?.[key.replace('_score', '')] }));

  if (!rows.length) return null;

  return (
    <div style={{ width: '100%', marginTop: 4 }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 8 }}>
        RISK FUSION BREAKDOWN
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', width: 120, flexShrink: 0 }}>{r.label}</span>
            <div style={{ flex: 1, height: 5, background: 'var(--border-hairline)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${r.value}%`, height: '100%', background: 'var(--signal-cyan)' }} />
            </div>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', width: 28, textAlign: 'right' }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
        Weights renormalize to the signals available for this analysis — audio-only runs use 100%
        acoustic weight.
      </div>
    </div>
  );
}
