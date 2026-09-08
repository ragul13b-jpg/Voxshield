import { formatTime } from '../utils/format';

export default function IncidentReport({ analysis, open, onClose }) {
  if (!open || !analysis) return null;

  const handlePrint = () => {
    document.body.classList.add('print-report');
    window.print();
    setTimeout(() => document.body.classList.remove('print-report'), 300);
  };

  const handleDownload = () => {
    const text = buildReportText(analysis);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${analysis.analysis_id}-incident-report.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const layers = analysis.analysis_layers || {};

  return (
    <div
      className="print-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4,6,10,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 600,
          maxHeight: '85vh',
          overflowY: 'auto',
          background: '#0E141C',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          padding: 0,
        }}
      >
        <div
          className="incident-report-printable"
          style={{ padding: 26, color: '#e7eef5', background: '#0E141C' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="display" style={{ fontSize: 20, fontWeight: 700 }}>
                VoxShield Incident Report
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: '#93A2B4', marginTop: 4 }}>
                {analysis.analysis_id} · generated {formatTime(new Date().toISOString())}
              </div>
            </div>
            <button onClick={onClose} className="btn-icon no-print" aria-label="Close">
              ✕
            </button>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #1E2A38', margin: '18px 0' }} />

          <ReportRow label="Source" value={analysis.source_label || analysis.source} />
          <ReportRow label="Language" value={analysis.language || 'Not specified'} />
          <ReportRow label="Captured" value={formatTime(analysis.created_at)} />
          <ReportRow label="Duration" value={`${analysis.duration_seconds}s`} />
          <ReportRow label="Voice trust score" value={`${analysis.trust_score} / 100`} />
          <ReportRow label="Risk level" value={analysis.risk_level} />
          <ReportRow label="Verification status" value={analysis.verification_status} />

          {Object.entries(layers).map(([layer, items]) =>
            items.length ? (
              <div key={layer} style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{layer}</div>
                <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                  {items.map((i) => (
                    <div key={i.name} style={{ fontSize: 12.5 }}>
                      <strong>{i.name}</strong> — {i.severity} (contribution +{i.contribution})
                      <div style={{ color: '#93A2B4', marginTop: 2 }}>{i.explanation}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null
          )}

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Transcription</div>
            {analysis.transcription?.available ? (
              <div style={{ fontSize: 12.5, color: '#93A2B4' }}>
                "{analysis.transcription.text}"
                {analysis.transcription.language_used ? ` (${analysis.transcription.language_used})` : ''}
                {analysis.transcription.confidence != null
                  ? ` — approx. confidence ${Math.round(analysis.transcription.confidence * 100)}%`
                  : ''}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: '#93A2B4', fontStyle: 'italic' }}>
                {analysis.transcription?.message || 'Transcription unavailable or low confidence for this audio.'}
              </div>
            )}
          </div>

          {analysis.context && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Context</div>
              <div style={{ fontSize: 12.5, color: '#93A2B4' }}>
                Caller: {analysis.context.input?.caller_name || 'Not provided'}<br />
                Contact status: {analysis.context.input?.contact_status || 'unspecified'}<br />
                Transaction: {analysis.context.input?.transaction_type || 'none'}
                {analysis.context.input?.amount_inr ? ` — ₹${Number(analysis.context.input.amount_inr).toLocaleString('en-IN')}` : ''}
                <br />
                Contextual risk level: {analysis.context.level} ({Math.round(analysis.context.risk_fraction * 100)}%)
              </div>
            </div>
          )}

          <div style={{ marginTop: 18, marginBottom: 8, fontSize: 13, fontWeight: 700 }}>Decision</div>
          <p style={{ fontSize: 12.5, color: '#93A2B4', margin: 0 }}>{analysis.recommendation}</p>

          <div style={{ marginTop: 14, fontSize: 11, color: '#5C6B7E' }}>{analysis.privacy_note}</div>

          <div style={{ marginTop: 14, fontSize: 10.5, color: '#5C6B7E', fontWeight: 600 }}>
            Prototype — not a production-grade voice authentication system. Built for SIH26104;
            heuristic acoustic + contextual risk analysis, not forensic-grade proof of identity.
          </div>
        </div>

        <div className="no-print" style={{ display: 'flex', gap: 10, padding: '0 26px 26px' }}>
          <button onClick={handlePrint} className="btn-primary" style={{ flex: 1 }}>
            Print / Save as PDF
          </button>
          <button onClick={handleDownload} className="btn-outline" style={{ flex: 1 }}>
            Download .txt
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span style={{ color: '#93A2B4' }}>{label}</span>
      <span className="mono" style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function buildReportText(a) {
  const lines = [
    'VOXSHIELD INCIDENT REPORT',
    `Analysis ID: ${a.analysis_id}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    `Source: ${a.source_label || a.source}`,
    `Language: ${a.language || 'Not specified'}`,
    `Captured: ${a.created_at}`,
    `Duration: ${a.duration_seconds}s`,
    `Voice trust score: ${a.trust_score}/100`,
    `Risk level: ${a.risk_level}`,
    `Verification status: ${a.verification_status}`,
    '',
  ];

  const layers = a.analysis_layers || {};
  for (const [layer, items] of Object.entries(layers)) {
    if (!items.length) continue;
    lines.push(layer.toUpperCase());
    for (const i of items) {
      lines.push(`- ${i.name} [${i.severity}] (+${i.contribution}): ${i.explanation}`);
    }
    lines.push('');
  }

  lines.push('TRANSCRIPTION');
  if (a.transcription?.available) {
    lines.push(
      `"${a.transcription.text}"` +
        (a.transcription.language_used ? ` (${a.transcription.language_used})` : '') +
        (a.transcription.confidence != null ? ` — approx. confidence ${Math.round(a.transcription.confidence * 100)}%` : '')
    );
  } else {
    lines.push(a.transcription?.message || 'Transcription unavailable or low confidence for this audio.');
  }
  lines.push('');

  if (a.context) {
    lines.push('CONTEXT');
    lines.push(`Caller: ${a.context.input?.caller_name || 'Not provided'}`);
    lines.push(`Contact status: ${a.context.input?.contact_status || 'unspecified'}`);
    lines.push(`Transaction: ${a.context.input?.transaction_type || 'none'}`);
    lines.push(`Contextual risk level: ${a.context.level} (${Math.round(a.context.risk_fraction * 100)}%)`);
    lines.push('');
  }

  lines.push('DECISION');
  lines.push(a.recommendation);
  lines.push('');
  lines.push(a.privacy_note || '');
  lines.push('');
  lines.push('Prototype — not a production-grade voice authentication system. Built for SIH26104;');
  lines.push('heuristic acoustic + contextual risk analysis, not forensic-grade proof of identity.');

  return lines.join('\n');
}
