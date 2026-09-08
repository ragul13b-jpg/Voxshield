"""
Speech-to-text transcription (faster-whisper).

This module is a genuine ASR integration, not a placeholder. It is used by
`analysis_service.run_full_analysis` to produce the "TRANSCRIPTION" section
shown in the UI - kept clearly separate from the simulated "INCOMING
REQUEST" transaction text, which is never generated from audio.

The model is lazily loaded once per process and downloaded on first use.
If loading or inference fails for any reason (no network on first run, an
unsupported/corrupt audio segment, an empty result, or low-confidence
output) this module returns an honest `available=False` result with a
human-readable reason instead of inventing or guessing text.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

import numpy as np

from app.config import TRANSCRIPTION_CONFIG

logger = logging.getLogger("voxshield.transcription")

_model = None
_model_lock = threading.Lock()
_load_error: str | None = None


@dataclass
class TranscriptionResult:
    available: bool
    text: str
    confidence: float | None   # 0..1, rough estimate derived from decoder log-probs
    language_used: str | None  # language code actually used/detected by the model
    message: str


def _get_model():
    """Lazily load (and cache) the faster-whisper model. Never raises."""
    global _model, _load_error
    if _model is not None:
        return _model
    if _load_error is not None:
        return None

    with _model_lock:
        if _model is not None:
            return _model
        if _load_error is not None:
            return None
        try:
            from faster_whisper import WhisperModel  # imported lazily - heavy dependency

            _model = WhisperModel(
                TRANSCRIPTION_CONFIG["model_size"],
                device=TRANSCRIPTION_CONFIG["device"],
                compute_type=TRANSCRIPTION_CONFIG["compute_type"],
            )
            return _model
        except Exception as exc:  # pragma: no cover - depends on network/environment
            logger.warning("Transcription model could not be loaded: %s", exc)
            _load_error = (
                "Speech-to-text model could not be loaded. This usually means the model "
                "couldn't be downloaded on first use (no network access) - see the server "
                "log for the exact error."
            )
            return None


def transcription_engine_status() -> dict:
    """Report whether the transcription engine is actually usable right now."""
    if not TRANSCRIPTION_CONFIG["enabled"]:
        return {"available": False, "reason": "Transcription is disabled in this deployment."}
    model = _get_model()
    if model is None:
        return {
            "available": False,
            "reason": _load_error
            or "Speech-to-text model could not be loaded (requires network access on first use).",
        }
    return {"available": True, "reason": None, "model_size": TRANSCRIPTION_CONFIG["model_size"]}


def transcribe(y: np.ndarray, sr: int, language_code: str | None = None) -> TranscriptionResult:
    """
    Transcribe a mono float32 waveform already at the target sample rate
    (i.e. the SAME preprocessed audio used for acoustic feature extraction -
    no separate decode step, no ffmpeg subprocess required).
    """
    if not TRANSCRIPTION_CONFIG["enabled"]:
        return TranscriptionResult(False, "", None, None, "Transcription is disabled in this deployment.")

    model = _get_model()
    if model is None:
        return TranscriptionResult(
            False, "", None, None,
            _load_error
            or "Transcription engine unavailable (speech-to-text model could not be loaded).",
        )

    try:
        segments_iter, info = model.transcribe(
            y.astype(np.float32),
            language=language_code or None,
            vad_filter=True,
        )
        segments = list(segments_iter)
    except Exception as exc:  # pragma: no cover - defensive against decoder edge cases
        logger.warning("Transcription failed: %s", exc)
        return TranscriptionResult(False, "", None, None, "Transcription failed for this audio.")

    detected_language = getattr(info, "language", None) or language_code
    text = " ".join(s.text.strip() for s in segments).strip()

    if not segments or not text:
        return TranscriptionResult(
            False, "", None, detected_language,
            "Transcription unavailable or low confidence for this audio.",
        )

    avg_logprob = sum(s.avg_logprob for s in segments) / len(segments)
    no_speech_prob = sum(getattr(s, "no_speech_prob", 0.0) for s in segments) / len(segments)
    # avg_logprob from the decoder is typically in roughly [-1, 0] for confident
    # speech; map it to an approximate 0..1 confidence. This is a rough,
    # documented heuristic, not a calibrated probability.
    confidence = max(0.0, min(1.0, 1.0 + avg_logprob))

    if (
        confidence < TRANSCRIPTION_CONFIG["min_confidence"]
        or no_speech_prob > TRANSCRIPTION_CONFIG["max_no_speech_prob"]
    ):
        return TranscriptionResult(
            False, text, round(confidence, 3), detected_language,
            "Transcription unavailable or low confidence for this audio.",
        )

    return TranscriptionResult(
        True, text, round(confidence, 3), detected_language, "OK",
    )
