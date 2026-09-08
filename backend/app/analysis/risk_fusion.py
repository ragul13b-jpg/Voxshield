"""
Risk fusion layer.

Combines the independent signal groups into one unified, explainable risk
assessment:

  acoustic (spectral/prosody/temporal/synthetic-artifact analysis)
      +
  ai_deepfake (pretrained AASIST anti-spoofing model, if torch is installed
      and the bundled model loads successfully)
      +
  speaker_consistency (prototype cross-session comparison, if a reference
      voice profile was enrolled)
      +
  context (caller/contact + transaction context, if supplied)
      ↓
  final risk score -> Voice Trust Score

Weights come from `app.config.RISK_FUSION_WEIGHTS`. Any signal group that
isn't available for a given analysis is simply omitted and the remaining
weights are renormalized to sum to 1.0 - so a plain audio-only analysis with
no AI detector installed (the default - torch is not in requirements.txt)
is scored identically to the original prototype: acoustic weight becomes
1.0 and the result is unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.analysis.context_engine import ContextResult
from app.analysis.deepfake_detector import DeepfakeResult
from app.analysis.fusion_engine import AnalysisResult, Indicator, _risk_level, _severity
from app.analysis.speaker_consistency import ConsistencyResult
from app.config import RISK_FUSION_WEIGHTS


@dataclass
class FusionResult:
    risk_score: int          # 0-100, higher = more risk (kept for API/backward-compat)
    trust_score: int         # 0-100, higher = more trustworthy (100 - risk_score)
    risk_level: str          # LOW / SUSPICIOUS / HIGH
    indicators: list[Indicator]
    breakdown: dict
    recommendation: str


def fuse_risk(
    acoustic: AnalysisResult,
    ai_deepfake: DeepfakeResult | None = None,
    consistency: ConsistencyResult | None = None,
    context: ContextResult | None = None,
) -> FusionResult:
    available = {"acoustic": acoustic.synthetic_probability}
    if ai_deepfake is not None and ai_deepfake.available:
        available["ai_deepfake"] = ai_deepfake.synthetic_probability
    if consistency is not None:
        available["speaker_consistency"] = consistency.risk_fraction
    if context is not None:
        available["context"] = context.risk_fraction

    total_weight = sum(RISK_FUSION_WEIGHTS[k] for k in available)
    normalized = {k: RISK_FUSION_WEIGHTS[k] / total_weight for k in available}

    final_probability = sum(normalized[k] * v for k, v in available.items())
    final_probability = max(0.0, min(1.0, final_probability))

    risk_score = int(round(final_probability * 100))
    trust_score = 100 - risk_score
    risk_level = _risk_level(risk_score)

    indicators = list(acoustic.indicators)

    if ai_deepfake is not None and ai_deepfake.available:
        sev = _severity(ai_deepfake.synthetic_probability)
        indicators.append(
            Indicator(
                name="AI Deepfake Detector",
                severity=sev,
                contribution=int(round(normalized.get("ai_deepfake", 0) * ai_deepfake.synthetic_probability * 100)),
                explanation=f"[AASIST, pretrained on ASVspoof2019 - not independently validated on modern "
                            f"cloning tools] {ai_deepfake.model_evidence}",
                raw_score=ai_deepfake.synthetic_probability,
            )
        )

    if consistency is not None:
        sev = {"HIGH": "LOW", "MEDIUM": "MEDIUM", "LOW": "HIGH"}[consistency.status]  # low consistency = high-severity signal
        indicators.append(
            Indicator(
                name="Speaker consistency",
                severity=sev,
                contribution=int(round(normalized.get("speaker_consistency", 0) * consistency.risk_fraction * 100)),
                explanation=f"[Prototype voice consistency analysis] {consistency.explanation} "
                            f"(similarity to '{consistency.profile_name}': {round(consistency.similarity * 100)}%)",
                raw_score=consistency.risk_fraction,
            )
        )

    if context is not None:
        sev = _severity(context.risk_fraction)
        indicators.append(
            Indicator(
                name="Contextual risk",
                severity=sev,
                contribution=int(round(normalized.get("context", 0) * context.risk_fraction * 100)),
                explanation=context.summary,
                raw_score=context.risk_fraction,
            )
        )

    indicators.sort(key=lambda i: i.contribution, reverse=True)

    breakdown = {
        "acoustic_score": int(round(acoustic.synthetic_probability * 100)),
        "ai_deepfake_score": int(round(ai_deepfake.synthetic_probability * 100)) if (ai_deepfake and ai_deepfake.available) else None,
        "speaker_consistency_score": int(round(consistency.risk_fraction * 100)) if consistency else None,
        "context_score": int(round(context.risk_fraction * 100)) if context else None,
        "weights_used": {k: round(v, 3) for k, v in normalized.items()},
        "final_risk_score": risk_score,
    }

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

    return FusionResult(
        risk_score=risk_score,
        trust_score=trust_score,
        risk_level=risk_level,
        indicators=indicators,
        breakdown=breakdown,
        recommendation=recommendation,
    )
