"""
Detection / fusion engine.

Converts extracted acoustic features into:
  - human_probability / synthetic_probability
  - a 0-100 risk score
  - a risk level (LOW / SUSPICIOUS / HIGH)
  - explainable indicators with severity + contribution + explanation

This is a deterministic, feature-based + rule engine. No randomness is used
anywhere: identical audio always yields identical results. The architecture
(clear separation between `feature_extraction` -> `fusion_engine`) is built
so a trained classifier's output probability could be dropped in as another
signal feeding the same fusion step later.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.analysis.feature_extraction import FeatureBundle
from app.config import (
    INDICATOR_WEIGHTS,
    REFERENCE_RANGES,
    RISK_THRESHOLDS,
    SEVERITY_THRESHOLDS,
)


def _band_anomaly(value: float, key: str) -> float:
    """
    Map a feature value to an anomaly score in [0, 1] based on how far it
    falls outside the "natural speech" reference band for that feature.

    0.0  -> comfortably inside the natural band (center)
    1.0  -> far outside the natural band (strongly synthetic-like)

    The mapping is a smooth clamp, not a hard cutoff, so borderline values
    produce MEDIUM rather than flipping abruptly between LOW/HIGH.
    """
    band = REFERENCE_RANGES[key]
    lo, hi = band["natural_min"], band["natural_max"]
    width = hi - lo
    if width <= 0:
        return 0.0

    if lo <= value <= hi:
        # Inside the band: small residual anomaly if very close to an edge.
        center = (lo + hi) / 2
        dist_from_center = abs(value - center) / (width / 2)
        return max(0.0, min(0.20, dist_from_center * 0.20))

    half_width = width / 2.0
    if value < lo:
        overshoot = (lo - value) / half_width
    else:
        overshoot = (value - hi) / half_width

    # Exponential saturation towards 1.0 as overshoot grows - reaches high
    # anomaly scores quickly once a feature is clearly outside the natural
    # band, rather than requiring many multiples of the band width.
    score = 1.0 - np.exp(-4.0 * overshoot)
    return max(0.0, min(1.0, 0.20 + score * 0.80))


@dataclass
class Indicator:
    name: str
    severity: str
    contribution: int
    explanation: str
    raw_score: float


@dataclass
class AnalysisResult:
    human_probability: float
    synthetic_probability: float
    risk_score: int
    risk_level: str
    indicators: list[Indicator]
    recommendation: str
    feature_snapshot: dict


def _severity(score: float) -> str:
    if score >= SEVERITY_THRESHOLDS["high_min"]:
        return "HIGH"
    if score >= SEVERITY_THRESHOLDS["medium_min"]:
        return "MEDIUM"
    return "LOW"


def _risk_level(score: int) -> str:
    if score <= RISK_THRESHOLDS["low_max"]:
        return "LOW"
    if score <= RISK_THRESHOLDS["suspicious_max"]:
        return "SUSPICIOUS"
    return "HIGH"


def analyze_features(f: FeatureBundle) -> AnalysisResult:
    # --- Category: Spectral anomaly ------------------------------------------
    flatness_anom = _band_anomaly(f.flatness_std, "flatness_std")
    centroid_anom = _band_anomaly(f.centroid_std_hz, "centroid_std_hz")
    rolloff_anom = _band_anomaly(f.rolloff_std_hz, "rolloff_std_hz")
    spectral_score = (flatness_anom * 0.45 + centroid_anom * 0.30 + rolloff_anom * 0.25)

    # --- Category: Prosody anomaly (pitch behaviour) -------------------------
    pitch_std_anom = _band_anomaly(f.pitch_std_hz, "pitch_std_hz")
    jitter_anom = _band_anomaly(f.pitch_jitter_cv, "pitch_jitter_cv")
    # Very low voiced fraction means unreliable pitch tracking -> dampen weight
    voiced_confidence = min(1.0, f.voiced_fraction / 0.35) if f.voiced_fraction else 0.0
    prosody_score = (pitch_std_anom * 0.6 + jitter_anom * 0.4) * (0.4 + 0.6 * voiced_confidence)

    # --- Category: Temporal anomaly ------------------------------------------
    zcr_anom = _band_anomaly(f.zcr_std, "zcr_std")
    energy_anom = _band_anomaly(f.energy_cv, "energy_cv")
    temporal_score = zcr_anom * 0.45 + energy_anom * 0.55

    # --- Category: Synthetic artifacts ---------------------------------------
    mfcc_delta_anom = _band_anomaly(f.mfcc_delta_mean_abs, "mfcc_delta_mean_abs")
    hf_anom = _band_anomaly(f.high_freq_ratio, "high_freq_ratio")
    artifacts_score = mfcc_delta_anom * 0.55 + hf_anom * 0.45

    categories = {
        "spectral_anomaly": ("Spectral anomaly", spectral_score),
        "prosody_anomaly": ("Prosody anomaly", prosody_score),
        "temporal_anomaly": ("Temporal anomaly", temporal_score),
        "synthetic_artifacts": ("Synthetic artifacts", artifacts_score),
    }

    synthetic_probability = sum(
        INDICATOR_WEIGHTS[key] * score for key, (_, score) in categories.items()
    )
    synthetic_probability = max(0.0, min(1.0, synthetic_probability))
    human_probability = 1.0 - synthetic_probability
    risk_score = int(round(synthetic_probability * 100))
    risk_level = _risk_level(risk_score)

    explanations = {
        "spectral_anomaly": {
            "HIGH": "Spectral envelope shows unnaturally consistent shaping across frames, "
                    "a pattern often left by neural vocoders and voice-cloning pipelines.",
            "MEDIUM": "Spectral characteristics show some patterns that may be inconsistent "
                      "with natural speech; not conclusive on their own.",
            "LOW": "Spectral variation across frames is consistent with natural speech.",
        },
        "prosody_anomaly": {
            "HIGH": "Pitch (F0) is unusually flat or mechanically regular, lacking the "
                    "micro-variation and intonation typical of live human speech.",
            "MEDIUM": "Pitch variation is somewhat lower than typical natural speech; "
                      "could indicate a monotone speaker or synthetic generation.",
            "LOW": "Pitch contour shows natural variation and jitter typical of human speech.",
        },
        "temporal_anomaly": {
            "HIGH": "Energy and zero-crossing patterns are unusually uniform over time, "
                    "missing the natural breathing, pausing and emphasis of live speech.",
            "MEDIUM": "Some temporal patterns deviate mildly from typical natural speech.",
            "LOW": "Temporal dynamics (energy, pausing) are consistent with natural speech.",
        },
        "synthetic_artifacts": {
            "HIGH": "Frame-to-frame timbre changes and high-frequency content match "
                    "patterns commonly produced by text-to-speech / voice-cloning models.",
            "MEDIUM": "Minor artifact-like patterns detected in timbre or high-frequency content.",
            "LOW": "No strong synthetic-artifact signatures detected in timbre or spectrum.",
        },
    }

    indicators: list[Indicator] = []
    for key, (label, score) in categories.items():
        sev = _severity(score)
        contribution = int(round(INDICATOR_WEIGHTS[key] * score * 100))
        indicators.append(
            Indicator(
                name=label,
                severity=sev,
                contribution=contribution,
                explanation=explanations[key][sev],
                raw_score=round(score, 4),
            )
        )

    indicators.sort(key=lambda i: i.contribution, reverse=True)

    if risk_level == "HIGH":
        recommendation = (
            "Do not perform sensitive actions until identity has been independently "
            "verified through a separate, trusted communication channel."
        )
    elif risk_level == "SUSPICIOUS":
        recommendation = (
            "Proceed with caution. Consider independent verification before acting "
            "on any sensitive request from this call."
        )
    else:
        recommendation = (
            "No strong synthetic indicators detected. Standard caution still applies "
            "for any high-value request."
        )

    return AnalysisResult(
        human_probability=round(human_probability, 4),
        synthetic_probability=round(synthetic_probability, 4),
        risk_score=risk_score,
        risk_level=risk_level,
        indicators=indicators,
        recommendation=recommendation,
        feature_snapshot={
            "pitch_mean_hz": round(f.pitch_mean_hz, 2),
            "pitch_std_hz": round(f.pitch_std_hz, 2),
            "pitch_jitter_cv": round(f.pitch_jitter_cv, 3),
            "voiced_fraction": round(f.voiced_fraction, 3),
            "flatness_mean": round(f.flatness_mean, 4),
            "flatness_std": round(f.flatness_std, 4),
            "centroid_mean_hz": round(f.centroid_mean_hz, 1),
            "centroid_std_hz": round(f.centroid_std_hz, 1),
            "rolloff_std_hz": round(f.rolloff_std_hz, 1),
            "mfcc_delta_mean_abs": round(f.mfcc_delta_mean_abs, 3),
            "zcr_std": round(f.zcr_std, 4),
            "energy_cv": round(f.energy_cv, 3),
            "high_freq_ratio": round(f.high_freq_ratio, 4),
            "duration_seconds": round(f.duration_seconds, 2),
        },
    )
