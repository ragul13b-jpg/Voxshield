# VoxShield

**AI-Powered Real-Time Detection and Prevention of Voice Cloning
Impersonation Attacks** — SIH 2026, problem statement **SIH26104**.

VoxShield is a hackathon prototype that analyzes voice audio (upload,
microphone recording, or live streamed chunks), scores how likely it is to
be AI-generated / cloned, explains the evidence behind that score, warns the
user, and blocks a simulated sensitive transaction until identity is
independently verified.

> **This is a prototype, not a production telecom security system.**
> Detection uses heuristic acoustic, prosody, speaker-consistency and
> contextual-risk analysis — not a trained deepfake-detection model or real
> speaker-recognition system — and should not be treated as forensic-grade
> proof of voice authenticity. See `backend/README.md` for how detection
> actually works and how it's designed to be upgraded.

> **For SIH judging:** see `SIH26104_COVERAGE.md` for a dimension-by-dimension
> coverage map, and `FINAL_IMPLEMENTATION_STATUS.md` for the full test log,
> exact claims that are safe to present, and exactly what is not implemented.

---

## Quick start

You need two terminals: one for the backend, one for the frontend.

### 1. Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Leave this running. It serves the API at `http://localhost:8000` and
auto-generates the demo audio samples on first startup.

### 2. Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

That's it — the dashboard proxies `/api/*` requests to the backend
automatically (see `frontend/vite.config.js`).

### No microphone? No problem

Click **Demo Mode** in the Voice Input panel and choose Natural / Synthetic
/ Noisy — these are bundled, deterministic samples generated on the backend
and don't need microphone access.

### Starting the Live Call Demo

Open the app — **Live Call Monitor** is the default landing tab. Click one
of the three scenario buttons:

- **Natural Call** → LOW risk
- **Suspicious Call** → SUSPICIOUS
- **AI-Cloned Call** → HIGH risk, warning banner, blocked transaction

Watch the trust score update several times while the "call" is active, then
try **Verify Identity** on the AI-Cloned scenario to unblock the simulated
transaction. No microphone needed. If you want to try it with your own
voice instead, click "Use my microphone instead" on the same screen.

---

## What to try (matches the full SIH26104 flow)

**Live Call Monitor (the primary demo — this is the default landing tab):**
```
Start a demo call (Natural / Suspicious / AI-Cloned) or use your microphone
        ↓
Live audio analysis while the call is active
   (trust score updates every ~1.5s from real chunk analysis)
        ↓
Live detection evidence updates (spectral / prosody / temporal / synthetic)
        ↓
HIGH RISK reached → warning banner appears mid-call
        ↓
Call ends → full contextual risk assessment finalizes the analysis
        ↓
Transaction simulator → blocked while risk is HIGH and unverified
        ↓
Identity verification workflow → mark as independently verified
        ↓
Transaction simulator → unblocked once verified
        ↓
Incident report (printable / downloadable) — also appears in History
```

**Dashboard (upload / record / demo / reference profile — unchanged):**
```
Upload / Record / Demo audio  (+ optional context, +optional reference profile)
        ↓
Preprocess + multi-layer voice analysis
   (acoustic & spectral, prosody & behavioral, synthetic-artifact,
    cross-session speaker consistency)
        ↓
Contextual enrichment (caller/contact + transaction metadata)
        ↓
Risk fusion → Voice Trust Score
        ↓
Explainable evidence, threat timeline, warning, transaction block,
identity verification, incident report
```

Also try:
- **Reference Profile** tab to enroll a "known voice" and see cross-session
  consistency checked on later analyses (works in both Live Call Monitor
  and the Dashboard)
- The **Caller & Transaction Context** panel on the Dashboard (toggle
  "Include in next analysis") to see contextual risk fuse into the score
- **History** to see past analyses — Live Call sessions are labeled
  distinctly (e.g. "Live Call — AI-Cloned Call (Dad)")
- **AI Deepfake Detector** — a real pretrained model (AASIST) is bundled
  and used automatically if you install `requirements-ai.txt`
  (`pip install -r requirements-ai.txt` in `backend/`). Without it,
  detection still works via the existing signal-based engine.

---

## What's new in this inspection & repair pass (transcription, honesty, polish)

