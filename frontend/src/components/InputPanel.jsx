import { useEffect, useRef, useState } from 'react';
import { WavRecorder } from '../utils/wavRecorder';
import { riskColor } from '../utils/format';
import ReferenceProfilePanel from './ReferenceProfilePanel';

const TABS = [
  { key: 'upload', label: 'Upload' },
  { key: 'record', label: 'Record' },
  { key: 'live', label: 'Live Monitor' },
  { key: 'demo', label: 'Demo Mode' },
  { key: 'profile', label: 'Reference Profile' },
];

export default function InputPanel({
  onUpload,
  onRecordComplete,
  onDemoSelect,
  demoSamples,
  busy,
  liveChunks,
  onLiveChunk,
  onLiveStart,
  onLiveStop,
  liveActive,
  profiles,
  selectedProfileId,
  onSelectProfile,
  onProfileEnrolled,
}) {
  const [tab, setTab] = useState('upload');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState(null);
  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => () => stopTimer(), []);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const startRecording = async () => {
    setMicError(null);
    try {
      const rec = new WavRecorder();
      rec.onLevel(setLevel);
      await rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (err) {
      setMicError('Microphone permission denied or unavailable. Try Demo Mode instead.');
    }
  };

  const stopRecording = () => {
    if (!recorderRef.current) return;
    const blob = recorderRef.current.stop();
    recorderRef.current = null;
    setIsRecording(false);
    stopTimer();
    setLevel(0);
    onRecordComplete(blob);
  };

  const startLive = async () => {
    setMicError(null);
    try {
      const rec = new WavRecorder({ chunkSeconds: 1.5, onChunk: onLiveChunk });
      rec.onLevel(setLevel);
      await rec.start();
      recorderRef.current = rec;
      onLiveStart();
    } catch (err) {
      setMicError('Microphone permission denied or unavailable. Try Demo Mode instead.');
    }
  };

  const stopLive = () => {
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    setLevel(0);
    onLiveStop();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border-hairline)' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              if (isRecording) stopRecording();
              if (liveActive) stopLive();
              setTab(t.key);
            }}
            className="tab-btn"
            data-active={tab === t.key}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) onUpload(file);
            }}
            style={{
              border: '1.5px dashed var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              padding: '32px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              background: 'var(--bg-inset)',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
            <div style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
              Drop an audio file here, or click to browse
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
              WAV, MP3, FLAC, OGG — analyzed on your local backend
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {tab === 'record' && (
        <div style={{ display: 'grid', gap: 14, justifyItems: 'center', padding: '16px 0' }}>
          <RecordButton isRecording={isRecording} level={level} onClick={isRecording ? stopRecording : startRecording} busy={busy} />
          <div className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {isRecording ? `Recording — ${recordSeconds}s` : 'Tap to record a full statement'}
          </div>
          {micError && <div style={{ fontSize: 12, color: 'var(--signal-red)' }}>{micError}</div>}
        </div>
      )}

      {tab === 'live' && (
        <div style={{ display: 'grid', gap: 14, padding: '16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <RecordButton isRecording={liveActive} level={level} onClick={liveActive ? stopLive : startLive} busy={false} pulse={liveActive} />
          </div>
          <div className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
            {liveActive ? 'LIVE VOICE ANALYSIS — streaming ~1.5s chunks' : 'Tap to start real-time chunk analysis'}
          </div>
          {micError && <div style={{ fontSize: 12, color: 'var(--signal-red)', textAlign: 'center' }}>{micError}</div>}

          {liveChunks.length > 0 && (
            <div style={{ display: 'grid', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
              {[...liveChunks].reverse().map((c) => (
                <div
                  key={c.chunk_index}
                  className="mono"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    padding: '6px 10px',
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border-hairline)',
                    borderRadius: 4,
                  }}
                >
                  <span>chunk #{c.chunk_index}</span>
                  <span style={{ color: riskColor(c.risk_level) }}>
                    {c.risk_score}/100 · {c.status_label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'demo' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {demoSamples.map((s) => (
            <button
              key={s.key}
              onClick={() => onDemoSelect(s.key)}
              disabled={busy || !s.available}
              className="demo-card"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</span>
                <span
                  className="mono"
                  style={{ fontSize: 10.5, color: 'var(--text-muted)', border: '1px solid var(--border-hairline)', borderRadius: 4, padding: '1px 6px' }}
                >
                  expected: {s.expected_risk_level}
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>{s.description}</p>
              {!s.available && (
                <p style={{ fontSize: 11, color: 'var(--signal-amber)', margin: '6px 0 0' }}>
                  Sample file missing — see backend/demo_audio/README
                </p>
              )}
            </button>
          ))}
        </div>
      )}
      {tab === 'profile' && (
        <ReferenceProfilePanel
          profiles={profiles}
          selectedProfileId={selectedProfileId}
          onSelectProfile={onSelectProfile}
          onProfileEnrolled={onProfileEnrolled}
        />
      )}
    </div>
  );
}

function RecordButton({ isRecording, level, onClick, busy, pulse }) {
  const ringScale = 1 + Math.min(0.35, level * 6);
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        position: 'relative',
        width: 76,
        height: 76,
        borderRadius: '50%',
        border: `2px solid ${isRecording ? 'var(--signal-red)' : 'var(--signal-cyan)'}`,
        background: isRecording ? 'var(--signal-red-dim)' : 'var(--bg-inset)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isRecording && (
        <span
          style={{
            position: 'absolute',
            inset: -6,
            borderRadius: '50%',
            border: '1.5px solid var(--signal-red)',
            opacity: 0.5,
            transform: `scale(${ringScale})`,
            transition: 'transform 0.08s linear',
          }}
        />
      )}
      <span
        style={{
          width: isRecording ? 20 : 26,
          height: isRecording ? 20 : 26,
          borderRadius: isRecording ? 4 : '50%',
          background: isRecording ? 'var(--signal-red)' : 'var(--signal-cyan)',
          transition: 'all 0.2s',
        }}
      />
    </button>
  );
}
