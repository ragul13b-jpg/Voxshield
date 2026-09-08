"""
Audio preprocessing + acoustic feature extraction.

Pipeline: raw bytes -> mono/resampled waveform -> frame-level features
(MFCC, spectral centroid/bandwidth/rolloff/flatness, ZCR, RMS, pitch/F0)
-> aggregate statistics used downstream by the fusion engine.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Any

import librosa
import numpy as np
import soundfile as sf

from app.config import TARGET_SAMPLE_RATE, MIN_DURATION_SECONDS


class AudioTooShortError(Exception):
    pass


class AudioDecodeError(Exception):
    pass


@dataclass
class FeatureBundle:
    """Aggregate statistics + raw arrays needed for scoring and visualization."""

    duration_seconds: float
    sample_rate: int

    # Aggregate scalar statistics (see config.REFERENCE_RANGES for meaning)
    pitch_mean_hz: float
    pitch_std_hz: float
    pitch_jitter_cv: float
    voiced_fraction: float

    flatness_mean: float
    flatness_std: float

    centroid_mean_hz: float
    centroid_std_hz: float

    bandwidth_mean_hz: float
    bandwidth_std_hz: float

    rolloff_mean_hz: float
    rolloff_std_hz: float

    mfcc_mean: list[float]
    mfcc_delta_mean_abs: float

    zcr_mean: float
    zcr_std: float

    rms_mean: float
    rms_std: float
    energy_cv: float

    high_freq_ratio: float

    # Raw data for visualization (downsampled to keep payloads small)
    waveform_preview: list[float] = field(default_factory=list)
    spectrogram_db: list[list[float]] = field(default_factory=list)
    spectrogram_times: list[float] = field(default_factory=list)
    spectrogram_freqs: list[float] = field(default_factory=list)


def load_waveform(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode arbitrary audio bytes into a mono float32 waveform at TARGET_SAMPLE_RATE."""
    try:
        data, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
    except Exception:
        # Fall back to librosa's more permissive decoder (handles more containers)
        try:
            data, sr = librosa.load(io.BytesIO(audio_bytes), sr=None, mono=False)
        except Exception as exc:  # pragma: no cover - defensive
            raise AudioDecodeError(f"Could not decode audio: {exc}") from exc

    if data.ndim > 1:
        data = np.mean(data, axis=-1 if data.shape[-1] < data.shape[0] else 0)
        data = data.astype(np.float32)

    if sr != TARGET_SAMPLE_RATE:
        data = librosa.resample(data.astype(np.float32), orig_sr=sr, target_sr=TARGET_SAMPLE_RATE)
        sr = TARGET_SAMPLE_RATE

    duration = len(data) / sr
    if duration < MIN_DURATION_SECONDS:
        raise AudioTooShortError(
            f"Audio too short for reliable analysis ({duration:.2f}s < {MIN_DURATION_SECONDS}s)"
        )

    # Trim leading/trailing silence, normalize peak amplitude
    trimmed, _ = librosa.effects.trim(data, top_db=30)
    if len(trimmed) / sr >= MIN_DURATION_SECONDS:
        data = trimmed

    peak = np.max(np.abs(data)) if len(data) else 0.0
    if peak > 1e-6:
        data = data / peak * 0.95

    return data.astype(np.float32), sr


def _safe_std(x: np.ndarray) -> float:
    return float(np.std(x)) if x.size > 1 else 0.0


def _safe_mean(x: np.ndarray) -> float:
    return float(np.mean(x)) if x.size else 0.0


