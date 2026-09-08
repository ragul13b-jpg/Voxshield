from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.analysis.deepfake_detector import ai_detector_status
from app.analysis.feature_extraction import AudioDecodeError, AudioTooShortError
from app.analysis.transcription import transcription_engine_status
from app.config import DEMO_AUDIO_DIR, DATA_RETENTION_AUDIT, PRIVACY_CONFIG, SUPPORTED_LANGUAGES, TRANSCRIPTION_CONFIG
from app.services import db
from app.services.analysis_service import enroll_profile, run_chunk_analysis, run_full_analysis

logger = logging.getLogger("voxshield.signaling")

router = APIRouter()

DEMO_DIR = Path(__file__).resolve().parent.parent.parent / DEMO_AUDIO_DIR

DEMO_CATALOG = {
    "natural": {
        "label": "Natural Voice",
        "expected_risk_level": "LOW",
        "description": "A live, unscripted-sounding voice with natural pitch variation, "
                        "breathing and pausing.",
    },
    "synthetic": {
        "label": "Synthetic / Cloned Voice",
        "expected_risk_level": "HIGH",
        "description": "A flat-pitch, mechanically regular voice consistent with TTS or "
                        "voice-cloning output.",
    },
    "noisy": {
        "label": "Uncertain / Noisy Voice",
        "expected_risk_level": "SUSPICIOUS",
        "description": "A degraded, low-quality call with mixed natural and synthetic-like "
                        "characteristics.",
    },
}


def _parse_context(context_json: str | None) -> dict | None:
    if not context_json:
        return None
    try:
        parsed = json.loads(context_json)
        return parsed if isinstance(parsed, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


@router.get("/health")
def health():
    return {"status": "ok", "service": "VoxShield API"}


@router.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...),
    context: str | None = Form(None),
    profile_id: str | None = Form(None),
    language: str | None = Form(None),
    source_label: str | None = Form(None),
    source_tag: str | None = Form(None),
):
    audio_bytes = await file.read()
    try:
        record = run_full_analysis(
            audio_bytes,
            source=source_tag or "upload",
            source_label=source_label or file.filename,
            context=_parse_context(context),
            profile_id=profile_id or None,
            language=language,
        )
    except AudioTooShortError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except AudioDecodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return JSONResponse(record)


@router.post("/api/analyze-record")
async def analyze_record(
    file: UploadFile = File(...),
    context: str | None = Form(None),
    profile_id: str | None = Form(None),
    language: str | None = Form(None),
    source_label: str | None = Form(None),
    source_tag: str | None = Form(None),
):
    audio_bytes = await file.read()
    try:
        record = run_full_analysis(
            audio_bytes,
            source=source_tag or "record",
            source_label=source_label or "Microphone recording",
            context=_parse_context(context),
            profile_id=profile_id or None,
            language=language,
        )
    except AudioTooShortError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except AudioDecodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return JSONResponse(record)


@router.post("/api/analyze-chunk")
async def analyze_chunk(file: UploadFile = File(...), chunk_index: int = 0):
    """Near-real-time prototype analysis of a short (~1.5s) audio chunk."""
    audio_bytes = await file.read()
    try:
        result = run_chunk_analysis(audio_bytes, chunk_index)
    except AudioTooShortError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except AudioDecodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return JSONResponse(result)


@router.get("/api/demo-samples")
def demo_samples():
    samples = []
    for key, meta in DEMO_CATALOG.items():
        path = DEMO_DIR / f"{key}.wav"
        samples.append(
            {
                "key": key,
                "label": meta["label"],
                "expected_risk_level": meta["expected_risk_level"],
                "description": meta["description"],
                "available": path.exists(),
            }
        )
    return samples


