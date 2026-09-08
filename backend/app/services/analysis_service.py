from __future__ import annotations

from datetime import datetime, timezone

from app.analysis.context_engine import compute_context_risk
from app.analysis.deepfake_detector import detect as detect_deepfake
from app.analysis.feature_extraction import extract_features, load_waveform
from app.analysis.fusion_engine import analyze_features
from app.analysis.risk_fusion import fuse_risk
from app.analysis.speaker_consistency import compare_to_profile_multi_session, extract_profile_features
from app.analysis.transcription import transcribe
from app.services import db


def _build_timeline(risk_level: str, duration: float, has_context: bool, has_consistency: bool) -> list[dict]:
    events = [
        {"t": 0.0, "label": "Audio received"},
        {"t": round(min(0.4, duration * 0.1), 2), "label": "Preprocessing (resample, trim, normalize)"},
        {"t": round(min(1.0, duration * 0.25), 2), "label": "Feature extraction (MFCC, spectral, pitch, temporal)"},
    ]
    t = min(1.4, duration * 0.35)
    if has_consistency:
        events.append({"t": round(t, 2), "label": "Cross-session voice consistency check"})
        t += 0.2
    if has_context:
        events.append({"t": round(t, 2), "label": "Contextual analysis (caller/contact, transaction)"})
        t += 0.2

    if risk_level in ("HIGH", "SUSPICIOUS"):
        events.append({"t": round(min(t + 0.2, duration * 0.55), 2), "label": "Synthetic indicators detected"})
        t += 0.3
    if risk_level == "HIGH":
        events.append({"t": round(min(t + 0.2, duration * 0.65), 2), "label": "Risk threshold exceeded"})
        t += 0.2
        events.append({"t": round(t, 2), "label": "Warning triggered"})
        t += 0.15
        events.append({"t": round(t, 2), "label": "Sensitive action blocked"})
        t += 0.15
        events.append({"t": round(t, 2), "label": "Independent verification required"})
    else:
        events.append({"t": round(min(t + 0.2, duration * 0.65), 2), "label": "Risk assessment complete"})
    return events


def _acoustic_breakdown(record_indicators: list[dict]) -> dict:
    """Group indicators by analysis layer for the incident report / UI."""
    layers = {"Acoustic & Spectral": [], "Prosody & Behavioral": [], "Synthetic Artifacts": [],
              "AI Deepfake Detector": [], "Speaker Consistency": [], "Contextual": []}
    mapping = {
        "Spectral anomaly": "Acoustic & Spectral",
        "Temporal anomaly": "Acoustic & Spectral",
        "Prosody anomaly": "Prosody & Behavioral",
        "Synthetic artifacts": "Synthetic Artifacts",
        "AI Deepfake Detector": "AI Deepfake Detector",
        "Speaker consistency": "Speaker Consistency",
        "Contextual risk": "Contextual",
    }
    for ind in record_indicators:
        layer = mapping.get(ind["name"], "Acoustic & Spectral")
        layers[layer].append(ind)
    return layers


