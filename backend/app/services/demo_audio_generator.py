"""
Generates the three guaranteed demo-mode audio samples.

These are synthetically generated (not recordings of real people) so the
prototype is demonstrable out-of-the-box without bundling third-party audio.
Generation is deterministic (fixed seed) so results are reproducible.

  natural.wav   - vibrato + jitter + pauses + breath noise  -> expected LOW
  synthetic.wav - flat pitch, static formants, no pauses     -> expected HIGH
  noisy.wav     - natural base + heavy broadband noise       -> expected SUSPICIOUS

Run directly:  python -m app.services.demo_audio_generator
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

from app.config import DEMO_AUDIO_DIR, TARGET_SAMPLE_RATE

SR = TARGET_SAMPLE_RATE
RNG = np.random.default_rng(42)


def _formant_filter(x: np.ndarray, freqs: list[float], bws: list[float], sr: int) -> np.ndarray:
    out = np.zeros_like(x)
    for f, bw in zip(freqs, bws):
        r = np.exp(-np.pi * bw / sr)
        theta = 2 * np.pi * f / sr
        b = [1 - r]
        a = [1, -2 * r * np.cos(theta), r * r]
        out += signal.lfilter(b, a, x)
    return out


def _envelope(n_samples: int, sr: int, pattern: str) -> np.ndarray:
    t = np.arange(n_samples) / sr
    if pattern == "natural":
        # A few "words" separated by short pauses/breaths
        env = np.zeros(n_samples)
        word_bounds = [(0.1, 0.9), (1.05, 1.9), (2.15, 2.75), (2.95, 3.8)]
        for start, end in word_bounds:
            s, e = int(start * sr), int(min(end, n_samples / sr) * sr)
            if s >= n_samples:
                continue
            e = min(e, n_samples)
            seg_len = e - s
            if seg_len <= 0:
                continue
            ramp = min(400, seg_len // 4)
            seg = np.ones(seg_len)
            seg[:ramp] = np.linspace(0, 1, ramp)
            seg[-ramp:] = np.linspace(1, 0, ramp)
            # natural micro fluctuation in loudness (emphasis)
            seg *= 1.0 + 0.15 * np.sin(2 * np.pi * 2.3 * (np.arange(seg_len) / sr))
            env[s:e] = seg
        return env
    else:  # uniform / synthetic
        env = np.ones(n_samples)
        ramp = int(0.05 * sr)
        env[:ramp] = np.linspace(0, 1, ramp)
        env[-ramp:] = np.linspace(1, 0, ramp)
        return env


def make_natural(duration: float = 4.0) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n) / SR

    base_f0 = 130.0
    # Vibrato + slow intonation drift + fast natural jitter
    vibrato = 6.0 * np.sin(2 * np.pi * 5.2 * t)
    intonation = 18.0 * np.sin(2 * np.pi * 0.35 * t + 0.4)
    jitter = RNG.normal(0, 3.0, n)
    jitter = signal.lfilter([1], [1, -0.9], jitter)  # smooth random walk-ish jitter
    f0 = base_f0 + vibrato + intonation + jitter
    f0 = np.clip(f0, 70, 260)

    phase = 2 * np.pi * np.cumsum(f0) / SR
    # Rich harmonic content with naturally decaying harmonic amplitudes
    voiced = np.zeros(n)
    for h in range(1, 12):
        amp = 1.0 / h ** 1.2
        amp_wobble = 1.0 + 0.05 * RNG.normal(0, 1, n).cumsum() / n  # tiny slow drift
        voiced += amp * np.sin(h * phase) * amp_wobble

    voiced = _formant_filter(voiced, [700, 1200, 2600], [90, 130, 220], SR)

    breath = RNG.normal(0, 1, n)
    breath = signal.lfilter(*signal.butter(2, 3000 / (SR / 2), btype="high"), breath)
    breath *= 0.02

    env = _envelope(n, SR, "natural")
    out = (voiced * 0.9 + breath) * env
    out = out / (np.max(np.abs(out)) + 1e-9) * 0.9
    return out.astype(np.float32)


def make_synthetic(duration: float = 4.0) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n) / SR

    # Perfectly flat pitch (no vibrato, negligible jitter) -> classic TTS tell
    f0 = np.full(n, 145.0)
    phase = 2 * np.pi * np.cumsum(f0) / SR

    voiced = np.zeros(n)
    # Fixed, static harmonic amplitudes (no natural drift) -> overly smooth
    static_amps = [1.0 / h for h in range(1, 10)]
    for h, amp in zip(range(1, 10), static_amps):
        voiced += amp * np.sin(h * phase)

    # Static formant filter, applied uniformly with no time variation
    voiced = _formant_filter(voiced, [750, 1250, 2500], [60, 70, 90], SR)

    # Low-pass to remove natural high-frequency breath/sibilance content
    b, a = signal.butter(6, 3400 / (SR / 2), btype="low")
    voiced = signal.lfilter(b, a, voiced)

    env = _envelope(n, SR, "synthetic")
    out = voiced * env
    out = out / (np.max(np.abs(out)) + 1e-9) * 0.9
    return out.astype(np.float32)


def make_noisy(duration: float = 4.0) -> np.ndarray:
    """
    Represents a genuinely ambiguous / low-quality call: partly natural
    characteristics, partly degraded/flattened (e.g. heavy compression, a
    patchy connection, or a partially-processed voice). Feature values are
    deliberately intermediate between `natural` and `synthetic`, which is
    exactly the situation VoxShield should flag as SUSPICIOUS rather than
    confidently LOW or HIGH.
    """
    natural = make_natural(duration)
    synthetic_like = make_synthetic(duration)
    n = len(natural)

    # Blend natural and flattened/synthetic-like voice characteristics
    blended = natural * 0.45 + synthetic_like * 0.55

    noise = RNG.normal(0, 1, n)
    noise = signal.lfilter([1], [1, -0.6], noise)  # colored broadband noise
    noise = noise / (np.max(np.abs(noise)) + 1e-9)

    out = blended * 0.72 + noise * 0.28
    for start_s in (0.6, 2.1, 3.2):
        s = int(start_s * SR)
        e = min(n, s + int(0.05 * SR))
        out[s:e] *= 0.1

    out = out / (np.max(np.abs(out)) + 1e-9) * 0.9
    return out.astype(np.float32)


def generate_all(force: bool = False) -> dict[str, Path]:
    out_dir = Path(__file__).resolve().parent.parent.parent / DEMO_AUDIO_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    files = {
        "natural": out_dir / "natural.wav",
        "synthetic": out_dir / "synthetic.wav",
        "noisy": out_dir / "noisy.wav",
    }
    generators = {
        "natural": make_natural,
        "synthetic": make_synthetic,
        "noisy": make_noisy,
    }

    for key, path in files.items():
        if force or not path.exists():
            audio = generators[key]()
            sf.write(path, audio, SR, subtype="PCM_16")

    return files


if __name__ == "__main__":
    paths = generate_all(force=True)
    for key, path in paths.items():
        print(f"generated {key}: {path}")