This pass inspected the working prototype end-to-end for anything static,
decorative, or unimplemented-but-claimed, and fixed it:

- **Real speech-to-text transcription** — a genuine `faster-whisper`
  integration (`app/analysis/transcription.py`), not a placeholder. Runs on
  the exact same preprocessed audio used for acoustic analysis. Shown in
  its own **Transcription** panel, clearly separate from the simulated
  **Incoming Request** text in the transaction simulator — the two are
  never conflated. If the model can't be loaded or confidence is too low,
  the UI honestly says *"Transcription unavailable or low confidence"*
  instead of inventing text. **The model downloads on first use and needs
  network access to Hugging Face** — see `backend/README.md` for details.
- **Professional Risk Fusion panel** — a SOC-style bar breakdown (Acoustic/
  Spectral, Pitch/Prosody, Temporal/Rhythm, Synthetic Artifacts, Speaker
  Consistency) plus an overall risk %, classification, and confidence line,
  computed from the current analysis's actual indicator scores.
- **Real audio player + file metadata** — upload/record/demo audio is
  played back with native browser controls (play/pause/seek/volume) and
  shows filename, format, size, and duration for whatever was analyzed.
- **History now includes Trust Score, language, and verification status**
  (previously only risk score/level) — added via a safe, additive SQLite
  migration that won't break an existing database.
- **Global error handling hardened** — malformed/unsupported audio,
  microphone denial, and any unexpected server error return clean messages
  (never a Python stack trace) instead of crashing.
- **`VITE_API_BASE_URL`** env var support for pointing a production build at
  a non-local backend, without hardcoding `localhost` into app logic.
- **Live Call Monitor's honesty disclaimer strengthened** — explicitly
  labeled "FUTURE DEPLOYMENT — REAL-TIME CALL INTEGRATION" for what isn't
  implemented (real telephony), separate from what genuinely runs today.
- **Re-verified dynamic scoring end-to-end** — different audio reliably
  produces different trust scores (see "Most important test" below).

### Most important test — dynamic scoring, verified

```
POST /api/demo?key=natural   -> trust_score 90, LOW
POST /api/demo?key=synthetic -> trust_score 31, HIGH
POST /api/demo?key=noisy     -> trust_score 63, SUSPICIOUS
```
Three different inputs, three different scores, confirmed on a from-scratch
install with a fresh database. There is no hardcoded/constant score
anywhere in `app/analysis/` or `app/services/analysis_service.py`.

---

## What's new in the final gap-closure pass (real AI deepfake detector)

This pass closed the biggest remaining gap identified in a fresh inspection
of the codebase: VoxShield's synthetic-voice detection was entirely
heuristic/signal-based (real, working, but not a trained model). It now
also includes a genuine pretrained deep-learning detector, integrated as an
additional, fully optional signal in risk fusion:

- **AASIST anti-spoofing model** (`app/analysis/deepfake_detector.py`) - a
  real, published, peer-reviewed model (Jung et al., ICASSP 2022) for the
  ASVspoof benchmark. The model code and pretrained weights (~426KB) are
  copied verbatim from the official MIT-licensed repository
  (github.com/clovaai/aasist) and bundled directly in this project - no
  download needed, works offline. This is a genuine integration, not a
  placeholder: it actually runs the model and returns real
  `synthetic_probability`/`natural_probability` values from inference.
