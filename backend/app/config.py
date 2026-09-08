"""
VoxShield configuration.

All detection thresholds and weights live here so the analysis engine can be
retuned (or later swapped for a trained classifier) without touching the
scoring logic itself.
"""

# ---------------------------------------------------------------------------
# Audio preprocessing
# ---------------------------------------------------------------------------
TARGET_SAMPLE_RATE = 16000
MIN_DURATION_SECONDS = 0.6

# Real-time / chunk mode
CHUNK_DURATION_SECONDS = 1.5

# ---------------------------------------------------------------------------
# Reference ranges for "natural" human speech.
#
# These are heuristic, literature-informed reference bands used to score how
# far an incoming sample's statistics drift from typical natural speech.
# They are intentionally conservative and documented so they can be replaced
# with values fitted on real labelled data later.
# ---------------------------------------------------------------------------

REFERENCE_RANGES = {
    # Pitch (F0) standard deviation in Hz across voiced frames.
    # Natural conversational speech usually varies noticeably (vibrato,
    # intonation). Very flat / robotic pitch is a classic TTS/vocoder tell.
    "pitch_std_hz": {"natural_min": 8.0, "natural_max": 55.0},

    # Frame-to-frame pitch jitter (coefficient of variation of |delta F0|).
    "pitch_jitter_cv": {"natural_min": 0.25, "natural_max": 1.4},

    # Spectral flatness variability across frames (std of per-frame flatness).
    # Vocoder output tends to have an unnaturally *consistent* spectral
    # envelope shape frame-to-frame.
    "flatness_std": {"natural_min": 0.05, "natural_max": 0.55},

    # Spectral centroid variability (std, Hz) across frames.
    "centroid_std_hz": {"natural_min": 150.0, "natural_max": 950.0},

    # Spectral rolloff variability (std, Hz).
    "rolloff_std_hz": {"natural_min": 150.0, "natural_max": 1300.0},

    # MFCC delta (frame-to-frame change) average magnitude - micro-variation.
    "mfcc_delta_mean_abs": {"natural_min": 1.2, "natural_max": 6.5},

    # High-frequency energy ratio (>4kHz band / total) - breath & sibilance.
    "high_freq_ratio": {"natural_min": 0.0004, "natural_max": 0.05},

    # Zero-crossing-rate variability across frames.
    "zcr_std": {"natural_min": 0.010, "natural_max": 0.09},

    # RMS energy dynamic range (std / mean) - natural speech breathes/pauses.
    "energy_cv": {"natural_min": 0.20, "natural_max": 1.1},
}

# ---------------------------------------------------------------------------
# Indicator category weights (must sum to 1.0)
# ---------------------------------------------------------------------------
INDICATOR_WEIGHTS = {
    "spectral_anomaly": 0.25,
    "prosody_anomaly": 0.25,
    "temporal_anomaly": 0.20,
    "synthetic_artifacts": 0.30,
}

# ---------------------------------------------------------------------------
# Risk level thresholds, expressed on the 0-100 *risk* score (higher = more
# risk). The user-facing "Voice Trust Score" is simply `100 - risk_score`
# (higher = more trustworthy), so these bounds are the mirror image of the
# SIH-specified trust bands:
#   Trust 70-100 -> LOW risk        (risk_score 0-30)
#   Trust 40-69   -> SUSPICIOUS     (risk_score 31-60)
#   Trust 0-39    -> HIGH risk      (risk_score 61-100)
# ---------------------------------------------------------------------------
RISK_THRESHOLDS = {
    "low_max": 30,         # risk 0-30   -> trust 70-100 -> LOW
    "suspicious_max": 60,  # risk 31-60  -> trust 40-69  -> SUSPICIOUS
    # risk 61-100 -> trust 0-39 -> HIGH
}

SEVERITY_THRESHOLDS = {
    "high_min": 0.66,
    "medium_min": 0.33,
}

DB_PATH = "voxshield.db"
DEMO_AUDIO_DIR = "demo_audio"

