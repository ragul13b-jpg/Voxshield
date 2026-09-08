export default function Header({ view, onViewChange, backendOnline, privacyStatements, languages, language, onLanguageChange }) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 24px',
        borderBottom: '1px solid var(--border-hairline)',
        background: 'rgba(10,14,20,0.85)',
        backdropFilter: 'blur(8px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        flexWrap: 'wrap',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/vox-icon.svg" alt="" width={30} height={30} />
        <div>
          <div className="display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.02em', lineHeight: 1 }}>
            VOXSHIELD
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            VOICE AUTHENTICITY &amp; ANTI-IMPERSONATION SOC
          </div>
        </div>
      </div>

      <nav style={{ display: 'flex', gap: 4 }}>
        {[
          { key: 'live-call', label: 'Live Call Monitor' },
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'history', label: 'History' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => onViewChange(item.key)}
            className="nav-btn"
            data-active={view === item.key}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {languages?.length > 0 && (
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            className="vs-input"
            style={{ width: 'auto', padding: '5px 8px', fontSize: 11.5 }}
            title="Language/accent-ready prototype architecture — feature extraction is language-agnostic; recorded for demo purposes."
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        )}

        {privacyStatements?.length > 0 && (
          <div className="badge" title={privacyStatements.join(' · ')}>
            🔒 PRIVACY MODE
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: backendOnline ? 'var(--signal-green)' : 'var(--signal-red)',
              boxShadow: backendOnline ? '0 0 6px var(--signal-green)' : 'none',
            }}
          />
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            {backendOnline ? 'BACKEND ONLINE' : 'BACKEND OFFLINE'}
          </span>
        </div>
      </div>
    </header>
  );
}