- **Fully optional, clearly separated dependency** - `torch` is NOT in
  `requirements.txt` (it's a large, heavy dependency). Install
  `requirements-ai.txt` to enable this detector. Without it, VoxShield
  works exactly as before and reports "AI detector unavailable -
  signal-based analysis used" instead of fabricating a number.
- **Crash-isolated by design** - during development, importing `torch`
  triggered a low-level crash (SIGBUS) in one test environment that a
  normal Python `try/except` cannot catch, and it took down the entire
  server. This was found through actual testing, not assumed. The fix:
  the AI detector now runs its torch-dependent code (import, model load,
  inference) inside an isolated subprocess. If that subprocess crashes for
  any reason, the parent API server detects it and reports the detector as
  unavailable - it does **not** go down. This was verified by deliberately
  reproducing the crash and confirming the main server stayed up and kept
  serving other requests correctly.
- **New endpoint**: `GET /api/ai-detector-status` mirrors the existing
  transcription-status pattern, letting the UI show detector availability
  without running a full analysis.
- **Honest, documented limitations**: AASIST was trained on ASVspoof2019 -
  a benchmark of specific 2019-era TTS/voice-conversion attacks. It has
  **not** been independently validated against modern voice-cloning tools,
  and the evidence text/report always says so rather than implying
  certainty.

Everything else — acoustic analysis, transcription, speaker consistency,
context engine, risk fusion weighting, Live Call Monitor, transaction
simulation, verification, history, incident reports — is unchanged.

---

## What's new in the Live Call Monitor upgrade

Building on the working prototype (audio-only acoustic detection, demo mode,
waveform/spectrogram, transaction simulation, identity verification,
history, incident reports, contextual enrichment, speaker consistency — all
preserved), this pass adds the **Live Call Monitor**: the primary demo now
shows detection happening *while a call is active*, not just
upload-then-analyze.

- **Live Call Monitor tab** (now the default landing view) — an incoming
  call card (caller, number, contact status, request), a live-updating
  Voice Trust Score, live evidence, and a live timeline, all driven by the
  *same* analysis engine as the rest of the app.
- **Three deterministic demo call scenarios** — Natural / Suspicious /
  AI-Cloned — built from the existing bundled demo audio, sliced into
  overlapping ~1.6s windows and fed through the existing
  `/api/analyze-chunk` endpoint at a realistic pace, so the trust score
  visibly updates several times during the "call." Same input audio always
  produces the same sequence — fully deterministic, no randomness.
- **Real microphone live call** — same UI treatment, but streamed from your
  own microphone in ~1.5s chunks (reusing the existing `WavRecorder`
  chunked-mic mode) instead of a demo file, for a genuine near-real-time
  prototype analysis. Falls back cleanly to the demo scenarios if
  microphone permission isn't available.
- **Call finalization reuses existing endpoints** — when a demo call
  finishes (or a mic call is ended), VoxShield runs one full analysis over
  the complete audio *with* the call's context (caller, contact status,
  transaction) via the existing `/api/demo` or `/api/analyze-record`
  endpoints — producing a normal, fully-featured analysis record that the
  *existing* Transaction Simulator, Identity Verification modal, History,
  and Incident Report components consume unmodified.
- **Minimal backend additions** (see "Files added/modified" below) — no new
  analysis logic, no new scoring, no duplicate application. The chunk
  endpoint now also returns its indicators (previously computed but not
  surfaced); the demo audio folder is exposed as static files so the
  browser can slice it; a few endpoints accept an optional descriptive
  label so Live Call sessions are distinguishable in History.

**Technical honesty, as before:** the Live Call Monitor does not intercept
real cellular calls or access audio from another device. It analyzes
either a bundled demo recording or your own browser microphone, in short
chunks, and is explicitly labeled as a prototype/simulation.

---

## Project structure

```
voxshield/
├── backend/                  FastAPI service — see backend/README.md
│   ├── app/
│   │   ├── main.py           app entrypoint, CORS, startup, /demo_audio static mount
│   │   ├── config.py         all thresholds/weights/rules (tune here)
│   │   ├── api/routes.py     all HTTP endpoints
│   │   ├── analysis/
│   │   │   ├── feature_extraction.py   MFCC/spectral/pitch/temporal features
│   │   │   ├── fusion_engine.py        acoustic-only scoring (unchanged core)
│   │   │   ├── speaker_consistency.py  cross-session voice comparison
│   │   │   ├── context_engine.py       caller/contact + transaction risk
│   │   │   └── risk_fusion.py          combines all signals -> final score
│   │   ├── services/         SQLite storage, orchestration, demo audio generator
│   │   └── schemas/          Pydantic response models
│   ├── demo_audio/           auto-generated demo samples, also served as static
│   │                         files at /demo_audio/* for the Live Call Monitor
│   └── requirements.txt
│
├── frontend/                 React + Vite SOC dashboard — see frontend/README.md
│   └── src/
│       ├── components/
│       │   ├── LiveCallMonitor.jsx     the flagship live-call demo + real mic mode
│       │   ├── ContextPanel, ReferenceProfilePanel, RiskBreakdown
│       │   ├── InputPanel, TrustDial, WaveformCanvas, SpectrogramCanvas,
│       │   │   EvidenceCards, ThreatTimeline, WarningBanner,
│       │   │   TransactionSimulator, IdentityVerificationModal,
│       │   │   HistoryView, IncidentReport, Header
│       ├── services/api.js   backend API client
│       └── utils/            WAV recorder + audio-slicing helpers, formatting
│
└── README.md                 you are here
```