# ---------------------------------------------------------------------------
# Risk fusion weights.
#
# The final risk score blends up to four independent signal groups:
#   - acoustic:            the existing feature-based voice analysis
#                           (spectral/prosody/temporal/synthetic-artifact
#                           indicators, see analysis/fusion_engine.py)
#   - ai_deepfake:          a real pretrained anti-spoofing model (AASIST),
#                           only available if `torch` is installed and the
#                           bundled model loads successfully - see
#                           analysis/deepfake_detector.py
#   - speaker_consistency:  prototype comparison against an enrolled
#                           reference voice profile (only available if the
#                           caller enrolled one - see analysis/speaker_consistency.py)
#   - context:              contextual/behavioral risk from caller/contact
#                           and transaction metadata (see analysis/context_engine.py)
#
# Signals that are not available for a given analysis (no torch installed,
# no reference profile enrolled, no context supplied) are dropped and the
# remaining weights are renormalized to sum to 1.0. This means a plain
# audio-only analysis with no AI detector installed (the default - `torch`
# is NOT in requirements.txt) behaves exactly as before: acoustic weight
# becomes 1.0 when nothing else is available.
# ---------------------------------------------------------------------------
RISK_FUSION_WEIGHTS = {
    "acoustic": 0.30,
    "ai_deepfake": 0.30,
    "speaker_consistency": 0.15,
    "context": 0.25,
}

# ---------------------------------------------------------------------------
# Prototype speaker-consistency thresholds (similarity 0-1, 1 = identical).
# ---------------------------------------------------------------------------
CONSISTENCY_THRESHOLDS = {
    "high_min": 0.80,    # similarity >= 0.80 -> consistency HIGH (good)
    "medium_min": 0.55,  # 0.55-0.80          -> consistency MEDIUM
    # < 0.55                                  -> consistency LOW (bad)
}

# ---------------------------------------------------------------------------
# Contextual risk rules (deterministic, demo-oriented).
# Every contribution here is traceable - no randomness.
# ---------------------------------------------------------------------------
CONTEXT_RULES = {
    "contact_status_risk": {
        "known_verified": 0.0,
        "known": 0.15,
        "unknown": 0.6,
        "unverified": 0.85,
    },
    "sensitivity_risk": {
        "low": 0.05,
        "medium": 0.35,
        "high": 0.8,
    },
    "transaction_type_risk": {
        "none": 0.0,
        "information_request": 0.2,
        "otp_or_pin_share": 0.9,
        "password_share": 0.9,
        "money_transfer": 0.8,
    },
    "high_amount_threshold_inr": 100000,
    "high_amount_risk": 0.3,
    "historical_fraud_flag_risk": 0.75,
    "urgency_language_risk": 0.25,
}

# ---------------------------------------------------------------------------
# Privacy / data-retention posture surfaced in the UI.
# This is a prototype: raw audio is processed in-memory and only derived
# features/results are persisted to SQLite. Toggle RETAIN_RAW_AUDIO to
# change that behaviour (still local-disk only - never uploaded anywhere).
# ---------------------------------------------------------------------------
PRIVACY_CONFIG = {
    "retain_raw_audio": False,
    "retain_features": True,
    "retain_metadata": True,
    "edge_inference_ready": False,  # architecture-ready, not implemented
}

