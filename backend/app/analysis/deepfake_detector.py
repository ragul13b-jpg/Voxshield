"""
AI-assisted synthetic/deepfake voice detection.

This is a genuine, working integration of AASIST (Jung et al., ICASSP 2022),
a published, peer-reviewed anti-spoofing model for the ASVspoof benchmark.
The model code and pretrained weights (AASIST-L, ~426KB) in
`deepfake_model/aasist_arch.py` / `aasist_l_weights.pth` are copied
verbatim from the official repository (https://github.com/clovaai/aasist,
MIT license, Copyright NAVER Corp. - see `deepfake_model/AASIST_LICENSE.txt`)
so this is not a re-implementation from memory, avoiding the correctness
risk that would carry. The weights are bundled directly in this project, so
- unlike the transcription engine - this detector needs no network access
or model download at runtime.

IMPORTANT - why this runs in a subprocess:
`torch` can occasionally fail at the OS/hardware level (e.g. a SIGBUS or
segfault from an incompatible build, insufficient shared memory, or a
sandboxed environment) in a way that a plain Python try/except CANNOT
catch, because it isn't a Python exception - it kills the whole process.
This was verified empirically during development: importing torch directly
crashed the entire FastAPI server, not just the request being handled. To
make this genuinely optional and safe, all torch-dependent code (import,
model load, and inference) runs in an isolated child process. If that
child process crashes for any reason, the parent (the actual API server)
detects the non-zero/negative exit code and reports the detector as
unavailable - the rest of VoxShield keeps working normally.

Honest limitations (read before treating this as ground truth):
  - AASIST was trained on ASVspoof2019 LA, a benchmark of specific
    text-to-speech and voice-conversion attacks from ~2019/2021. It has
    NOT been independently validated by this project against modern
    zero-shot voice-cloning tools, and generalization to unseen synthesis
    methods, languages, or recording conditions is not guaranteed.
  - `torch` is a genuinely heavy dependency (~500MB+) and is NOT part of
    the default `requirements.txt` - install `requirements-ai.txt` to
    enable this detector. Everything else in VoxShield works without it.
  - Every call reloads the model in a fresh subprocess (no persistent
    in-process cache), trading some latency for crash isolation - a
    deliberate tradeoff given the crash behavior observed above.
"""
from __future__ import annotations

import multiprocessing as mp
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.config import AI_DETECTOR_CONFIG

_WEIGHTS_PATH = Path(__file__).resolve().parent / "deepfake_model" / "aasist_l_weights.pth"
_NB_SAMP = 64600  # ~4.04s at 16kHz - fixed input length AASIST was trained/evaluated with
_SUBPROCESS_TIMEOUT_SECONDS = 30

_MODEL_CONFIG = {
    "architecture": "AASIST",
    "nb_samp": _NB_SAMP,
    "first_conv": 128,
    "filts": [70, [1, 32], [32, 32], [32, 24], [24, 24]],
    "gat_dims": [24, 32],
    "pool_ratios": [0.4, 0.5, 0.7, 0.5],
    "temperatures": [2.0, 2.0, 100.0, 100.0],
}

_status_cache: dict | None = None
_status_lock = threading.Lock()


@dataclass
class DeepfakeResult:
    available: bool
    synthetic_probability: float | None  # 0..1
    natural_probability: float | None    # 0..1
    model_confidence: float | None       # |synthetic - natural|, 0..1
    model_status: str                    # "loaded" | "unavailable"
    model_evidence: str


def _pad_or_tile(x: np.ndarray, max_len: int = _NB_SAMP) -> np.ndarray:
    """Matches AASIST's own eval-time preprocessing exactly (deterministic,
    no randomness): truncate to the first `max_len` samples if long enough,
    otherwise tile-repeat to fill it."""
    x_len = x.shape[0]
    if x_len >= max_len:
        return x[:max_len]
    num_repeats = int(max_len / x_len) + 1
    return np.tile(x, num_repeats)[:max_len]