def run_full_analysis(
    audio_bytes: bytes,
    source: str,
    source_label: str | None = None,
    context: dict | None = None,
    profile_id: str | None = None,
    language: str | None = None,
) -> dict:
    y, sr = load_waveform(audio_bytes)
    features = extract_features(y, sr)
    acoustic_result = analyze_features(features)

    consistency_result = None
    profile_meta = None
    if profile_id:
        profile = db.get_profile(profile_id)
        if profile:
            sessions = db.list_profile_sessions(profile_id)
            consistency_result = compare_to_profile_multi_session(features, profile, sessions)
            profile_meta = {"profile_id": profile["profile_id"], "name": profile["name"]}

    context_result = None
    if context:
        context_result = compute_context_risk(context)

    # AI-assisted deepfake detector (AASIST, pretrained). Best-effort: never
    # raises, degrades honestly to available=False if torch isn't installed
    # or the model can't be loaded - see analysis/deepfake_detector.py.
    ai_deepfake_result = detect_deepfake(y, sr)

    # Speech-to-text transcription runs on the same preprocessed waveform used
    # for acoustic analysis. Best-effort: never raises, degrades honestly if
    # the model isn't available or confidence is too low. Skipped for chunk
    # mode (see run_chunk_analysis) - a few seconds of ASR latency per
    # ~1.5s chunk would break the near-real-time experience.
    transcription_result = transcribe(y, sr, language)

    fusion = fuse_risk(acoustic_result, ai_deepfake_result, consistency_result, context_result)

    analysis_id = db.next_analysis_id()
    created_at = datetime.now(timezone.utc).isoformat()

    indicators_out = [
        {
            "name": i.name,
            "severity": i.severity,
            "contribution": i.contribution,
            "explanation": i.explanation,
            "raw_score": i.raw_score,
        }
        for i in fusion.indicators
    ]

    verification_status = "REQUIRED" if fusion.risk_level == "HIGH" else (
        "RECOMMENDED" if fusion.risk_level == "SUSPICIOUS" else "NOT_REQUIRED"
    )

    record = {
        "analysis_id": analysis_id,
        "source": source,
        "source_label": source_label,
        "created_at": created_at,
        "duration_seconds": round(features.duration_seconds, 2),
        "language": language,
        "risk_score": fusion.risk_score,
        "trust_score": fusion.trust_score,
        "risk_level": fusion.risk_level,
        "human_probability": acoustic_result.human_probability,
        "synthetic_probability": acoustic_result.synthetic_probability,
        "risk_breakdown": fusion.breakdown,
        "indicators": indicators_out,
        "analysis_layers": _acoustic_breakdown(indicators_out),
        "ai_deepfake": {
            "available": ai_deepfake_result.available,
            "synthetic_probability": ai_deepfake_result.synthetic_probability,
            "natural_probability": ai_deepfake_result.natural_probability,
            "model_confidence": ai_deepfake_result.model_confidence,
            "model_status": ai_deepfake_result.model_status,
            "model_evidence": ai_deepfake_result.model_evidence,
            "note": "AASIST, pretrained on ASVspoof2019 - a real published anti-spoofing model, "
                    "not independently validated by this project against modern voice-cloning tools.",
        },
        "speaker_consistency": (
            {
                "profile_id": consistency_result.profile_id,
                "profile_name": consistency_result.profile_name,
                "similarity": consistency_result.similarity,
                "status": consistency_result.status,
                "explanation": consistency_result.explanation,
                "sessions_compared": consistency_result.sessions_compared,
                "min_similarity": consistency_result.min_similarity,
                "session_similarities": [
                    {
                        "session_id": s.session_id,
                        "created_at": s.created_at,
                        "is_enrollment": s.is_enrollment,
                        "similarity": s.similarity,
                    }
                    for s in consistency_result.session_similarities
                ],
                "note": "Prototype voice-signature consistency analysis (MFCC/pitch/spectral "
                        "similarity) - not a trained speaker-embedding model. See "
                        "backend/README.md for why.",
            }
            if consistency_result
            else None
        ),
        "context": (
            {
                "input": context,
                "risk_fraction": context_result.risk_fraction,
                "level": context_result.level,
                "factors": [
                    {"label": f.label, "value": f.value, "weight": f.weight, "detail": f.detail}
                    for f in context_result.factors
                ],
                "summary": context_result.summary,
            }
            if context_result
            else None
        ),
        "recommendation": fusion.recommendation,
        "feature_snapshot": acoustic_result.feature_snapshot,
        "transcription": {
            "available": transcription_result.available,
            "text": transcription_result.text,
            "confidence": transcription_result.confidence,
            "language_used": transcription_result.language_used,
            "message": transcription_result.message,
        },
        "waveform": {"points": features.waveform_preview},
        "spectrogram": {
            "db": features.spectrogram_db,
            "times": features.spectrogram_times,
            "freqs": features.spectrogram_freqs,
        },
        "timeline": _build_timeline(
            fusion.risk_level, features.duration_seconds,
            has_context=context_result is not None, has_consistency=consistency_result is not None,
        ),
        "verification_status": verification_status,
        "privacy_note": "Raw audio processed in-memory for this analysis and not retained; "
                         "only derived features and results are stored.",
    }

    db.save_analysis(record)

    # Grow the profile's session history: this sample becomes a new session
    # future comparisons will be checked against, so consistency genuinely
    # accumulates evidence over multiple analyses rather than comparing
    # only to the original enrollment every time.
    if profile_id and consistency_result:
        db.save_profile_session(
            profile_id, created_at, extract_profile_features(features), analysis_id=analysis_id,
        )

    return record


def run_chunk_analysis(audio_bytes: bytes, chunk_index: int) -> dict:
    y, sr = load_waveform(audio_bytes)
    features = extract_features(y, sr)
    acoustic_result = analyze_features(features)
    fusion = fuse_risk(acoustic_result)  # audio-only, near-real-time chunk mode

    status_label = {
        "LOW": "HUMAN-LIKE",
        "SUSPICIOUS": "UNCERTAIN",
        "HIGH": "HIGH RISK",
    }[fusion.risk_level]

    return {
        "chunk_index": chunk_index,
        "risk_score": fusion.risk_score,
        "trust_score": fusion.trust_score,
        "risk_level": fusion.risk_level,
        "human_probability": acoustic_result.human_probability,
        "synthetic_probability": acoustic_result.synthetic_probability,
        "status_label": status_label,
        "indicators": [
            {
                "name": i.name,
                "severity": i.severity,
                "contribution": i.contribution,
                "explanation": i.explanation,
                "raw_score": i.raw_score,
            }
            for i in fusion.indicators
        ],
    }


def enroll_profile(audio_bytes: bytes, name: str) -> dict:
    y, sr = load_waveform(audio_bytes)
    features = extract_features(y, sr)
    profile_features = extract_profile_features(features)

    profile_id = db.next_profile_id()
    created_at = datetime.now(timezone.utc).isoformat()
    db.save_profile(profile_id, name, created_at, profile_features)
    # The enrollment sample is session 1 - later analyses compared against
    # this profile are checked against it plus every session that follows.
    db.save_profile_session(profile_id, created_at, profile_features, is_enrollment=True)

    return {"profile_id": profile_id, "name": name, "created_at": created_at}
