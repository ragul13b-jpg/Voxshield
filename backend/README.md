# VoxShield Backend

FastAPI service that does the actual voice-authenticity risk assessment:
preprocessing → multi-layer voice analysis → contextual enrichment → risk
fusion → structured JSON response, persisted to SQLite.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

**Optional:** to enable the real AI deepfake detector (AASIST), also run:
```bash
pip install -r requirements-ai.txt
```
This installs `torch` (~500MB+). Skip it if you don't need this signal —
everything else works fine without it. See "AI deepfake detector" below.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

- API root: http://localhost:8000
- Interactive docs: http://localhost:8000/docs
- Demo audio is generated automatically on first startup — no setup needed.

## Endpoints

| Method | Path                     | Purpose                                                |
|--------|--------------------------|---------------------------------------------------------|
| GET    | `/health`                | Liveness check                                          |
| POST   | `/api/analyze`           | Analyze an uploaded audio file. Form fields: `file` (required), `context` (optional JSON string), `profile_id` (optional), `language` (optional) |
| POST   | `/api/analyze-record`    | Analyze a full microphone recording (same optional fields as above) |
| POST   | `/api/analyze-chunk`     | Near-real-time prototype analysis of one short chunk (audio-only) |
| GET    | `/api/demo-samples`      | List the built-in demo samples + expected risk level     |
| POST   | `/api/demo?key=natural`  | Run analysis on a bundled demo sample (`natural`/`synthetic`/`noisy`); accepts the same optional `context`/`profile_id`/`language` form fields |
| GET    | `/api/analysis/{id}`     | Fetch a previously stored analysis                        |
| GET    | `/api/history`           | List recent analyses (id, timestamp, score, risk level)   |
| POST   | `/api/verify`            | Mark an analysis as independently verified (`analysis_id`, `verified`) |
| POST   | `/api/transaction/check` | Simulated transaction gate — blocks HIGH-risk + unverified requests (`analysis_id`, `amount_inr`) |
| POST   | `/api/enroll-profile`    | Enroll a "known voice" reference sample (`file`, `name`) for cross-session consistency checks |
| GET    | `/api/profiles`          | List enrolled voice profiles |
| GET    | `/api/profiles/{id}/sessions` | List all sessions stored for a profile (multi-session history) |
| GET    | `/api/languages`         | Language options actually passed to the transcription engine |
| GET    | `/api/transcription-status` | Whether the speech-to-text engine is currently loaded/usable |
| GET    | `/api/ai-detector-status` | Whether the AASIST AI deepfake detector is currently loaded/usable |
| WS     | `/ws/signal/{room_id}`   | WebRTC signaling relay (SDP/ICE only, never touches audio) |
| GET    | `/api/privacy`           | Current privacy/retention posture for the UI badge |

All analysis endpoints return the same shape — see `app/schemas/analysis.py`.
Example (truncated):

```json
{
  "analysis_id": "VX-0016",
  "source": "demo",
  "trust_score": 32,
  "risk_score": 68,
  "risk_level": "HIGH",
  "human_probability": 0.31,
  "synthetic_probability": 0.69,
  "risk_breakdown": {
    "acoustic_score": 69,
    "speaker_consistency_score": null,
    "context_score": 68,
    "weights_used": {"acoustic": 0.562, "context": 0.437},
    "final_risk_score": 68
  },
  "indicators": [
    {"name": "Contextual risk", "severity": "HIGH", "contribution": 30,
     "explanation": "Transaction type is otp or pin share; Contact status is unknown; ..."}
  ],
  "speaker_consistency": null,
  "context": { "input": {"...": "..."}, "risk_fraction": 0.68, "level": "HIGH", "factors": [ ] },
  "verification_status": "REQUIRED",
  "recommendation": "Do not perform sensitive actions until identity has been independently verified...",
  "feature_snapshot": { "...": "raw acoustic feature values" },
  "waveform": { "points": [] },
  "spectrogram": { "db": [[]], "times": [], "freqs": [] },
  "timeline": [{"t": 0.0, "label": "Audio received"}]
}
```

## How detection works

### 1. Acoustic & spectral / prosody & behavioral / synthetic-artifact analysis

`app/analysis/feature_extraction.py` extracts standard acoustic features with
`librosa`: MFCCs (+ deltas), spectral centroid/bandwidth/rolloff/flatness,
zero-crossing rate, RMS energy, and pitch (F0) via `pyin` (including jitter
and voiced-frame ratio).

`app/analysis/fusion_engine.py` is a deterministic, feature-based + rule
engine (no trained classifier, no randomness — see `app/config.py` for the
reference ranges, weights, and thresholds). Each feature is compared against
a "natural speech" reference band; how far outside that band it falls maps
smoothly to an anomaly score, combined into 4 explainable indicator
categories: spectral anomaly, prosody anomaly, temporal anomaly, synthetic
artifacts.

