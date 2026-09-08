import { useEffect, useRef, useState } from 'react';
import TrustDial from './TrustDial';
import { riskColor } from '../utils/format';
import { WavRecorder } from '../utils/wavRecorder';
import { analyzeChunk } from '../services/api';

// Public STUN server (Google's) used only to help the two browsers
// discover their reachable network addresses for peer-to-peer connection
// negotiation - no audio ever passes through it or any VoxShield server.
// No TURN server is configured, so this works on open networks / two tabs
// on the same machine, but may fail to connect across restrictive
// corporate NATs/firewalls without one.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const CHUNK_SECONDS = 1.5;

function randomRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function wsUrl(room) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/signal/${room}`;
}

export default function WebRTCDemo() {
  const [room, setRoom] = useState(randomRoomCode());
  const [phase, setPhase] = useState('idle'); // idle | connecting | signaling | connected | ended
  const [micStatus, setMicStatus] = useState('not requested');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [liveHistory, setLiveHistory] = useState([]);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const roleRef = useRef(null); // 'offerer' | 'answerer'

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    if (recorderRef.current) {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
      recorderRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  async function join() {
    setError(null);
    setPhase('connecting');
    setLiveHistory([]);

    try {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStatus('active');
    } catch {
      setError('Microphone permission denied or unavailable — WebRTC demo needs mic access on both sides.');
      setPhase('idle');
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));

    pc.onconnectionstatechange = () => setConnectionStatus(pc.connectionState);
    pc.ontrack = (event) => startAnalyzingRemoteAudio(event.streams[0]);

    const ws = new WebSocket(wsUrl(room));
    wsRef.current = ws;

    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate }));
      }
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'joined') {
        // Deterministic role: whoever's WebSocket connects first is the
        // "answerer" (peer_count === 1 at that moment); the second is the
        // "offerer" and will kick off the offer once both are ready.
        roleRef.current = msg.peer_count === 1 ? 'answerer' : 'offerer';
        setPhase('signaling');
      } else if (msg.type === 'ready') {
        setPhase('signaling-ready');
        if (roleRef.current === 'offerer') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({ type: 'offer', sdp: offer }));
        }
      } else if (msg.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
      } else if (msg.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      } else if (msg.type === 'ice') {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch {
          // benign if it arrives before the remote description is set
        }
      } else if (msg.type === 'peer_left') {
        setConnectionStatus('peer disconnected');
      } else if (msg.type === 'error') {
        setError(msg.message);
        setPhase('idle');
      }
    };

    ws.onerror = () => setError('Signaling connection failed.');
  }

  function startAnalyzingRemoteAudio(remoteStream) {
    setPhase('connected');
    const recorder = new WavRecorder({
      chunkSeconds: CHUNK_SECONDS,
      onChunk: async (blob, idx) => {
        try {
          const result = await analyzeChunk(blob, idx);
          setLiveHistory((prev) => [...prev, result].slice(-20));
        } catch {
          // skip a failed chunk rather than breaking the live demo
        }
      },
    });
    recorderRef.current = recorder;
    recorder.start(remoteStream).catch(() => {
      setError('Could not analyze the incoming peer audio stream.');
    });
  }

  function leave() {
    cleanup();
    setPhase('ended');
    setConnectionStatus('disconnected');
    setMicStatus('not requested');
  }

  const latest = liveHistory[liveHistory.length - 1] || null;

  return (
    <div className="panel">
      <div className="panel-title">Controlled WebRTC / VoIP Security Demonstration</div>
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: -6, marginBottom: 14 }}>
        A real, working peer-to-peer WebRTC audio connection between two browser tabs/devices —
        analyzed live through the same detection engine as the rest of VoxShield. This is
        <strong> not</strong> cellular call interception and does not access audio from another
        person's phone; it demonstrates how VoxShield's engine could plug into a supported VoIP or
        enterprise communication platform in a future deployment.
      </p>

      {phase === 'idle' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Room code (share with the other browser tab/device)</span>
            <input value={room} onChange={(e) => setRoom(e.target.value.toUpperCase())} className="vs-input" style={{ fontFamily: 'var(--font-mono)' }} />
          </label>
          <button onClick={join} className="btn-primary">Join room &amp; connect microphone</button>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0 }}>
            Open this same page in a second tab or device, enter the same room code, and join
            from there too. Exactly two participants per room.
          </p>
        </div>
      )}

      {phase !== 'idle' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
            <StatusPill label="Room" value={room} />
            <StatusPill label="Microphone" value={micStatus} good={micStatus === 'active'} />
            <StatusPill label="Connection" value={connectionStatus} good={connectionStatus === 'connected'} />
            <StatusPill label="Analysis" value={phase === 'connected' ? 'live' : 'waiting for peer'} good={phase === 'connected'} />
          </div>

          {phase === 'connected' && (
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <TrustDial score={latest?.trust_score ?? null} riskLevel={latest?.risk_level ?? 'LOW'} analyzing size={160} />
              {liveHistory.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 400 }}>
                  {liveHistory.map((h, i) => (
                    <span key={i} className="mono" style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: `1px solid ${riskColor(h.risk_level)}`, color: riskColor(h.risk_level) }}>
                      {h.trust_score}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <button onClick={leave} className="btn-outline">Leave / end session</button>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--signal-red)', marginTop: 10 }}>{error}</div>}

      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
        Uses a public STUN server for NAT traversal only (no TURN server configured — may not
        connect across restrictive corporate networks). Verified: the signaling relay itself
        (WebSocket message exchange) via automated tests. Not independently verified in this
        build environment: live two-browser microphone audio end-to-end, since that requires
        real audio hardware and two separate browser contexts.
      </p>
    </div>
  );
}

function StatusPill({ label, value, good }) {
  return (
    <div>
      <span style={{ color: 'var(--text-muted)' }}>{label}: </span>
      <span className="mono" style={{ color: good ? 'var(--signal-green)' : 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}
