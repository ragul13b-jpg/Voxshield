const PREVENTION_TIPS = [
  "Don't transfer money",
  "Don't share OTP or PIN codes",
  "Don't share passwords",
  "Don't disclose confidential information",
  'Verify using another communication channel',
];

export default function WarningBanner({ riskLevel, recommendation }) {
  if (riskLevel !== 'HIGH' && riskLevel !== 'SUSPICIOUS') return null;

  const isHigh = riskLevel === 'HIGH';
  const color = isHigh ? 'var(--signal-red)' : 'var(--signal-amber)';
  const bg = isHigh ? 'var(--signal-red-dim)' : 'var(--signal-amber-dim)';

  return (
    <div
      style={{
        border: `1px solid ${color}`,
        background: bg,
        borderRadius: 'var(--radius-md)',
        padding: '18px 20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>{isHigh ? '🚨' : '⚠️'}</span>
        <span className="display" style={{ fontSize: 17, fontWeight: 700, color, letterSpacing: '0.02em' }}>
          {isHigh ? 'POSSIBLE VOICE CLONING DETECTED' : 'UNCERTAIN VOICE AUTHENTICITY'}
        </span>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6 }}>
        {recommendation}
      </p>
      {isHigh && (
        <ul style={{ margin: '12px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
          {PREVENTION_TIPS.map((tip) => (
            <li key={tip} style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {tip}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