def extract_features(y: np.ndarray, sr: int) -> FeatureBundle:
    n_fft = 1024
    hop_length = 256

    stft = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop_length))

    # --- Spectral features -------------------------------------------------
    centroid = librosa.feature.spectral_centroid(S=stft, sr=sr)[0]
    bandwidth = librosa.feature.spectral_bandwidth(S=stft, sr=sr)[0]
    rolloff = librosa.feature.spectral_rolloff(S=stft, sr=sr, roll_percent=0.85)[0]
    flatness = librosa.feature.spectral_flatness(S=stft)[0]

    # --- MFCCs ---------------------------------------------------------------
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, n_fft=n_fft, hop_length=hop_length)
    mfcc_delta = librosa.feature.delta(mfcc)
    mfcc_delta_mean_abs = float(np.mean(np.abs(mfcc_delta)))

    # --- Zero crossing rate & energy -----------------------------------------
    zcr = librosa.feature.zero_crossing_rate(y, frame_length=n_fft, hop_length=hop_length)[0]
    rms = librosa.feature.rms(y=y, frame_length=n_fft, hop_length=hop_length)[0]

    # --- Pitch / F0 via pYIN --------------------------------------------------
    try:
        f0, voiced_flag, _ = librosa.pyin(
            y,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C6"),
            sr=sr,
            frame_length=n_fft,
            hop_length=hop_length,
        )
        f0 = np.nan_to_num(f0, nan=0.0)
        voiced = f0[voiced_flag & (f0 > 0)]
    except Exception:
        voiced = np.array([])
        voiced_flag = np.array([False])

    if voiced.size > 3:
        pitch_mean = float(np.mean(voiced))
        pitch_std = float(np.std(voiced))
        diffs = np.abs(np.diff(voiced))
        pitch_jitter_cv = float(np.std(diffs) / (np.mean(diffs) + 1e-6)) if diffs.size else 0.0
    else:
        pitch_mean, pitch_std, pitch_jitter_cv = 0.0, 0.0, 0.0

    voiced_fraction = float(np.mean(voiced_flag)) if voiced_flag.size else 0.0

    # --- High-frequency energy ratio -----------------------------------------
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    hf_mask = freqs >= 4000
    total_energy = float(np.sum(stft ** 2)) + 1e-9
    hf_energy = float(np.sum(stft[hf_mask, :] ** 2))
    high_freq_ratio = hf_energy / total_energy

    energy_cv = _safe_std(rms) / (_safe_mean(rms) + 1e-6)

    # --- Visualization payloads (downsampled) ---------------------------------
    waveform_preview = _downsample(y, 800).tolist()

    spec_db = librosa.amplitude_to_db(stft, ref=np.max)
    # downsample spectrogram to keep JSON small
    spec_db_small = spec_db[:: max(1, spec_db.shape[0] // 96), :: max(1, spec_db.shape[1] // 200)]
    times = librosa.frames_to_time(np.arange(spec_db.shape[1]), sr=sr, hop_length=hop_length)
    times_small = times[:: max(1, len(times) // 200)]
    freqs_small = freqs[:: max(1, len(freqs) // 96)]

    return FeatureBundle(
        duration_seconds=len(y) / sr,
        sample_rate=sr,
        pitch_mean_hz=pitch_mean,
        pitch_std_hz=pitch_std,
        pitch_jitter_cv=pitch_jitter_cv,
        voiced_fraction=voiced_fraction,
        flatness_mean=_safe_mean(flatness),
        flatness_std=_safe_std(flatness),
        centroid_mean_hz=_safe_mean(centroid),
        centroid_std_hz=_safe_std(centroid),
        bandwidth_mean_hz=_safe_mean(bandwidth),
        bandwidth_std_hz=_safe_std(bandwidth),
        rolloff_mean_hz=_safe_mean(rolloff),
        rolloff_std_hz=_safe_std(rolloff),
        mfcc_mean=np.mean(mfcc, axis=1).tolist(),
        mfcc_delta_mean_abs=mfcc_delta_mean_abs,
        zcr_mean=_safe_mean(zcr),
        zcr_std=_safe_std(zcr),
        rms_mean=_safe_mean(rms),
        rms_std=_safe_std(rms),
        energy_cv=float(energy_cv),
        high_freq_ratio=float(high_freq_ratio),
        waveform_preview=waveform_preview,
        spectrogram_db=spec_db_small.tolist(),
        spectrogram_times=times_small.tolist(),
        spectrogram_freqs=freqs_small.tolist(),
    )


def _downsample(y: np.ndarray, target_points: int) -> np.ndarray:
    if len(y) <= target_points:
        return y
    factor = len(y) // target_points
    trimmed = y[: factor * target_points]
    reshaped = trimmed.reshape(target_points, factor)
    # min/max envelope pairs would be nicer, but mean keeps payload simplest
    return reshaped.mean(axis=1)
