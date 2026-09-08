import { useEffect, useRef, useState } from 'react';
import TrustDial from './TrustDial';
import WaveformCanvas from './WaveformCanvas';
import EvidenceCards from './EvidenceCards';
import ThreatTimeline from './ThreatTimeline';
import WarningBanner from './WarningBanner';
import TransactionSimulator from './TransactionSimulator';
import IdentityVerificationModal from './IdentityVerificationModal';
import IncidentReport from './IncidentReport';
import TranscriptionPanel from './TranscriptionPanel';
import RiskFusionPanel from './RiskFusionPanel';
import WebRTCDemo from './WebRTCDemo';
import { riskColor } from '../utils/format';
import { WavRecorder, fetchAndDecodeAudio, sliceIntoWindows } from '../utils/wavRecorder';
import { analyzeChunk, analyzeDemo, analyzeRecordFinal } from '../services/api';

const SCENARIOS = [
  {
    key: 'natural',
    label: 'Natural Call',
    tagline: 'Expected: LOW RISK',
    color: 'var(--signal-green)',
  },
  {
    key: 'noisy',
    label: 'Suspicious Call',
    tagline: 'Expected: SUSPICIOUS',
    color: 'var(--signal-amber)',
  },
  {
    key: 'synthetic',
    label: 'AI-Cloned Call',
    tagline: 'Expected: HIGH RISK',
    color: 'var(--signal-red)',
  },
];

const CALL_CONTEXT = {
  caller_name: 'Dad',
  contact_status: 'unknown',
  sensitivity: 'high',
  transaction_type: 'money_transfer',
  amount_inr: 50000,
  request_text: "Transfer immediately, don't tell anyone",
};

const WINDOW_SECONDS = 1.6;
const STEP_SECONDS = 0.6;
const DEMO_PACE_MS = 700; // how long each simulated chunk "takes" to arrive

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downsampleForWaveform(samples, targetPoints) {
  if (samples.length <= targetPoints) return Array.from(samples);
  const factor = Math.floor(samples.length / targetPoints);
  const out = [];
  for (let i = 0; i + factor <= samples.length; i += factor) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i + j];
    out.push(sum / factor);
  }
  return out;
}

