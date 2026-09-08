const CONTACT_OPTIONS = [
  { value: 'known_verified', label: 'Known & verified contact' },
  { value: 'known', label: 'Known contact' },
  { value: 'unknown', label: 'Unknown contact' },
  { value: 'unverified', label: 'Unverified / claimed identity' },
];

const SENSITIVITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const TXN_OPTIONS = [
  { value: 'none', label: 'No transaction' },
  { value: 'information_request', label: 'Information request' },
  { value: 'money_transfer', label: 'Money transfer' },
  { value: 'otp_or_pin_share', label: 'OTP / PIN share' },
  { value: 'password_share', label: 'Password share' },
];

export default function ContextPanel({ context, onChange, enabled, onToggle }) {
  const update = (field, value) => onChange({ ...context, [field]: value });

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>
          Caller &amp; Transaction Context
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          Include in next analysis
        </label>
      </div>

      <div style={{ display: 'grid', gap: 10, opacity: enabled ? 1 : 0.45, pointerEvents: enabled ? 'auto' : 'none' }}>
        <Field label="Caller name">
          <input
            type="text"
            value={context.caller_name || ''}
            onChange={(e) => update('caller_name', e.target.value)}
            placeholder='e.g. "John — CFO"'
            className="vs-input"
          />
        </Field>

        <Field label="Contact status">
          <select value={context.contact_status} onChange={(e) => update('contact_status', e.target.value)} className="vs-input">
            {CONTACT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Request sensitivity">
          <select value={context.sensitivity} onChange={(e) => update('sensitivity', e.target.value)} className="vs-input">
            {SENSITIVITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Transaction type">
          <select value={context.transaction_type} onChange={(e) => update('transaction_type', e.target.value)} className="vs-input">
            {TXN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Amount (₹)">
          <input
            type="number"
            min="0"
            value={context.amount_inr || ''}
            onChange={(e) => update('amount_inr', e.target.value ? Number(e.target.value) : null)}
            placeholder="500000"
            className="vs-input"
          />
        </Field>

        <Field label="Request text (optional)">
          <input
            type="text"
            value={context.request_text || ''}
            onChange={(e) => update('request_text', e.target.value)}
            placeholder="Transfer immediately, don't tell anyone"
            className="vs-input"
          />
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
          <input
            type="checkbox"
            checked={!!context.historical_fraud_flag}
            onChange={(e) => update('historical_fraud_flag', e.target.checked)}
          />
          Flag: this contact has prior fraud reports (demo field)
        </label>
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
        Simulation only — not connected to real telecom or caller-ID data. Contributes to the
        overall risk fusion via transparent, rule-based weights (see backend/app/config.py).
      </p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{label}</span>
      {children}
    </label>
  );
}
