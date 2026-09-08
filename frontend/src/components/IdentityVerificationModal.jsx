import { useState } from 'react';
import { verifyIdentity } from '../services/api';

const STEPS = [
  {
    title: 'Contact the person through a known number',
    detail: 'Use a number you already have saved — not one provided during this call or message.',
  },
  {
    title: 'Ask an independent verification question',
    detail: 'Something only the real person would know, agreed upon beforehand if possible.',
  },
  {
    title: 'Confirm the requested action',
    detail: 'Have them restate the request in their own words through the verified channel.',
  },
  {
    title: 'Proceed only after verification',
    detail: 'Do not act on the original request until every step above is complete.',
  },
];

export default function IdentityVerificationModal({ open, onClose, analysisId, onVerified }) {
  const [completed, setCompleted] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [marked, setMarked] = useState(false);

  if (!open) return null;

  const toggleStep = (idx) => {
    setCompleted((prev) => (prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]));
  };

  const allDone = completed.length === STEPS.length;

  const handleMarkVerified = async () => {
    if (!analysisId) return;
    setSubmitting(true);
    try {
      await verifyIdentity(analysisId, true);
      setMarked(true);
      onVerified?.();
    } catch {
      // non-fatal in the prototype - the UI still reflects local completion
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
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
          maxWidth: 480,
          background: 'var(--bg-panel-raised)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span className="display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.03em' }}>
            Identity Verification
          </span>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            ✕
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, marginBottom: 18 }}>
          Complete each step through a separate, trusted channel before acting on the request.
        </p>

        <div style={{ display: 'grid', gap: 10 }}>
          {STEPS.map((step, idx) => {
            const done = completed.includes(idx);
            return (
              <button
                key={idx}
                onClick={() => toggleStep(idx)}
                style={{
                  textAlign: 'left',
                  display: 'flex',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${done ? 'var(--signal-green)' : 'var(--border-hairline)'}`,
                  background: done ? 'var(--signal-green-dim)' : 'var(--bg-inset)',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: `1.5px solid ${done ? 'var(--signal-green)' : 'var(--border-strong)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    color: 'var(--signal-green)',
                  }}
                >
                  {done ? '✓' : idx + 1}
                </span>
                <span>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{step.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{step.detail}</div>
                </span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 18,
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${marked ? 'var(--signal-green)' : 'var(--signal-amber)'}`,
            background: marked ? 'var(--signal-green-dim)' : 'var(--signal-amber-dim)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span className="display" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em' }}>
            {marked ? 'INDEPENDENTLY VERIFIED' : 'IDENTITY VERIFICATION REQUIRED'}
          </span>
          {!marked && (
            <button
              onClick={handleMarkVerified}
              disabled={!allDone || !analysisId || submitting}
              className="btn-primary"
              style={{ opacity: allDone && analysisId ? 1 : 0.5, whiteSpace: 'nowrap' }}
            >
              {submitting ? 'Saving…' : 'Mark as verified'}
            </button>
          )}
        </div>
        {!analysisId && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Run an analysis first to link verification to a specific call record.
          </p>
        )}
      </div>
    </div>
  );
}