def _subprocess_worker(weights_path: str, model_config: dict, audio_bytes: bytes, queue) -> None:
    """
    Runs entirely inside an isolated child process. Any crash here (import
    error, OS-level signal, etc.) only takes down this child - never the
    parent API server.
    """
    try:
        import numpy as _np
        import torch

        from app.analysis.deepfake_model.aasist_arch import Model as AasistModel

        x = _np.frombuffer(audio_bytes, dtype=_np.float32).copy()
        x = _pad_or_tile(x)

        net = AasistModel(model_config)
        state_dict = torch.load(weights_path, map_location="cpu")
        net.load_state_dict(state_dict)
        net.eval()

        x_tensor = torch.from_numpy(x).unsqueeze(0)
        with torch.no_grad():
            _, logits = net(x_tensor)
            probs = torch.softmax(logits, dim=1).squeeze(0).numpy()

        # Class 1 = bonafide (natural), class 0 = spoof (synthetic) - matches
        # the label convention used to train this checkpoint.
        queue.put({"ok": True, "synthetic": float(probs[0]), "natural": float(probs[1])})
    except Exception as exc:  # pragma: no cover - depends on environment
        try:
            queue.put({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
        except Exception:
            pass  # if even this fails, the parent's exitcode/timeout check still catches it


def _run_isolated(audio_bytes: bytes) -> dict:
    """Spawns a fresh child process (not forked - `spawn` avoids inheriting
    any already-initialized, possibly-unstable C extension state) to run the
    torch-dependent detection, with a hard timeout and crash detection."""
    ctx = mp.get_context("spawn")
    queue = ctx.Queue()
    process = ctx.Process(
        target=_subprocess_worker,
        args=(str(_WEIGHTS_PATH), _MODEL_CONFIG, audio_bytes, queue),
    )
    process.start()
    process.join(timeout=_SUBPROCESS_TIMEOUT_SECONDS)

    if process.is_alive():
        process.terminate()
        process.join()
        return {"ok": False, "error": "AI detector timed out"}

    if process.exitcode != 0:
        return {"ok": False, "error": f"AI detector process exited abnormally (code {process.exitcode})"}

    try:
        return queue.get_nowait()
    except Exception:
        return {"ok": False, "error": "AI detector produced no result"}


def ai_detector_status() -> dict:
    """Cached after first attempt (mirrors the transcription engine's
    pattern) so repeated status checks don't re-spawn a process every time.
    Runs a tiny real probe (a zeroed 1-second clip) through the full
    isolated pipeline, so this actually verifies torch + the model load,
    not just whether the package is importable."""
    global _status_cache
    if not AI_DETECTOR_CONFIG["enabled"]:
        return {"available": False, "reason": "AI detector is disabled in this deployment."}

    if _status_cache is not None:
        return _status_cache

    with _status_lock:
        if _status_cache is not None:
            return _status_cache
        probe_audio = np.zeros(16000, dtype=np.float32).tobytes()
        result = _run_isolated(probe_audio)
        if result.get("ok"):
            _status_cache = {"available": True, "reason": None, "architecture": "AASIST-L (pretrained, ASVspoof2019)"}
        else:
            _status_cache = {
                "available": False,
                "reason": result.get("error", "AI detector unavailable - signal-based analysis used."),
            }
        return _status_cache


def detect(y: np.ndarray, sr: int) -> DeepfakeResult:
    """
    `y` must already be mono float32 at 16kHz (the same preprocessed
    waveform used for the rest of the acoustic analysis).
    """
    if not AI_DETECTOR_CONFIG["enabled"]:
        return DeepfakeResult(False, None, None, None, "unavailable",
                               "AI detector is disabled in this deployment.")

    status = ai_detector_status()
    if not status["available"]:
        return DeepfakeResult(
            False, None, None, None, "unavailable",
            f"AI detector unavailable ({status['reason']}) - signal-based analysis used.",
        )

    result = _run_isolated(y.astype(np.float32).tobytes())
    if not result.get("ok"):
        return DeepfakeResult(
            False, None, None, None, "unavailable",
            f"AI detector failed on this audio ({result.get('error')}) - signal-based analysis used.",
        )

    synthetic_probability = result["synthetic"]
    natural_probability = result["natural"]
    confidence = abs(synthetic_probability - natural_probability)

    if synthetic_probability >= natural_probability:
        evidence = (
            f"AASIST anti-spoofing model estimates {synthetic_probability * 100:.0f}% "
            "probability of synthetic/spoofed speech."
        )
    else:
        evidence = (
            f"AASIST anti-spoofing model estimates {natural_probability * 100:.0f}% "
            "probability of bonafide (natural) speech."
        )

    return DeepfakeResult(
        True,
        round(synthetic_probability, 4),
        round(natural_probability, 4),
        round(confidence, 4),
        "loaded",
        evidence,
    )
