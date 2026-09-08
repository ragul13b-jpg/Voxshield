export default function TranscriptionPanel({ transcription, engineStatus }) {
  if (!transcription) {
    return <div className="panel-empty">Run an analysis to see transcribed speech.</div>;
  }

  const { available, text, confidence, language_used, message } = transcription;

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 8 }}>
        TRANSCRIPTION {language_used ? `· ${language_used.toUpperCase()}` : ''}
      </div>

      {available ? (
        <>
          <div
            style={{
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              fontSize: 14,
              color: 'var(--text-primary)',
              fontStyle: 'italic',
            }}
          >
            "{text}"
          </div>
          {confidence != null && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              approx. confidence: {Math.round(confidence * 100)}%
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {message || 'Transcription unavailable or low confidence for this audio.'}
        </div>
      )}

      {engineStatus && !engineStatus.available && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>
          Speech-to-text engine status: unavailable in this deployment ({engineStatus.reason}).
        </div>
      )}
    </div>
  );
}
