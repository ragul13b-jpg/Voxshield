import logging

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.config import DEMO_AUDIO_DIR
from app.services import db
from app.services.demo_audio_generator import generate_all

logger = logging.getLogger("voxshield")

app = FastAPI(
    title="VoxShield API",
    description="AI-powered real-time detection of voice cloning / impersonation attacks (hackathon prototype).",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # prototype only - restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Catch-all so an unexpected error (malformed audio the earlier checks
    didn't anticipate, a database hiccup, etc.) never leaks a Python
    stack trace to the client - it gets a clean JSON error, and the real
    details go to the server log for debugging.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal error while processing this request. Please try again."},
    )


DEMO_DIR = Path(__file__).resolve().parent.parent / DEMO_AUDIO_DIR
DEMO_DIR.mkdir(parents=True, exist_ok=True)


@app.on_event("startup")
def on_startup():
    try:
        db.init_db()
    except Exception:
        logger.exception("Database initialization failed - history/profiles will be unavailable")
    # Guarantee demo mode works out-of-the-box even if the audio files were
    # never committed / were deleted.
    try:
        generate_all(force=False)
    except Exception:
        logger.exception("Demo audio generation failed - Demo Mode may be unavailable")


app.include_router(router)

# Serve the (already-generated) demo audio files as static assets so the
# frontend can fetch the raw bytes and slice them into chunks itself for the
# Live Call Monitor demo simulation - no new analysis endpoint needed, this
# just exposes files that already exist on disk.
app.mount("/demo_audio", StaticFiles(directory=str(DEMO_DIR)), name="demo_audio")


@app.get("/")
def root():
    return {
        "service": "VoxShield API",
        "status": "running",
        "docs": "/docs",
    }
