import { riskColor, formatTime } from '../utils/format';

const CLASSIFICATION = {
  HIGH: 'Possible synthetic / cloned voice',
  SUSPICIOUS: 'Uncertain voice characteristics',
  LOW: 'Consistent with natural speech',
};

export default function HistoryView({ history, onSelect, loading }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <span className="display" style={{ fontSize: 18, fontWeight: 700 }}>
          Analysis History
        </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {history.length} record{history.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && <div className="panel-empty">Loading history…</div>}

      {!loading && history.length === 0 && (
        <div className="panel-empty">No analyses yet. Run one from the Dashboard to see it appear here.</div>
      )}

      {!loading && history.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11.5, letterSpacing: '0.06em' }}>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>TIMESTAMP</th>
                <th style={thStyle}>SOURCE</th>
                <th style={thStyle}>LANG</th>
                <th style={thStyle}>DURATION</th>
                <th style={thStyle}>TRUST</th>
                <th style={thStyle}>RISK</th>
                <th style={thStyle}>CLASSIFICATION</th>
                <th style={thStyle}>VERIFICATION</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr
                  key={h.analysis_id}
                  onClick={() => onSelect(h.analysis_id)}
                  style={{ cursor: 'pointer', borderTop: '1px solid var(--border-hairline)' }}
                  className="history-row"
                >
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{h.analysis_id}</td>
                  <td style={tdStyle}>{formatTime(h.created_at)}</td>
                  <td style={{ ...tdStyle, textTransform: 'capitalize' }}>{h.source_label || h.source}</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{h.language || '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{h.duration_seconds}s</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: riskColor(h.risk_level) }}>
                    {h.trust_score ?? 100 - h.risk_score}
                  </td>
                  <td style={tdStyle}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: riskColor(h.risk_level),
                        border: `1px solid ${riskColor(h.risk_level)}`,
                        borderRadius: 4,
                        padding: '1px 6px',
                      }}
                    >
                      {h.risk_level}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    {CLASSIFICATION[h.risk_level] || '—'}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    {h.verification_status || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle = { padding: '8px 10px', fontWeight: 600 };
const tdStyle = { padding: '10px 10px', color: 'var(--text-primary)' };
