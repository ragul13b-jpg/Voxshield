export default function ThreatTimeline({ events = [] }) {
  if (!events.length) {
    return <div className="panel-empty">Timeline will populate after analysis.</div>;
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <div
        style={{
          position: 'absolute',
          left: 5,
          top: 6,
          bottom: 6,
          width: 1,
          background: 'var(--border-hairline)',
        }}
      />
      {events.map((ev, idx) => (
        <div key={idx} style={{ position: 'relative', paddingBottom: idx === events.length - 1 ? 0 : 16 }}>
          <div
            style={{
              position: 'absolute',
              left: -20 + 1.5,
              top: 4,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'var(--bg-panel)',
              border: '2px solid var(--signal-cyan)',
            }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', minWidth: 46 }}>
              {ev.t.toFixed(2)}s
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{ev.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