@router.post("/api/demo")
def analyze_demo(
    key: str,
    context: str | None = Form(None),
    profile_id: str | None = Form(None),
    language: str | None = Form(None),
    source_label: str | None = Form(None),
    source_tag: str | None = Form(None),
):
    if key not in DEMO_CATALOG:
        raise HTTPException(status_code=404, detail=f"Unknown demo sample '{key}'")
    path = DEMO_DIR / f"{key}.wav"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Demo audio file missing. Place a WAV file at backend/{DEMO_AUDIO_DIR}/{key}.wav",
        )
    audio_bytes = path.read_bytes()
    record = run_full_analysis(
        audio_bytes,
        source=source_tag or "demo",
        source_label=source_label or DEMO_CATALOG[key]["label"],
        context=_parse_context(context),
        profile_id=profile_id or None,
        language=language,
    )
    return JSONResponse(record)


@router.get("/api/analysis/{analysis_id}")
def get_analysis(analysis_id: str):
    record = db.get_analysis(analysis_id)
    if not record:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return record


@router.get("/api/history")
def get_history(limit: int = 50):
    return db.list_history(limit=limit)


# ---------------------------------------------------------------------------
# Identity verification
# ---------------------------------------------------------------------------

@router.post("/api/verify")
def verify_identity(analysis_id: str = Form(...), verified: bool = Form(...)):
    status = "VERIFIED" if verified else "REQUIRED"
    record = db.update_verification(analysis_id, status)
    if not record:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return {"analysis_id": analysis_id, "verification_status": status}


# ---------------------------------------------------------------------------
# Transaction simulation
# ---------------------------------------------------------------------------

@router.post("/api/transaction/check")
def transaction_check(analysis_id: str = Form(...), amount_inr: float | None = Form(None)):
    """
    Simulation only - never connects to a real payment/banking system.
    Blocks the simulated transaction when the linked analysis is HIGH risk
    and identity has not been marked as independently verified.
    """
    record = db.get_analysis(analysis_id)
    if not record:
        raise HTTPException(status_code=404, detail="Analysis not found")

    risk_level = record["risk_level"]
    verified = record.get("verification_status") == "VERIFIED"

    if risk_level == "HIGH" and not verified:
        return {
            "allowed": False,
            "status": "BLOCKED",
            "reason": "Voice authenticity could not be sufficiently verified. "
                      "Independent verification required.",
        }
    if risk_level == "SUSPICIOUS" and not verified:
        return {
            "allowed": True,
            "status": "ALLOWED_WITH_WARNING",
            "reason": "Uncertain voice authenticity - proceed with caution and consider "
                      "independent verification.",
        }
    return {
        "allowed": True,
        "status": "ALLOWED",
        "reason": (
            "Identity was independently verified, so this simulated action is allowed despite "
            f"the {risk_level.lower()} voice-authenticity risk."
            if verified and risk_level in ("HIGH", "SUSPICIOUS")
            else "No strong synthetic indicators detected."
        ),
    }


# ---------------------------------------------------------------------------
# Known voice profiles (prototype cross-session consistency)
# ---------------------------------------------------------------------------

@router.post("/api/enroll-profile")
async def enroll_voice_profile(file: UploadFile = File(...), name: str = Form(...)):
    audio_bytes = await file.read()
    try:
        result = enroll_profile(audio_bytes, name)
    except AudioTooShortError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except AudioDecodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@router.get("/api/profiles")
def list_voice_profiles():
    return db.list_profiles()


@router.get("/api/profiles/{profile_id}/sessions")
def get_profile_sessions(profile_id: str):
    profile = db.get_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    sessions = db.list_profile_sessions(profile_id)
    return {
        "profile_id": profile_id,
        "profile_name": profile["name"],
        "session_count": len(sessions),
        "sessions": [
            {
                "session_id": s["session_id"],
                "created_at": s["created_at"],
                "is_enrollment": s["is_enrollment"],
                "analysis_id": s["analysis_id"],
            }
            for s in sessions
        ],
    }


# ---------------------------------------------------------------------------
# Language / privacy metadata
# ---------------------------------------------------------------------------

