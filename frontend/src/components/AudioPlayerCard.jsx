import { useEffect, useState } from 'react';

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds) || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AudioPlayerCard({ audioUrl, name, sizeBytes, mimeType, fallbackDuration }) {
  const [duration, setDuration] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setDuration(null);
    setLoadError(false);
  }, [audioUrl]);

  if (!audioUrl) {
    return <div className="panel-empty">No audio loaded yet.</div>;
  }

  const format = (mimeType || '').split('/')[1]?.toUpperCase() || name?.split('.').pop()?.toUpperCase() || 'UNKNOWN';

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 }}>
        <MetaField label="FILE" value={name || 'audio'} mono={false} />
        <MetaField label="FORMAT" value={format} />
        <MetaField label="SIZE" value={formatBytes(sizeBytes)} />
        <MetaField label="DURATION" value={formatDuration(duration ?? fallbackDuration)} />
      </div>

      {loadError ? (
        <div style={{ fontSize: 12, color: 'var(--signal-amber)' }}>
          Could not play this audio in the browser (unsupported format for playback). Analysis
          may still succeed server-side.
        </div>
      ) : (
        <audio
          key={audioUrl}
          controls
          src={audioUrl}
          style={{ width: '100%', height: 34 }}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={() => setLoadError(true)}
        />
      )}
    </div>
  );
}

function MetaField({ label, value, mono = true }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{label}</div>
      <div
        className={mono ? 'mono' : undefined}
        style={{ fontSize: 12.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={String(value)}
      >
        {value}
      </div>
    </div>
  );
}