## Files added / modified for the Live Call Monitor upgrade

**Backend (minimal, additive changes only):**
- `app/main.py` — mounts `demo_audio/` as static files at `/demo_audio` so
  the browser can fetch and slice demo audio client-side
- `app/services/analysis_service.py` — `run_chunk_analysis` now also
  returns `indicators` (already computed, previously not surfaced)
- `app/api/routes.py` — `/api/analyze`, `/api/analyze-record`, `/api/demo`
  accept two new optional form fields, `source_label` and `source_tag`, so
  Live Call sessions are labeled distinctly in History. No new endpoints.

**Frontend:**
- `src/components/LiveCallMonitor.jsx` — **new**, the Live Call Monitor tab
- `src/utils/wavRecorder.js` — added `fetchAndDecodeAudio` and
  `sliceIntoWindows` helpers (file → sliding-window WAV blobs); the
  existing `WavRecorder` class (mic recording) is unchanged
- `src/services/api.js` — `appendMeta` now also forwards `sourceLabel`/`sourceTag`
- `src/components/Header.jsx` — added the "Live Call Monitor" nav tab
- `src/App.jsx` — added the `live-call` view (now the default) and renders
  `<LiveCallMonitor />`

Everything else — feature extraction, fusion engine, speaker consistency,
context engine, risk fusion, database, Dashboard, upload/record/demo flows,
reference profiles, transaction simulation, identity verification, history,
incident reports — is **unchanged** from the previous version.

## Tech stack

- **Frontend:** React (Vite), plain CSS design system, `<canvas>` for
  waveform/spectrogram (no charting dependency)
- **Backend:** Python, FastAPI, librosa/numpy/scipy/soundfile for audio,
  SQLite for storage
- **Detection:** deterministic feature-based + rule fusion engine across
  four signal groups (see `backend/README.md` → "How detection works")
- **No new dependencies** were added for the Live Call Monitor feature —
  it's built entirely from the existing backend endpoints/engine and the
  browser's native Web Audio API.

## Known limitations (by design, for a hackathon prototype)

- Not connected to any real banking/telecom system — the transaction
  simulator, "block call" behavior, and caller-ID context are simulations.
- Detection is heuristic, not a trained classifier — thresholds/weights in
  `backend/app/config.py` are documented but not fitted on labelled data.
- **Live Call Monitor does not intercept real cellular calls or access
  audio from another device.** The demo scenarios replay bundled audio
  files sliced into chunks; the microphone mode analyzes your own browser
  microphone. Both are explicitly labeled as prototype/simulation.
- "Live"/"near-real-time" analysis processes short (~1.5-1.6s) audio
  chunks sequentially, not a continuous telephone intercept.
- The demo call's per-chunk trust score is audio-only (matches the
  existing live-monitor chunk behavior); the caller/contact/transaction
  context is folded in only at call finalization, which is when the
  score can shift again — this is intentional (context is a separate
  analysis layer) but means the very last displayed number may differ
  slightly from the live in-call sequence.
- Speaker-consistency is a coarse acoustic-similarity check, not a trained
  speaker-embedding model — a well-matched voice clone (same timbre) may
  still show high similarity to a genuine reference. Real deployments
  would replace this module with a proper speaker-recognition model behind
  the same interface.
- The AI Deepfake Detector (AASIST) is a real trained model, but it was
  trained on ASVspoof2019 — 2019-era TTS/voice-conversion attacks. It has
  not been independently validated against modern voice-cloning tools,
  and it's fully optional (`torch` is not a default dependency). Enable
  it via `pip install -r requirements-ai.txt`.
- Multilingual/accent support is architectural readiness (language-agnostic
  features + a language selector), not a validated claim of accuracy across
  the listed languages.
- Edge/on-device inference is not implemented; the codebase is structured
  to make that addition straightforward later.
- Detection accuracy is not claimed or guaranteed to be 100% under any mode.