### 2. Cross-session speaker consistency (prototype)

`app/analysis/speaker_consistency.py` compares the current sample's MFCC
vector, pitch mean, and spectral centroid against an enrolled "known voice
profile" (see `/api/enroll-profile`) using cosine similarity + closeness
scoring. This is explicitly **not production-grade speaker recognition** —
it's a coarse, explainable stand-in for where a proper speaker-embedding
model (x-vector/ECAPA-TDNN) would plug into the same interface. See the
top-level README's "Known limitations" for what this does and doesn't catch.

### 3. Contextual enrichment

`app/analysis/context_engine.py` turns caller/contact status, transaction
type/amount, historical-fraud flag, and simple urgency-language detection
into a deterministic risk fraction. Every contribution is traceable to a
rule in `app.config.CONTEXT_RULES` — nothing is guessed or randomized. This
never touches a real telecom or banking system; `context` is supplied by
the caller of the API.

### 4. Risk fusion

`app/analysis/risk_fusion.py` combines whichever of the three signal groups
above are available (acoustic is always present; speaker-consistency and
context are optional) using weights from `app.config.RISK_FUSION_WEIGHTS`,
renormalized to the signals actually present. This means an audio-only
analysis (the original prototype's upload/demo/live-chunk flows) scores
**identically to before an context/profile signal is supplied** — acoustic
weight becomes 1.0 automatically.

The final risk score maps to a **Voice Trust Score** (`trust_score = 100 -
risk_score`) and a risk level via `app.config.RISK_THRESHOLDS`:

- trust 70–100 → **LOW** risk
- trust 40–69  → **SUSPICIOUS**
- trust 0–39   → **HIGH** risk

## AI deepfake detector (AASIST, optional)

`app/analysis/deepfake_detector.py` integrates [AASIST](https://github.com/clovaai/aasist)
(Jung et al., ICASSP 2022), a real published anti-spoofing model for the
ASVspoof benchmark. The model code and pretrained weights
(`app/analysis/deepfake_model/`, ~426KB) are copied verbatim from the
official MIT-licensed repository and bundled in this project — no network
access or download needed at runtime, unlike transcription.

**This is genuinely optional.** `torch` is not in `requirements.txt`
because it's a large (~500MB+) dependency. Without it, this signal is
simply omitted from risk fusion (see `RISK_FUSION_WEIGHTS` in `config.py`)
and the API reports `"available": false` with an honest reason — it never
fabricates a probability. Check `GET /api/ai-detector-status` to see the
current state.

**Why the torch-dependent code runs in a subprocess:** during development,
importing `torch` triggered a SIGBUS (a low-level, non-Python-catchable
crash) in one test environment, and it took down the entire server
process — not just the request being handled. This was caught by actually
testing the failure path, not assumed. The fix: all torch-dependent code
(import, model load, inference) runs inside an isolated child process
(`multiprocessing`, `spawn` context). If that child crashes, times out, or
exits abnormally for any reason, the parent server detects it via the
process exit code and reports the detector as unavailable — the API keeps
serving every other request normally. This was verified by deliberately
reproducing the crash and confirming the server survived it.

**Honest limitation:** AASIST was trained on ASVspoof2019 LA — a benchmark
of specific 2019-era TTS/voice-conversion attacks, mostly English speech.
It has **not** been independently validated by this project against modern
zero-shot voice-cloning tools, other languages, or unusual recording
conditions. Treat its output as one input signal among several, not as a
ground-truth verdict — the UI and incident report say this explicitly.

## Speaker consistency, multi-session, and why not a real speaker-embedding model

`app/analysis/speaker_consistency.py` compares a sample against an enrolled
reference profile using a hand-picked acoustic signature (MFCC mean vector,
pitch mean/std, spectral centroid) - cosine similarity + closeness scoring,
not a trained speaker-embedding model. This is explicitly labeled
"prototype voice-signature consistency" everywhere in the UI and API, never
"speaker verification" or "speaker embeddings."

**Multi-session comparison is real**: every sample ever compared against a
profile (starting with the enrollment sample) is stored as its own session
in the `profile_sessions` table. Later analyses are checked against *every*
prior session, and the response includes `sessions_compared`,
`min_similarity`, and the per-session breakdown - not just a single
snapshot comparison.

**Why a real deep-learning speaker-embedding model (e.g. ECAPA-TDNN) wasn't
integrated**: during this pass, a GitHub-hosted ECAPA-TDNN implementation
with bundled pretrained weights (~67MB, directly downloadable, same
approach used for AASIST) was found and investigated. It was **not
integrated because the repository has no declared license** (`license:
null` via the GitHub API, no LICENSE file) - bundling and redistributing
unlicensed third-party code/weights would not be responsible, regardless
of technical feasibility. AASIST (used for deepfake detection) was
integrated specifically because it has an explicit MIT license permitting
this use. A properly-licensed speaker-embedding model remains a reasonable
future addition behind the same interface.

## Communication adapters

`app/adapters/communication_adapter.py` defines a `CommunicationAdapter`
interface so the analysis engine doesn't depend on any one audio source.
`DemoFileAdapter` and `BrowserMicAdapter` are implemented; `WebRTCAdapter`
is "integration ready" (the actual WebRTC code lives in the frontend +
signaling relay below, not yet routed through this class); `VoIPAdapter`
and `TelecomAdapter` are documented stubs whose methods all raise
`NotImplementedError` on purpose - they cannot be accidentally used as if
they worked.

## Controlled WebRTC/VoIP demonstration

`/ws/signal/{room_id}` is a minimal WebSocket relay (see `app/api/routes.py`)
that lets exactly two browser tabs/devices exchange SDP offers/answers and
ICE candidates to establish a real, direct peer-to-peer WebRTC audio
connection - it never touches or analyzes audio itself. The frontend
(`WebRTCDemo.jsx`) then captures the received remote audio stream and sends
it to `/api/analyze-chunk`, the same endpoint the microphone flow uses.

**What was verified**: the signaling relay itself, via automated tests with
two real WebSocket clients (message relay both directions, third-peer
rejection, disconnect cleanup - see `FINAL_IMPLEMENTATION_STATUS.md` for
the exact test output).

**What was not independently verified in this environment**: true
two-browser, real-microphone, end-to-end WebRTC audio analysis, since that
requires two separate browser contexts with real audio hardware, which
wasn't available for testing here. Uses a public STUN server for NAT
traversal only; no TURN server is configured, so it may not connect across
restrictive corporate networks.

This is explicitly **not** telecom/cellular call interception.

## Evaluation framework

```bash
python -m app.evaluation.evaluate --dataset ./evaluation_data --csv results.csv
```

Runs the real analysis pipeline (not a simplified copy) over a directory of
audio files, with an optional `labels.csv` (`filename,label,category`,
where `label` is `genuine`/`spoof`/`unlabeled`). Reports real processing
times and risk distributions always; only computes precision/recall/F1/
confusion-matrix when at least 30 labelled samples exist - below that it
explicitly states the dataset is insufficient rather than reporting a
misleading number. `backend/evaluation_data/` ships with the 3 bundled demo
samples as a working example - too small for a real benchmark, and the
script says so when you run it.

## Storage

SQLite (`voxshield.db`, created automatically). The storage layer
(`app/services/db.py`) only exposes functions like `save_analysis`,
`get_analysis`, `list_history`, `save_profile`, `get_profile` — swapping in
PostgreSQL/Supabase later only requires reimplementing that one module.
Schema changes are applied as safe, additive `ALTER TABLE` migrations at
startup (a column that already exists is silently skipped) - an existing
database from an older version of the app won't break on upgrade.

Per the privacy posture in `app/config.py::PRIVACY_CONFIG`, raw audio is
processed in-memory and **not** persisted — only derived features and
analysis results are stored.

## Transcription (speech-to-text)

`app/analysis/transcription.py` uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
(a multilingual Whisper implementation) to genuinely transcribe the speech
in each analyzed sample. It is **not** a placeholder or hardcoded string.

**First-run model download:** the "tiny" multilingual checkpoint downloads
from Hugging Face the first time transcription actually runs, and is
cached locally afterwards. This needs network access to `huggingface.co`
on that first call. If the model can't be downloaded or loaded for any
reason, transcription degrades honestly: the API returns
`"available": false` with a human-readable reason, and the UI shows
*"Transcription unavailable or low confidence"* instead of ever inventing
text. Check `GET /api/transcription-status` to see the engine's current
state without running a full analysis.

**Languages:** the model is Whisper's multilingual checkpoint, which
documents support for the eight languages listed in
`app/config.py::SUPPORTED_LANGUAGES` (English, Hindi, Tamil, Telugu,
Malayalam, Kannada, Bengali, Marathi) among ~90 others. The selected
language is passed straight through to the model when specified; leaving
it unset lets Whisper auto-detect. **Recognition accuracy has not been
independently benchmarked per language in this prototype** and will vary
with audio quality, accent, and dialect - Indian-language accuracy in
particular tends to improve by switching
`TRANSCRIPTION_CONFIG["model_size"]` from `"tiny"` to `"base"` or `"small"`
(larger download, slower per-analysis, better accuracy).

**Why it's skipped in chunk/live mode:** `/api/analyze-chunk` (used by the
mic-based Live Monitor and the Live Call Monitor's per-chunk score updates)
intentionally does not run transcription - a few seconds of ASR latency
every ~1.5s would break the near-real-time experience. Full analyses
(upload, record, demo, and Live Call Monitor's end-of-call finalization) do
run it.

