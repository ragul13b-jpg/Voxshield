# VoxShield Frontend

React + Vite SOC-style dashboard for VoxShield. Talks to the FastAPI backend
via `/api/*` (proxied to `http://localhost:8000` in dev, see `vite.config.js`).

## Setup

```bash
cd frontend
npm install
```

## Run (development)

Make sure the backend is running first (`uvicorn app.main:app --port 8000`
from `backend/`), then:

```bash
npm run dev
```

Open http://localhost:5173

## Build for production

```bash
npm run build
npm run preview   # serves the built dist/ locally
```

For a production deployment, point the built frontend at your backend's URL
(update the `/api` and `/health` proxy targets in `vite.config.js`, or serve
both behind the same reverse proxy).

## Structure

- `src/components/` — dashboard UI pieces:
  - `InputPanel` — Upload / Record / Live Monitor / Demo Mode / Reference Profile tabs
  - `TrustDial` — the radial Voice Trust Score gauge (high = trustworthy, matches the SIH example)
  - `RiskBreakdown` — shows the acoustic / speaker-consistency / context weighting behind the final score
  - `ContextPanel` — optional caller/contact + transaction context, toggled on before an analysis
  - `ReferenceProfilePanel` — enroll a "known voice" and select it for cross-session consistency checks
  - `WaveformCanvas` / `SpectrogramCanvas` — audio visualizations
  - `EvidenceCards` — all detection indicators (acoustic/prosody/synthetic/consistency/context), auto-populated from whatever the backend returns
  - `ThreatTimeline`, `WarningBanner`, `TransactionSimulator`, `IdentityVerificationModal`, `HistoryView`, `IncidentReport`
- `src/services/api.js` — thin fetch wrapper for all backend endpoints
- `src/utils/wavRecorder.js` — browser microphone → WAV encoder (Web Audio
  API). Used instead of `MediaRecorder`'s compressed webm/opus output so the
  backend can read recordings natively without needing `ffmpeg`.

## Notes

- Microphone access requires a secure context (`localhost` is fine; a remote
  deployment needs HTTPS).
- If microphone permission is denied or unavailable, use **Demo Mode** — it
  works without a microphone.
- The **Context** and **Reference Profile** signals are opt-in: leave the
  "Include in next analysis" toggle off and no profile selected to get the
  original audio-only scoring exactly as before.
