import { useEffect, useState } from 'react';
import { checkTransaction } from '../services/api';

export default function TransactionSimulator({ analysis, onVerify }) {
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setResult(null);
  }, [analysis?.analysis_id, analysis?.verification_status]);

  const hasAnalysis = !!analysis;
  const amount = analysis?.context?.input?.amount_inr || 500000;

  const handleApprove = async () => {
    if (!analysis) return;
    setChecking(true);
    try {
      const res = await checkTransaction(analysis.analysis_id, amount);
      setResult(res);
    } catch (err) {
      setResult({ allowed: false, status: 'ERROR', reason: err.message || 'Could not reach backend.' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg-inset)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 18,
      }}
    >
      <div className="display" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-secondary)', marginBottom: 10 }}>
        INCOMING REQUEST — SIMULATION
      </div>

      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          padding: '14px 16px',
          fontSize: 14.5,
          color: 'var(--text-primary)',
          marginBottom: 14,
        }}
      >
        "Transfer ₹{amount.toLocaleString('en-IN')} immediately. Don't tell anyone, it's urgent."
      </div>

      {!hasAnalysis && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          Run a voice analysis first — this demo blocks/approves based on the current trust score
          and verification status.
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: result ? 14 : 0 }}>
        <button
          onClick={handleApprove}
          disabled={!hasAnalysis || checking}
          className="btn-primary"
          style={{ flex: 1, opacity: hasAnalysis ? 1 : 0.5, cursor: hasAnalysis ? 'pointer' : 'not-allowed' }}
        >
          {checking ? 'Checking…' : 'Approve transaction'}
        </button>
        <button onClick={onVerify} className="btn-outline" style={{ flex: 1 }}>
          Verify identity
        </button>
      </div>

      {result?.status === 'BLOCKED' && (
        <div style={{ border: '1px solid var(--signal-red)', background: 'var(--signal-red-dim)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
          <div className="display" style={{ color: 'var(--signal-red)', fontWeight: 700, fontSize: 14 }}>
            🔴 ACTION BLOCKED
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-primary)' }}>{result.reason}</p>
        </div>
      )}

      {result?.status === 'ALLOWED_WITH_WARNING' && (
        <div style={{ border: '1px solid var(--signal-amber)', background: 'var(--signal-amber-dim)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
          <div className="display" style={{ color: 'var(--signal-amber)', fontWeight: 700, fontSize: 14 }}>
            ⚠️ ALLOWED — WITH CAUTION
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-primary)' }}>{result.reason}</p>
        </div>
      )}

      {result?.status === 'ALLOWED' && (
        <div style={{ border: '1px solid var(--signal-green)', background: 'var(--signal-green-dim)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
          <div className="display" style={{ color: 'var(--signal-green)', fontWeight: 700, fontSize: 14 }}>
            ✓ Transaction approved (simulation)
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-primary)' }}>{result.reason}</p>
        </div>
      )}

      {result?.status === 'ERROR' && (
        <div style={{ fontSize: 12, color: 'var(--signal-red)' }}>{result.reason}</div>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
        Simulation only. VoxShield does not connect to any real banking or payment system.
      </p>
    </div>
  );
}
