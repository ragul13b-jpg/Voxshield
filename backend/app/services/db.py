"""
Storage layer.

Deliberately thin and modular: everything the rest of the app needs is
expressed through the functions below. Swapping SQLite for
PostgreSQL/Supabase later only requires re-implementing this module -
callers never touch SQL directly.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from app.config import DB_PATH

_DB_FILE = Path(__file__).resolve().parent.parent.parent / DB_PATH


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS analyses (
                analysis_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                source TEXT NOT NULL,
                source_label TEXT,
                duration_seconds REAL,
                risk_score INTEGER,
                risk_level TEXT,
                human_probability REAL,
                synthetic_probability REAL,
                payload_json TEXT NOT NULL
            )
            """
        )
        # Additive, backward-compatible migration: these columns were added
        # after the table above was first created. ADD COLUMN fails loudly if
        # the column already exists, so each is attempted independently and
        # any failure (already present, or genuinely unsupported) is ignored -
        # startup must never crash because of this.
        for ddl in (
            "ALTER TABLE analyses ADD COLUMN trust_score INTEGER",
            "ALTER TABLE analyses ADD COLUMN language TEXT",
            "ALTER TABLE analyses ADD COLUMN verification_status TEXT",
        ):
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS voice_profiles (
                profile_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                features_json TEXT NOT NULL
            )
            """
        )
        # Multi-session history: every sample ever compared against a profile
        # (starting with the enrollment sample itself) is stored here as its
        # own "session", so later comparisons can genuinely be checked
        # against multiple prior sessions rather than a single snapshot.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS profile_sessions (
                session_id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                features_json TEXT NOT NULL,
                analysis_id TEXT,
                is_enrollment INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.commit()


@contextmanager
def _connect():
    conn = sqlite3.connect(_DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def save_analysis(record: dict) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO analyses
            (analysis_id, created_at, source, source_label, duration_seconds,
             risk_score, risk_level, human_probability, synthetic_probability,
             trust_score, language, verification_status, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["analysis_id"],
                record["created_at"],
                record["source"],
                record.get("source_label"),
                record["duration_seconds"],
                record["risk_score"],
                record["risk_level"],
                record["human_probability"],
                record["synthetic_probability"],
                record.get("trust_score"),
                record.get("language"),
                record.get("verification_status"),
                json.dumps(record),
            ),
        )
        conn.commit()


def get_analysis(analysis_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT payload_json FROM analyses WHERE analysis_id = ?", (analysis_id,)
        ).fetchone()
        if not row:
            return None
        return json.loads(row["payload_json"])


def list_history(limit: int = 50) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT analysis_id, created_at, source, source_label,
                   duration_seconds, risk_score, risk_level,
                   trust_score, language, verification_status
            FROM analyses
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def next_analysis_id() -> str:
    with _connect() as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM analyses").fetchone()["c"]
        return f"VX-{count + 1:04d}"


def update_verification(analysis_id: str, status: str) -> dict | None:
    record = get_analysis(analysis_id)
    if not record:
        return None
    record["verification_status"] = status
    save_analysis(record)
    return record


# ---------------------------------------------------------------------------
# Voice profiles ("known voice profile" for prototype speaker consistency)
# ---------------------------------------------------------------------------

def save_profile(profile_id: str, name: str, created_at: str, features: dict) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO voice_profiles (profile_id, name, created_at, features_json)
            VALUES (?, ?, ?, ?)
            """,
            (profile_id, name, created_at, json.dumps(features)),
        )
        conn.commit()


def get_profile(profile_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT profile_id, name, created_at, features_json FROM voice_profiles WHERE profile_id = ?",
            (profile_id,),
        ).fetchone()
        if not row:
            return None
        features = json.loads(row["features_json"])
        return {"profile_id": row["profile_id"], "name": row["name"], "created_at": row["created_at"], **features}


def list_profiles() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT profile_id, name, created_at FROM voice_profiles ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def next_profile_id() -> str:
    with _connect() as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM voice_profiles").fetchone()["c"]
        return f"VP-{count + 1:04d}"


# ---------------------------------------------------------------------------
# Multi-session speaker consistency history
#
# Every sample ever compared against a profile (including the original
# enrollment) is stored as its own session row, so later comparisons check
# against genuine prior sessions, not just a single stored snapshot.
# ---------------------------------------------------------------------------

def save_profile_session(
    profile_id: str, created_at: str, features: dict, analysis_id: str | None = None,
    is_enrollment: bool = False,
) -> str:
    with _connect() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM profile_sessions WHERE profile_id = ?", (profile_id,)
        ).fetchone()["c"]
        session_id = f"{profile_id}-S{count + 1:03d}"
        conn.execute(
            """
            INSERT INTO profile_sessions
            (session_id, profile_id, created_at, features_json, analysis_id, is_enrollment)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, profile_id, created_at, json.dumps(features), analysis_id, int(is_enrollment)),
        )
        conn.commit()
        return session_id


def list_profile_sessions(profile_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT session_id, profile_id, created_at, features_json, analysis_id, is_enrollment
            FROM profile_sessions WHERE profile_id = ? ORDER BY created_at ASC
            """,
            (profile_id,),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["features"] = json.loads(d.pop("features_json"))
            d["is_enrollment"] = bool(d["is_enrollment"])
            out.append(d)
        return out
