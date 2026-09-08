import { useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import InputPanel from './components/InputPanel';
import ContextPanel from './components/ContextPanel';
import LiveCallMonitor from './components/LiveCallMonitor';
import TrustDial from './components/TrustDial';
import RiskBreakdown from './components/RiskBreakdown';
import RiskFusionPanel from './components/RiskFusionPanel';
import AudioPlayerCard from './components/AudioPlayerCard';
import TranscriptionPanel from './components/TranscriptionPanel';
import WaveformCanvas from './components/WaveformCanvas';
import SpectrogramCanvas from './components/SpectrogramCanvas';
import EvidenceCards from './components/EvidenceCards';
import ThreatTimeline from './components/ThreatTimeline';
import WarningBanner from './components/WarningBanner';
import TransactionSimulator from './components/TransactionSimulator';
import IdentityVerificationModal from './components/IdentityVerificationModal';
import HistoryView from './components/HistoryView';
import IncidentReport from './components/IncidentReport';
import {
  checkHealth,
  analyzeUpload,
  analyzeRecording,
  analyzeChunk,
  getDemoSamples,
  analyzeDemo,
  getHistory,
  getAnalysis,
  listProfiles,
  getLanguages,
  getPrivacyInfo,
  getTranscriptionStatus,
} from './services/api';

const DEFAULT_CONTEXT = {
  caller_name: '',
  contact_status: 'unknown',
  sensitivity: 'high',
  transaction_type: 'money_transfer',
  amount_inr: 500000,
  request_text: "Transfer immediately, don't tell anyone",
  historical_fraud_flag: false,
};

export default function App() {
  const [view, setView] = useState('live-call');
  const [backendOnline, setBackendOnline] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [demoSamples, setDemoSamples] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [liveActive, setLiveActive] = useState(false);
  const [liveChunks, setLiveChunks] = useState([]);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const [contextEnabled, setContextEnabled] = useState(false);
  const [context, setContext] = useState(DEFAULT_CONTEXT);

  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);

  const [languages, setLanguages] = useState([]);
  const [language, setLanguage] = useState('en');
  const [privacyStatements, setPrivacyStatements] = useState([]);
  const [transcriptionStatus, setTranscriptionStatus] = useState(null);

  const [currentAudio, setCurrentAudio] = useState(null); // { url, name, sizeBytes, mimeType }

  const pollRef = useRef(null);
  const audioUrlRef = useRef(null);

  useEffect(() => {
    pingBackend();
    loadDemoSamples();
    loadProfiles();
    loadLanguages();
    loadPrivacy();
    loadTranscriptionStatus();
    pollRef.current = setInterval(pingBackend, 15000);
    return () => {
      clearInterval(pollRef.current);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (view === 'history') loadHistory();
  }, [view]);

  async function pingBackend() {
    try {
      await checkHealth();
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
    }
  }

  async function loadDemoSamples() {
    try {
      setDemoSamples(await getDemoSamples());
    } catch {
      // backend may not be up yet; the health poll will retry
    }
  }

  async function loadProfiles() {
    try {
      setProfiles(await listProfiles());
    } catch {
      // ignore - profile enrollment is optional
    }
  }

  async function loadLanguages() {
    try {
      const res = await getLanguages();
      setLanguages(res.supported || []);
    } catch {
      // ignore
    }
  }

  async function loadPrivacy() {
    try {
      const res = await getPrivacyInfo();
      setPrivacyStatements(res.statements || []);
    } catch {
      // ignore
    }
  }

  async function loadTranscriptionStatus() {
    try {
      setTranscriptionStatus(await getTranscriptionStatus());
    } catch {
      setTranscriptionStatus({ available: false, reason: 'Could not reach backend.' });
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      setHistory(await getHistory());
    } catch (err) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  function currentMeta() {
    return {
      context: contextEnabled ? context : null,
      profileId: selectedProfileId || null,
      language,
    };
  }

  function setAudioSource(url, name, sizeBytes, mimeType) {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = url;
    setCurrentAudio({ url, name, sizeBytes, mimeType });
  }

  async function runAnalysis(promise) {
    setBusy(true);
    setError(null);
    setAnalysis(null); // clear stale results immediately - "Analyzing audio..." state
    try {
      const result = await promise;
      setAnalysis(result);
      setView('dashboard');
    } catch (err) {
      setError(err.message || 'Analysis failed');
    } finally {
      setBusy(false);
    }
  }

  const handleUpload = (file) => {
    setAudioSource(URL.createObjectURL(file), file.name, file.size, file.type);
    runAnalysis(analyzeUpload(file, currentMeta()));
  };

  const handleRecordComplete = (blob) => {
    setAudioSource(URL.createObjectURL(blob), 'recording.wav', blob.size, blob.type || 'audio/wav');
    runAnalysis(analyzeRecording(blob, currentMeta()));
  };

  const handleDemoSelect = async (key) => {
    try {
      const res = await fetch(`/demo_audio/${key}.wav`);
      if (res.ok) {
        const blob = await res.blob();
        setAudioSource(URL.createObjectURL(blob), `${key}.wav`, blob.size, 'audio/wav');
      }
    } catch {
      // playback preview is best-effort; analysis below still runs independently
    }
    runAnalysis(analyzeDemo(key, currentMeta()));
  };

  const handleLiveStart = () => {
    setLiveActive(true);
    setLiveChunks([]);
  };
  const handleLiveStop = () => setLiveActive(false);
  const handleLiveChunk = async (blob, idx) => {
    try {
      const result = await analyzeChunk(blob, idx);
      setLiveChunks((prev) => [...prev, result]);
    } catch {
      // ignore transient chunk failures in the live demo loop
    }
  };

  const handleSelectHistoryItem = async (id) => {
    try {
      const record = await getAnalysis(id);
      setAnalysis(record);
      setCurrentAudio(null); // raw audio for a past session isn't retained/replayable
      setView('dashboard');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleProfileEnrolled = (profile) => {
    setProfiles((prev) => [{ profile_id: profile.profile_id, name: profile.name, created_at: profile.created_at }, ...prev]);
    setSelectedProfileId(profile.profile_id);
  };

  const handleVerified = async () => {
    if (!analysis) return;
    const refreshed = await getAnalysis(analysis.analysis_id).catch(() => null);
    if (refreshed) setAnalysis(refreshed);
  };

  const latestLive = liveChunks[liveChunks.length - 1] || null;
  const dialScore = liveActive ? latestLive?.trust_score ?? null : analysis?.trust_score ?? null;
  const dialRiskLevel = liveActive ? latestLive?.risk_level ?? 'LOW' : analysis?.risk_level ?? 'LOW';

  return (
    <div id="app-shell" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        view={view}
        onViewChange={setView}
        backendOnline={backendOnline}
        privacyStatements={privacyStatements}
        languages={languages}
        language={language}
        onLanguageChange={setLanguage}
      />

      <main style={{ flex: 1, width: '100%', maxWidth: 1240, margin: '0 auto', padding: '24px', display: 'grid', gap: 20 }}>
        {backendOnline === false && (
          <div
            style={{
              border: '1px solid var(--signal-red)',
              background: 'var(--signal-red-dim)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              fontSize: 13,
            }}
          >
            Backend not reachable. Start the FastAPI server (see README) — the dashboard will
            reconnect automatically.
          </div>
        )}

        {error && (
          <div
            style={{
              border: '1px solid var(--signal-amber)',
              background: 'var(--signal-amber-dim)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              fontSize: 13,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{error}</span>
            <button onClick={() => setError(null)} className="btn-icon" aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {view === 'live-call' && <LiveCallMonitor profileId={selectedProfileId} language={language} />}

        {view === 'dashboard' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: 20 }}>
            <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
              <div className="panel">
                <div className="panel-title">Voice Input</div>
                <InputPanel
                  onUpload={handleUpload}
                  onRecordComplete={handleRecordComplete}
                  onDemoSelect={handleDemoSelect}
                  demoSamples={demoSamples}
                  busy={busy}
                  liveChunks={liveChunks}
                  onLiveChunk={handleLiveChunk}
                  onLiveStart={handleLiveStart}
                  onLiveStop={handleLiveStop}
                  liveActive={liveActive}
                  profiles={profiles}
                  selectedProfileId={selectedProfileId}
                  onSelectProfile={setSelectedProfileId}
                  onProfileEnrolled={handleProfileEnrolled}
                />
              </div>

              {currentAudio && (
                <div className="panel">
                  <div className="panel-title">Audio</div>
                  <AudioPlayerCard
                    audioUrl={currentAudio.url}
                    name={currentAudio.name}
                    sizeBytes={currentAudio.sizeBytes}
                    mimeType={currentAudio.mimeType}
                    fallbackDuration={analysis?.duration_seconds}
                  />
                </div>
              )}

              <ContextPanel context={context} onChange={setContext} enabled={contextEnabled} onToggle={setContextEnabled} />

              <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div className="panel-title" style={{ alignSelf: 'flex-start' }}>
                  Voice Trust Score
                </div>
                <TrustDial score={dialScore} riskLevel={dialRiskLevel} analyzing={busy || liveActive} />
                {analysis && !liveActive && (
                  <>
                    <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
                      {analysis.analysis_id} · {analysis.duration_seconds}s
                    </div>
                    <RiskBreakdown breakdown={analysis.risk_breakdown} />
                  </>
                )}
                {busy && !analysis && (
                  <div className="mono" style={{ fontSize: 12, color: 'var(--signal-cyan)', marginTop: 10 }}>
                    Analyzing audio…
                  </div>
                )}
              </div>

              <TransactionSimulator analysis={analysis} onVerify={() => setVerifyOpen(true)} />
            </div>

            <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
              {analysis && <WarningBanner riskLevel={analysis.risk_level} recommendation={analysis.recommendation} />}

              <div className="panel">
                <div className="panel-title">Waveform</div>
                <WaveformCanvas points={analysis?.waveform?.points || []} riskLevel={analysis?.risk_level} />
              </div>

              <div className="panel">
                <div className="panel-title">Spectrogram</div>
                <SpectrogramCanvas db={analysis?.spectrogram?.db || []} />
              </div>

              <div className="panel">
                <TranscriptionPanel transcription={analysis?.transcription} engineStatus={transcriptionStatus} />
              </div>

              <div className="panel">
                <RiskFusionPanel
                  indicators={analysis?.indicators || []}
                  riskScore={analysis?.risk_score}
                  riskLevel={analysis?.risk_level}
                  humanProbability={analysis?.human_probability}
                  syntheticProbability={analysis?.synthetic_probability}
                />
              </div>

              <div className="panel">
                <div className="panel-title">Detection Evidence</div>
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
                  Includes acoustic/spectral, prosody, synthetic-artifact, speaker-consistency and
                  contextual signals when available.
                </p>
                <EvidenceCards indicators={analysis?.indicators || []} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div className="panel">
                  <div className="panel-title">Analysis Timeline</div>
                  <ThreatTimeline events={analysis?.timeline || []} />
                </div>
                <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="panel-title">Incident Report</div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', flex: 1 }}>
                    Generate a printable summary of this analysis for escalation or record-keeping.
                  </p>
                  <button
                    onClick={() => setReportOpen(true)}
                    disabled={!analysis}
                    className="btn-primary"
                    style={{ opacity: analysis ? 1 : 0.5, cursor: analysis ? 'pointer' : 'not-allowed' }}
                  >
                    Generate report
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'history' && (
          <div className="panel">
            <HistoryView history={history} onSelect={handleSelectHistoryItem} loading={historyLoading} />
          </div>
        )}
      </main>

      <footer style={{ padding: '16px 24px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
        VoxShield is an AI-assisted, multi-signal voice authenticity analysis and risk-based
        prevention prototype for SIH26104 — not a forensic-grade classifier, production speaker
        identification system, or telecom/banking integration. Always independently verify
        sensitive requests.
      </footer>

      <IdentityVerificationModal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        analysisId={analysis?.analysis_id}
        onVerified={handleVerified}
      />
      <IncidentReport analysis={analysis} open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}
