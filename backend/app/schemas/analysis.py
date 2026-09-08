from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class IndicatorOut(BaseModel):
    name: str
    severity: str
    contribution: int
    explanation: str
    raw_score: float


class TimelineEvent(BaseModel):
    t: float  # seconds offset
    label: str


class WaveformData(BaseModel):
    points: list[float]


class SpectrogramData(BaseModel):
    db: list[list[float]]
    times: list[float]
    freqs: list[float]


class SpeakerConsistencyOut(BaseModel):
    profile_id: str
    profile_name: str
    similarity: float
    status: str
    explanation: str
    note: str


class ContextOut(BaseModel):
    input: dict
    risk_fraction: float
    level: str
    factors: list[dict]
    summary: str


class RiskBreakdownOut(BaseModel):
    acoustic_score: int
    speaker_consistency_score: Optional[int] = None
    context_score: Optional[int] = None
    weights_used: dict
    final_risk_score: int


class AnalysisResponse(BaseModel):
    analysis_id: str
    source: str  # "upload" | "record" | "demo" | "chunk"
    source_label: Optional[str] = None
    created_at: str
    language: Optional[str] = None
    duration_seconds: float

    trust_score: int          # 0-100, higher = more trustworthy (SIH-facing score)
    risk_score: int           # 0-100, higher = more risk (100 - trust_score)
    risk_level: str           # LOW / SUSPICIOUS / HIGH
    human_probability: float
    synthetic_probability: float

    risk_breakdown: RiskBreakdownOut
    indicators: list[IndicatorOut]
    analysis_layers: dict
    speaker_consistency: Optional[SpeakerConsistencyOut] = None
    context: Optional[ContextOut] = None

    recommendation: str
    feature_snapshot: dict
    waveform: WaveformData
    spectrogram: SpectrogramData
    timeline: list[TimelineEvent]

    verification_status: str  # NOT_REQUIRED / RECOMMENDED / REQUIRED / VERIFIED
    privacy_note: str


class HistoryItem(BaseModel):
    analysis_id: str
    created_at: str
    source: str
    source_label: Optional[str] = None
    risk_score: int
    risk_level: str
    duration_seconds: float


class DemoSample(BaseModel):
    key: str
    label: str
    expected_risk_level: str
    description: str
    available: bool


class ChunkAnalysisResponse(BaseModel):
    chunk_index: int
    risk_score: int
    trust_score: int
    risk_level: str
    human_probability: float
    synthetic_probability: float
    status_label: str


class VoiceProfileOut(BaseModel):
    profile_id: str
    name: str
    created_at: str


class VerificationResponse(BaseModel):
    analysis_id: str
    verification_status: str


class TransactionCheckResponse(BaseModel):
    allowed: bool
    status: str  # BLOCKED / ALLOWED_WITH_WARNING / ALLOWED
    reason: str