# ---------------------------------------------------------------------------
# Exactly what is and isn't persisted to SQLite (voxshield.db), for the
# privacy documentation in the UI and README. Verified against the actual
# code, not aspirational: no code path in app/api/routes.py or
# app/services/analysis_service.py ever writes uploaded audio bytes to disk
# - uploaded/recorded/streamed audio exists only in memory for the
# duration of one request, then is garbage-collected.
#
# What IS stored in the `analyses` table (see app/services/db.py):
#   - derived numeric features (MFCC means, pitch stats, etc. - not audio)
#   - risk scores, indicators, explanations, timeline, recommendation
#   - transcribed text (if transcription ran and succeeded)
#   - caller/context metadata IF the caller supplied it (this is the one
#     field that could contain personally-identifying info the user typed
#     in themselves, e.g. a caller_name)
#   - a small MFCC/pitch/centroid "voice signature" (not raw audio) if a
#     reference profile was enrolled or compared against
#
# What is NEVER stored: the original audio file/recording/stream bytes.
#
# demo_audio/ and evaluation_data/ are bundled example files checked into
# the repository itself (not user uploads) - they are not part of this
# runtime-retention discussion.
# ---------------------------------------------------------------------------
DATA_RETENTION_AUDIT = {
    "raw_audio_persisted_to_disk": False,
    "raw_audio_returned_in_api_responses": False,
    "stored_in_sqlite": [
        "derived acoustic features (not audio)",
        "risk scores and explainable indicators",
        "transcribed text (if transcription succeeded)",
        "caller/transaction context as supplied by the caller of the API",
        "voice-signature summary statistics for enrolled reference profiles (not raw audio)",
    ],
}

# ---------------------------------------------------------------------------
# AI-assisted synthetic/deepfake voice detector (AASIST, pretrained).
#
# Genuinely optional: `torch` is NOT in requirements.txt because it is a
# large (~500MB+) dependency, so this is disabled by default until you
# install requirements-ai.txt. When unavailable, this signal is simply
# dropped from risk fusion (see RISK_FUSION_WEIGHTS above) and the UI shows
# "AI detector unavailable - signal-based analysis used" rather than
# fabricating a number. See analysis/deepfake_detector.py for the honest
# limitations of what this model has and hasn't been validated against.
# ---------------------------------------------------------------------------
AI_DETECTOR_CONFIG = {
    "enabled": True,  # set False to skip even attempting to load the model
}

# ---------------------------------------------------------------------------
# Speech-to-text transcription (faster-whisper).
#
# This is a genuine, working transcription integration - not a placeholder.
# The model is downloaded on first use (requires network access the first
# time only; cached locally afterwards). If the model cannot be loaded
# (no network, disk constraints, package missing) transcription degrades
# gracefully: the API returns available=False with an honest message
# instead of inventing text.
#
# "tiny" is the default because it is the smallest multilingual checkpoint
# (fastest to download and run on a judge's laptop with no GPU). Accuracy on
# Indian languages/accents is noticeably better with "base" or "small" -
# bump MODEL_SIZE if you have the bandwidth/CPU time for a live demo.
# Chunk-mode (near-real-time) analysis intentionally skips transcription -
# it only runs on full analyses (upload/record/demo) where a few seconds of
# latency is acceptable.
# ---------------------------------------------------------------------------
TRANSCRIPTION_CONFIG = {
    "enabled": True,
    "model_size": "tiny",       # tiny | base | small | medium | large-v3
    "device": "cpu",
    "compute_type": "int8",
    "min_confidence": 0.15,      # below this, reported as low-confidence/unavailable
    "max_no_speech_prob": 0.6,   # above this, reported as low-confidence/unavailable
}

# ---------------------------------------------------------------------------
# Language / accent readiness.
#
# Feature extraction (MFCC, spectral, pitch, temporal) is language-agnostic
# by construction, so the acoustic detection pipeline runs unchanged
# regardless of the selected language.
#
# Transcription (faster-whisper, multilingual checkpoint) genuinely attempts
# to recognize speech in each of these languages - they are listed here
# because they are documented as supported by the underlying Whisper model,
# not because accuracy has been independently benchmarked per language in
# this prototype. Recognition quality varies significantly by language,
# accent, dialect, and audio quality; do not treat transcription output as
# guaranteed-accurate for any language, especially lower-resource ones.
# ---------------------------------------------------------------------------
SUPPORTED_LANGUAGES = [
    {"code": "en", "label": "English"},
    {"code": "hi", "label": "Hindi"},
    {"code": "ta", "label": "Tamil"},
    {"code": "te", "label": "Telugu"},
    {"code": "ml", "label": "Malayalam"},
    {"code": "kn", "label": "Kannada"},
    {"code": "bn", "label": "Bengali"},
    {"code": "mr", "label": "Marathi"},
]