@router.get("/api/languages")
def languages():
    return {
        "supported": SUPPORTED_LANGUAGES,
        "note": "Transcription (faster-whisper) genuinely attempts recognition in each of "
                "these languages; the acoustic voice-authenticity pipeline itself is "
                "language-agnostic and runs the same regardless of language. Recognition "
                "accuracy varies by language, accent, dialect and audio quality and has not "
                "been independently benchmarked per language in this prototype.",
    }


@router.get("/api/transcription-status")
def transcription_status():
    """Lets the frontend show an honest engine-availability state up front,
    rather than only discovering it after a full analysis call."""
    status = transcription_engine_status()
    return {
        **status,
        "enabled": TRANSCRIPTION_CONFIG["enabled"],
        "model_size": TRANSCRIPTION_CONFIG["model_size"],
    }


@router.get("/api/ai-detector-status")
def ai_detector_status_endpoint():
    """Same idea for the optional AASIST-based AI deepfake detector - lets
    the UI show up front whether it's actually loaded, without waiting for
    a full analysis. Requires `torch` (see requirements-ai.txt); when
    unavailable, risk fusion continues using the other signals only."""
    return ai_detector_status()


@router.get("/api/privacy")
def privacy_info():
    return {
        "config": PRIVACY_CONFIG,
        "statements": [
            "Raw audio not retained" if not PRIVACY_CONFIG["retain_raw_audio"] else "Raw audio retained (demo setting)",
            "Feature-level analysis" if PRIVACY_CONFIG["retain_features"] else "Features not retained",
            "Minimal metadata logging" if PRIVACY_CONFIG["retain_metadata"] else "No metadata logging",
        ],
        "edge_inference": "Architecture ready for edge/on-device inference." if not PRIVACY_CONFIG["edge_inference_ready"]
        else "Edge/on-device inference enabled.",
        "data_retention_audit": DATA_RETENTION_AUDIT,
        "disclaimer": "This describes what this prototype's code actually does, not a legal or "
                       "regulatory compliance certification (e.g. GDPR/DPDP). No such certification "
                       "is claimed.",
    }


# ---------------------------------------------------------------------------
# WebRTC signaling relay ("Controlled WebRTC/VoIP Security Demonstration")
#
# This is a minimal WebSocket relay: it does not touch, decode, or analyze
# any audio itself. It only relays SDP offers/answers and ICE candidates
# between exactly two browser tabs/devices that join the same room, so they
# can establish a genuine peer-to-peer WebRTC audio connection. Once
# connected, the browser sends received audio in chunks straight to
# /api/analyze-chunk (the same endpoint the microphone flow already uses) -
# this relay's only job is helping two browsers find each other.
#
# This is explicitly NOT telecom/cellular call interception - see
# app/adapters/communication_adapter.py::WebRTCAdapter and
# SIH26104_COVERAGE.md for exactly what is and isn't implemented here.
# ---------------------------------------------------------------------------

_signaling_rooms: dict[str, list[WebSocket]] = {}


@router.websocket("/ws/signal/{room_id}")
async def signaling_relay(websocket: WebSocket, room_id: str):
    await websocket.accept()
    peers = _signaling_rooms.setdefault(room_id, [])

    if len(peers) >= 2:
        await websocket.send_json({"type": "error", "message": "Room already has two participants."})
        await websocket.close()
        return

    peers.append(websocket)
    await websocket.send_json({"type": "joined", "room_id": room_id, "peer_count": len(peers)})
    if len(peers) == 2:
        for peer in peers:
            await peer.send_json({"type": "ready"})

    try:
        while True:
            message = await websocket.receive_text()
            for peer in peers:
                if peer is not websocket:
                    await peer.send_text(message)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Signaling relay error in room %s", room_id)
    finally:
        if websocket in peers:
            peers.remove(websocket)
        for peer in peers:
            try:
                await peer.send_json({"type": "peer_left"})
            except Exception:
                pass
        if not peers:
            _signaling_rooms.pop(room_id, None)