export default function LiveCallMonitor({ profileId, language }) {
  const [scenario, setScenario] = useState(null); // scenario meta object while running/complete
  const [status, setStatus] = useState('IDLE'); // IDLE / INCOMING / CONNECTED / ANALYZING / HIGH RISK / FINALIZING / COMPLETE
  const [elapsed, setElapsed] = useState(0);
  const [liveHistory, setLiveHistory] = useState([]); // [{t, trust_score, risk_level}]
  const [liveIndicators, setLiveIndicators] = useState([]);
  const [waveformPoints, setWaveformPoints] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [warningTriggered, setWarningTriggered] = useState(false);
  const [callAnalysis, setCallAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [micLevel, setMicLevel] = useState(0);
  const [micMode, setMicMode] = useState(false);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const startTimeRef = useRef(null);
  const tickRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const micRecorderRef = useRef(null);
  const micChunkCountRef = useRef(0);
  const seenHighRef = useRef(false);
  const seenSyntheticRef = useRef(false);

  useEffect(() => {
    return () => {
      stopTicker();
      if (micRecorderRef.current) {
        try {
          micRecorderRef.current.stop();
        } catch {
          // ignore on unmount
        }
      }
    };
  }, []);

  function startTicker() {
    startTimeRef.current = Date.now();
    tickRef.current = setInterval(() => {
      setElapsed((Date.now() - startTimeRef.current) / 1000);
    }, 200);
  }

  function stopTicker() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }

  function elapsedNow() {
    return startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0;
  }

  function pushTimeline(label) {
    setTimeline((prev) => [...prev, { t: elapsedNow(), label }]);
  }

  function resetState(scenarioMeta) {
    stopRequestedRef.current = false;
    seenHighRef.current = false;
    seenSyntheticRef.current = false;
    micChunkCountRef.current = 0;
    setScenario(scenarioMeta);
    setStatus('INCOMING');
    setElapsed(0);
    setLiveHistory([]);
    setLiveIndicators([]);
    setWaveformPoints([]);
    setTimeline([]);
    setWarningTriggered(false);
    setCallAnalysis(null);
    setError(null);
  }

  function ingestChunkResult(result, windowSamples) {
    setLiveHistory((prev) => [...prev, { t: elapsedNow(), trust_score: result.trust_score, risk_level: result.risk_level }]);
    if (result.indicators?.length) setLiveIndicators(result.indicators);

    if (windowSamples) {
      const pts = downsampleForWaveform(windowSamples, 120);
      setWaveformPoints((prev) => [...prev, ...pts].slice(-1200));
    }

    pushTimeline(`Audio chunk analyzed — trust score ${result.trust_score}/100 (${result.risk_level})`);

    const topIndicator = result.indicators?.[0];
    if (topIndicator?.severity === 'HIGH' && !seenSyntheticRef.current) {
      seenSyntheticRef.current = true;
      pushTimeline(`${topIndicator.name} indicators detected`);
    }

    if (result.risk_level === 'HIGH' && !seenHighRef.current) {
      seenHighRef.current = true;
      setStatus('HIGH RISK');
      pushTimeline('Risk threshold exceeded');
      pushTimeline('Warning triggered');
      setWarningTriggered(true);
    }
  }

  // ---------------------------------------------------------------------
  // Demo call simulation (deterministic, file-based)
  // ---------------------------------------------------------------------
  async function startDemoCall(scenarioMeta) {
    resetState(scenarioMeta);
    setMicMode(false);
    startTicker();
    pushTimeline('Incoming call');

    await delay(400);
    setStatus('CONNECTED');
    pushTimeline('Call connected');

    await delay(400);
    setStatus('ANALYZING');
    pushTimeline('Live audio analysis started');

    try {
      const { samples, sampleRate } = await fetchAndDecodeAudio(`/demo_audio/${scenarioMeta.key}.wav`);
      const windows = sliceIntoWindows(samples, sampleRate, WINDOW_SECONDS, STEP_SECONDS);

      for (let i = 0; i < windows.length; i++) {
        if (stopRequestedRef.current) return;
        const w = windows[i];
        try {
          const result = await analyzeChunk(w.blob, i);
          ingestChunkResult(result, w.samples);
        } catch (err) {
          // skip a failed chunk rather than aborting the whole call
        }
        await delay(DEMO_PACE_MS);
      }

      if (stopRequestedRef.current) return;
      await finalizeDemoCall(scenarioMeta);
    } catch (err) {
      setError(err.message || 'Could not load demo call audio.');
      setStatus('IDLE');
      stopTicker();
    }
  }

  async function finalizeDemoCall(scenarioMeta) {
    setStatus('FINALIZING');
    pushTimeline('Finalizing call — running full contextual risk assessment');
    try {
      const record = await analyzeDemo(scenarioMeta.key, {
        context: CALL_CONTEXT,
        profileId: profileId || null,
        language,
        sourceLabel: `Live Call — ${scenarioMeta.label} (Dad)`,
        sourceTag: 'live_call',
      });
      setCallAnalysis(record);
      const finalStatus = record.risk_level === 'HIGH' ? 'HIGH RISK — CALL ENDED' : 'CALL ENDED';
      setStatus(finalStatus);
      if (record.risk_level === 'HIGH') {
        pushTimeline('Sensitive-action protection engaged — transaction blocking active');
        pushTimeline('Independent identity verification required');
      } else {
        pushTimeline('Call analysis complete');
      }
    } catch (err) {
      setError(err.message || 'Could not finalize call analysis.');
      setStatus('CALL ENDED');
    } finally {
      stopTicker();
    }
  }

  // ---------------------------------------------------------------------
  // Real microphone live call (near-real-time prototype analysis)
  // ---------------------------------------------------------------------
  async function startMicCall() {
    resetState({ key: 'mic', label: 'Live Microphone Call', tagline: 'Real audio input', color: 'var(--signal-cyan)' });
    setMicMode(true);
    startTicker();
    pushTimeline('Incoming call');
    await delay(300);
    setStatus('CONNECTED');
    pushTimeline('Call connected');
    await delay(300);
    setStatus('ANALYZING');
    pushTimeline('Live microphone analysis started');

    try {
      const rec = new WavRecorder({
        chunkSeconds: 1.5,
        onChunk: async (blob, idx) => {
          micChunkCountRef.current += 1;
          try {
            const result = await analyzeChunk(blob, idx);
            ingestChunkResult(result, null);
          } catch {
            // skip failed chunk
          }
        },
      });
      rec.onLevel(setMicLevel);
      await rec.start();
      micRecorderRef.current = rec;
    } catch (err) {
      setError('Microphone permission denied or unavailable. Try a Demo Call instead.');
      setStatus('IDLE');
      stopTicker();
    }
  }

  async function endMicCall() {
    if (!micRecorderRef.current) return;
    const fullBlob = micRecorderRef.current.stop();
    micRecorderRef.current = null;
    setMicLevel(0);

    if (micChunkCountRef.current === 0) {
      setStatus('IDLE');
      stopTicker();
      setError('No audio was captured — try again and speak for a few seconds.');
      return;
    }

    await finalizeMicCall(fullBlob);
  }

  async function finalizeMicCall(fullBlob) {
    setStatus('FINALIZING');
    pushTimeline('Finalizing call — running full contextual risk assessment');
    try {
      const record = await analyzeRecordFinal(fullBlob, {
        context: CALL_CONTEXT,
        profileId: profileId || null,
        language,
        sourceLabel: 'Live Call — Microphone (Dad)',
        sourceTag: 'live_call',
      });
      setCallAnalysis(record);
      const finalStatus = record.risk_level === 'HIGH' ? 'HIGH RISK — CALL ENDED' : 'CALL ENDED';
      setStatus(finalStatus);
      if (record.risk_level === 'HIGH') {
        pushTimeline('Sensitive-action protection engaged — transaction blocking active');
        pushTimeline('Independent identity verification required');
      } else {
        pushTimeline('Call analysis complete');
      }
    } catch (err) {
      setError(err.message || 'Could not finalize call analysis.');
      setStatus('CALL ENDED');
    } finally {
      stopTicker();
    }
  }

  function endCallAndReset() {
    stopRequestedRef.current = true;
    if (micRecorderRef.current) {
      try {
        micRecorderRef.current.stop();
      } catch {
        // ignore
      }
      micRecorderRef.current = null;
    }
    stopTicker();
    setScenario(null);
    setStatus('IDLE');
    setMicMode(false);
  }

  const running = status !== 'IDLE';
  const latestLive = liveHistory[liveHistory.length - 1] || null;
  const dialScore = callAnalysis ? callAnalysis.trust_score : latestLive?.trust_score ?? null;
  const dialRiskLevel = callAnalysis ? callAnalysis.risk_level : latestLive?.risk_level ?? 'LOW';
  const isAnalyzing = status === 'ANALYZING' || status === 'FINALIZING';

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {!running && (
        <div className="panel">
          <div className="panel-title">Live Call Monitor</div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -6, marginBottom: 16 }}>
            Simulates an incoming call and analyzes voice authenticity <strong>while the call is
            still active</strong> — the core SIH26104 scenario. Choose a deterministic demo
            scenario (no microphone needed), or use your real microphone for a near-real-time
            prototype analysis of your own voice.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            {SCENARIOS.map((s) => (
              <button key={s.key} onClick={() => startDemoCall(s)} className="demo-card" style={{ borderLeft: `3px solid ${s.color}` }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{s.label}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{s.tagline}</div>
              </button>
            ))}
          </div>

          <button onClick={startMicCall} className="btn-outline" style={{ width: '100%' }}>
            🎙 Use my microphone instead (real audio)
          </button>
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-hairline)',
              background: 'var(--bg-inset)',
            }}
          >
            <div className="mono" style={{ fontSize: 10, color: 'var(--signal-amber)', letterSpacing: '0.06em', marginBottom: 4 }}>
              FUTURE DEPLOYMENT — REAL-TIME CALL INTEGRATION
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              This prototype does not intercept cellular calls or access audio from another
              device. The scenario buttons replay bundled recordings and the microphone option
              analyzes your own browser mic, both in short chunks, near-real-time — not live
              telephony. The detection engine is architected so it could be integrated with
              supported VoIP, enterprise communication, or permitted telephony environments in a
              future deployment. Detection is not guaranteed to be 100% accurate.
            </p>
          </div>

          {error && <div style={{ fontSize: 12, color: 'var(--signal-red)', marginTop: 10 }}>{error}</div>}
        </div>
      )}

      {!running && <WebRTCDemo />}

      {running && (
        <>
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 4 }}>
                  {micMode ? '📱 LIVE MICROPHONE CALL' : `📱 INCOMING CALL — ${scenario?.label?.toUpperCase()}`}
                </div>
                <div className="display" style={{ fontSize: 20, fontWeight: 700 }}>
                  {micMode ? 'You (live microphone)' : 'Dad'}
                </div>
                <div className="mono" style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {micMode ? 'Local microphone input' : '+91 XXXXX XXXXX'}
                </div>
              </div>

              <StatusBadge status={status} elapsed={elapsed} />
            </div>

            <div style={{ display: 'grid', gap: 4, marginTop: 14, fontSize: 12.5 }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Contact status: </span>
                <span style={{ color: 'var(--signal-amber)' }}>Unknown / Not independently verified</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Request: </span>
                <span>"Transfer ₹50,000 immediately."</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              {micMode && status === 'ANALYZING' && (
                <button onClick={endMicCall} className="btn-primary" style={{ flex: 1 }}>
                  End call &amp; finalize
                </button>
              )}
              <button
                onClick={endCallAndReset}
                className="btn-outline"
                style={{ flex: micMode && status === 'ANALYZING' ? 1 : undefined, width: micMode && status === 'ANALYZING' ? undefined : '100%' }}
              >
                {status.startsWith('CALL ENDED') || status.startsWith('HIGH RISK — CALL') ? 'Start a new call' : 'End call'}
              </button>
            </div>

            {error && <div style={{ fontSize: 12, color: 'var(--signal-red)', marginTop: 10 }}>{error}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 20 }}>
            <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
              <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div className="panel-title" style={{ alignSelf: 'flex-start' }}>Live Voice Trust Score</div>
                <TrustDial score={dialScore} riskLevel={dialRiskLevel} analyzing={isAnalyzing} size={220} />
                {liveHistory.length > 0 && (
                  <div style={{ width: '100%', marginTop: 10 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 6 }}>
                      SCORE HISTORY
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {liveHistory.map((h, idx) => (
                        <span
                          key={idx}
                          className="mono"
                          style={{
                            fontSize: 11,
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: `1px solid ${riskColor(h.risk_level)}`,
                            color: riskColor(h.risk_level),
                          }}
                        >
                          {h.trust_score}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {callAnalysis && (
                <TransactionSimulator analysis={callAnalysis} onVerify={() => setVerifyOpen(true)} />
              )}
            </div>

            <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
              {warningTriggered && (
                <WarningBanner
                  riskLevel={callAnalysis?.risk_level || 'HIGH'}
                  recommendation={
                    callAnalysis?.recommendation ||
                    "Do not perform sensitive actions until the caller's identity has been independently verified through a separate, trusted communication channel."
                  }
                />
              )}

              <div className="panel">
                <div className="panel-title">Live Audio Waveform</div>
                <WaveformCanvas points={waveformPoints} riskLevel={dialRiskLevel} />
              </div>

              {callAnalysis && (
                <div className="panel">
                  <TranscriptionPanel transcription={callAnalysis.transcription} />
                </div>
              )}

              {callAnalysis && (
                <div className="panel">
                  <RiskFusionPanel
                    indicators={callAnalysis.indicators}
                    riskScore={callAnalysis.risk_score}
                    riskLevel={callAnalysis.risk_level}
                    humanProbability={callAnalysis.human_probability}
                    syntheticProbability={callAnalysis.synthetic_probability}
                  />
                </div>
              )}

              <div className="panel">
                <div className="panel-title">Live Detection Evidence</div>
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
                  Updates as new audio chunks are analyzed{callAnalysis ? ' — showing final call-level evidence' : ''}.
                </p>
                <EvidenceCards indicators={callAnalysis ? callAnalysis.indicators : liveIndicators} />
              </div>

              <div className="panel">
                <div className="panel-title">Live Call Timeline</div>
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
                  Timestamps are real elapsed time since this session started, generated as each
                  step actually runs — not fabricated.
                </p>
                <ThreatTimeline events={timeline} />
              </div>

              {callAnalysis && (
                <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="panel-title">Incident Report</div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', flex: 1 }}>
                    Generate a printable summary of this call for escalation or record-keeping.
                  </p>
                  <button onClick={() => setReportOpen(true)} className="btn-primary">
                    Generate report
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <IdentityVerificationModal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        analysisId={callAnalysis?.analysis_id}
        onVerified={async () => {
          if (!callAnalysis) return;
          setCallAnalysis({ ...callAnalysis, verification_status: 'VERIFIED' });
        }}
      />
      <IncidentReport analysis={callAnalysis} open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}

function StatusBadge({ status, elapsed }) {
  const map = {
    INCOMING: { label: 'INCOMING', color: 'var(--signal-cyan)' },
    CONNECTED: { label: 'CONNECTED', color: 'var(--signal-cyan)' },
    ANALYZING: { label: 'ANALYZING', color: 'var(--signal-cyan)' },
    'HIGH RISK': { label: 'HIGH RISK', color: 'var(--signal-red)' },
    FINALIZING: { label: 'FINALIZING', color: 'var(--signal-amber)' },
    'CALL ENDED': { label: 'CALL ENDED', color: 'var(--text-secondary)' },
    'HIGH RISK — CALL ENDED': { label: 'HIGH RISK — ENDED', color: 'var(--signal-red)' },
  };
  const meta = map[status] || { label: status, color: 'var(--text-secondary)' };
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: meta.color,
          boxShadow: `0 0 6px ${meta.color}`,
          animation: status === 'ANALYZING' || status === 'INCOMING' ? 'vox-pulse 1.2s infinite' : 'none',
        }}
      />
      <span className="display" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.06em', color: meta.color }}>
        ● {meta.label}
      </span>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{mm}:{ss}</span>
      <style>{`
        @keyframes vox-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
