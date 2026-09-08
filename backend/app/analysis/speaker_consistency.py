"""
Prototype voice consistency analysis - now with genuine multi-session
comparison.

Compares the acoustic features of the current audio sample against a
previously enrolled "known voice profile" (a small set of stable feature
statistics: mean MFCC vector, pitch mean/std, spectral centroid mean).
Every sample ever compared against a profile (starting with the original
enrollment) is stored as its own session, so later comparisons genuinely
check the current sample against multiple prior sessions, not just one
snapshot - this is what `compare_to_profile_multi_session` below does.

This is explicitly NOT production-grade speaker recognition / speaker
embeddings. It is a lightweight, explainable similarity check over
hand-picked acoustic statistics (MFCC mean vector, pitch, spectral
centroid), not a trained speaker-embedding model. A real deployment would
replace this module with a proper speaker-embedding model (e.g. ECAPA-TDNN
or x-vector) behind the same interface - see backend/README.md ("Why not a
real speaker-embedding model") for exactly why that wasn't done in this
pass (a licensing blocker was found for the one small bundleable model
that was investigated) rather than silently shipping the same thing under
a fancier name.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.analysis.feature_extraction import FeatureBundle
from app.config import CONSISTENCY_THRESHOLDS


@dataclass
class ConsistencyResult:
    profile_id: str
    profile_name: str
    similarity: float       # 0..1, 1 = identical
    risk_fraction: float    # 0..1, 1 - similarity
    status: str              # HIGH / MEDIUM / LOW (consistency level)
    explanation: str


@dataclass
class SessionSimilarity:
    session_id: str
    created_at: str
    is_enrollment: bool
    similarity: float


@dataclass
class MultiSessionConsistencyResult:
    """Superset of ConsistencyResult (same field names or duck-compatible)
    plus the multi-session breakdown, so this can be passed anywhere a
    ConsistencyResult is expected (e.g. risk_fusion.fuse_risk) while also
    carrying richer data for the "Cross-Session Consistency" UI."""
    profile_id: str
    profile_name: str
    similarity: float                        # mean similarity across all sessions (used by risk fusion)
    risk_fraction: float                      # 1 - mean similarity
    status: str                               # HIGH / MEDIUM / LOW, from mean similarity
    explanation: str
    sessions_compared: int = 0
    min_similarity: float = 0.0
    session_similarities: list[SessionSimilarity] = field(default_factory=list)


def extract_profile_features(f: FeatureBundle) -> dict:
    """Build the small, storable feature signature used for comparisons."""
    return {
        "mfcc_vector": [round(v, 4) for v in f.mfcc_mean],
        "pitch_mean_hz": round(f.pitch_mean_hz, 2),
        "pitch_std_hz": round(f.pitch_std_hz, 2),
        "centroid_mean_hz": round(f.centroid_mean_hz, 1),
    }


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    if va.shape != vb.shape or not va.size:
        return 0.0
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    cos = float(np.dot(va, vb) / (na * nb))
    # MFCC cosine similarity is typically in [-1, 1]; rescale to [0, 1]
    return max(0.0, min(1.0, (cos + 1) / 2))


def _closeness(value_a: float, value_b: float, scale: float) -> float:
    """1.0 when identical, decaying towards 0 as |a-b| grows relative to `scale`."""
    if scale <= 0:
        return 0.0
    diff = abs(value_a - value_b) / scale
    return float(np.exp(-diff))


def _status(similarity: float) -> str:
    if similarity >= CONSISTENCY_THRESHOLDS["high_min"]:
        return "HIGH"
    if similarity >= CONSISTENCY_THRESHOLDS["medium_min"]:
        return "MEDIUM"
    return "LOW"


def _pairwise_similarity(current_sig: dict, other_sig: dict) -> float:
    mfcc_sim = _cosine_similarity(current_sig["mfcc_vector"], other_sig["mfcc_vector"])
    pitch_sim = _closeness(current_sig["pitch_mean_hz"], other_sig["pitch_mean_hz"], scale=40.0)
    centroid_sim = _closeness(current_sig["centroid_mean_hz"], other_sig["centroid_mean_hz"], scale=800.0)
    similarity = mfcc_sim * 0.55 + pitch_sim * 0.30 + centroid_sim * 0.15
    return max(0.0, min(1.0, similarity))


_EXPLANATIONS = {
    "HIGH": "Current voice characteristics closely match the registered reference profile.",
    "MEDIUM": "Current voice characteristics partially match the reference profile; "
               "some deviation present but not conclusive on its own.",
    "LOW": "Current voice characteristics differ significantly from the registered "
           "reference profile.",
}


def compare_to_profile(current: FeatureBundle, profile: dict) -> ConsistencyResult:
    """Single-snapshot comparison (kept for backward compatibility / simple
    callers). Prefer `compare_to_profile_multi_session` when session history
    is available."""
    current_sig = extract_profile_features(current)
    similarity = _pairwise_similarity(current_sig, profile)
    risk_fraction = 1.0 - similarity
    status = _status(similarity)

    return ConsistencyResult(
        profile_id=profile.get("profile_id", ""),
        profile_name=profile.get("name", "Unnamed profile"),
        similarity=round(similarity, 4),
        risk_fraction=round(risk_fraction, 4),
        status=status,
        explanation=_EXPLANATIONS[status],
    )


def compare_to_profile_multi_session(
    current: FeatureBundle, profile: dict, sessions: list[dict],
) -> MultiSessionConsistencyResult:
    """
    Compares the current sample against EVERY stored session for this
    profile (the original enrollment plus every prior analysis that was
    checked against it), not just a single stored snapshot.

    `sessions` is the list returned by `db.list_profile_sessions` - each
    entry has `session_id`, `created_at`, `is_enrollment`, and `features`.
    """
    current_sig = extract_profile_features(current)

    if not sessions:
        # Fall back to the single-snapshot profile features (shouldn't
        # normally happen - enrollment always creates session 1 - but
        # handle it gracefully rather than crashing).
        single = compare_to_profile(current, profile)
        return MultiSessionConsistencyResult(
            profile_id=single.profile_id,
            profile_name=single.profile_name,
            similarity=single.similarity,
            risk_fraction=single.risk_fraction,
            status=single.status,
            explanation=single.explanation,
            sessions_compared=0,
            min_similarity=single.similarity,
            session_similarities=[],
        )

    session_sims: list[SessionSimilarity] = []
    for s in sessions:
        sim = _pairwise_similarity(current_sig, s["features"])
        session_sims.append(
            SessionSimilarity(
                session_id=s["session_id"],
                created_at=s["created_at"],
                is_enrollment=s["is_enrollment"],
                similarity=round(sim, 4),
            )
        )

    similarities = [s.similarity for s in session_sims]
    mean_similarity = sum(similarities) / len(similarities)
    min_similarity = min(similarities)
    status = _status(mean_similarity)
    risk_fraction = 1.0 - mean_similarity

    explanation = _EXPLANATIONS[status]
    if len(session_sims) > 1:
        explanation += (
            f" Compared against {len(session_sims)} prior sessions "
            f"(similarity range {round(min(similarities) * 100)}%-{round(max(similarities) * 100)}%)."
        )

    return MultiSessionConsistencyResult(
        profile_id=profile.get("profile_id", ""),
        profile_name=profile.get("name", "Unnamed profile"),
        similarity=round(mean_similarity, 4),
        risk_fraction=round(risk_fraction, 4),
        status=status,
        explanation=explanation,
        sessions_compared=len(session_sims),
        min_similarity=round(min_similarity, 4),
        session_similarities=session_sims,
    )
