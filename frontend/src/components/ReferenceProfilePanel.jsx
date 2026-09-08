import { useRef, useState } from 'react';
import { WavRecorder } from '../utils/wavRecorder';
import { enrollProfile } from '../services/api';

export default function ReferenceProfilePanel({ profiles, selectedProfileId, onSelectProfile, onProfileEnrolled }) {
  const [name, setName] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const recorderRef = useRef(null);
  const fileInputRef = useRef(null);

  const startRecording = async () => {
    setError(null);
    try {
      const rec = new WavRecorder();
      await rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
    } catch {
      setError('Microphone unavailable — try uploading a short reference clip instead.');
    }
  };

  const stopRecording = async () => {
    if (!recorderRef.current) return;
    const blob = recorderRef.current.stop();
    recorderRef.current = null;
    setIsRecording(false);
    await submit(blob);
  };

  const submit = async (blob) => {
    if (!name.trim()) {
      setError('Give this reference profile a name first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await enrollProfile(blob, name.trim());
      onProfileEnrolled(result);
      setName('');
    } catch (err) {
      setError(err.message || 'Enrollment failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
        Enroll a short "known voice" reference sample, then future analyses can be compared
        against it. <strong>Prototype voice consistency analysis</strong> — a coarse acoustic
        similarity check, not production-grade speaker recognition.
      </p>

      <input
        type="text"
        placeholder="Profile name (e.g. Priya — CFO)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="vs-input"
      />

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={busy}
          className="btn-outline"
          style={{ flex: 1, borderColor: isRecording ? 'var(--signal-red)' : undefined, color: isRecording ? 'var(--signal-red)' : undefined }}
        >
          {isRecording ? 'Stop & enroll' : 'Record reference'}
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={busy} className="btn-outline" style={{ flex: 1 }}>
          Upload reference
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) submit(file);
            e.target.value = '';
          }}
        />
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--signal-red)' }}>{error}</div>}

      <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: 12 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.04em' }}>
          COMPARE NEXT ANALYSIS AGAINST
        </div>
        <select
          value={selectedProfileId || ''}
          onChange={(e) => onSelectProfile(e.target.value || null)}
          className="vs-input"
        >
          <option value="">None — audio-only analysis</option>
          {profiles.map((p) => (
            <option key={p.profile_id} value={p.profile_id}>
              {p.name} ({p.profile_id})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
