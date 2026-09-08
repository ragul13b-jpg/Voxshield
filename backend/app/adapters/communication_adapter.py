"""
Communication adapter architecture.

The analysis engine (feature extraction -> risk fusion -> Voice Trust
Score) should never need to know or care *how* audio arrived - a file
upload, a browser microphone, a WebRTC call, or (in the future) a real
telecom/VoIP trunk should all look the same to it: a stream of audio
chunks plus some session metadata. This module defines that interface and
the concrete adapters that are actually implemented today.

STATUS OF EACH ADAPTER (be precise about this - it matters for SIH judging):

  DemoFileAdapter      IMPLEMENTED - reads a bundled demo .wav and yields it
                        as chunks. Used by the Live Call Monitor's scenario
                        buttons.
  BrowserMicAdapter     IMPLEMENTED - the browser's Web Audio API records
                        and slices microphone audio into chunks client-side;
                        this class documents/represents that flow so it fits
                        the same interface conceptually, but the actual
                        capture happens in the browser (see
                        frontend/src/utils/wavRecorder.js), not in Python.
  WebRTCAdapter         INTEGRATION READY - a real signaling relay exists
                        (see app/api/routes.py's `/ws/signal/{room}`
                        WebSocket endpoint) and the browser-side
                        RTCPeerConnection code is implemented (see
                        frontend/src/components/WebRTCDemo.jsx), but this
                        specific server-side adapter class is a thin
                        placeholder - chunk audio from a WebRTC stream is
                        currently sent straight to /api/analyze-chunk by
                        the frontend, the same as microphone chunks. This
                        class exists so a future version can formalize
                        that path through the same adapter interface.
  VoIPAdapter           FUTURE / EXTERNAL INTEGRATION - not implemented.
                        Would require a SIP/VoIP trunk or provider
                        integration (e.g. Twilio, Asterisk) that VoxShield
                        does not have access to in this prototype.
  TelecomAdapter        FUTURE / EXTERNAL INTEGRATION - not implemented.
                        Would require carrier/telecom-grade infrastructure
                        access far beyond a hackathon prototype's scope.
                        VoxShield does NOT intercept ordinary cellular calls.

Do not present WebRTCAdapter, VoIPAdapter, or TelecomAdapter as fully
working end-to-end integrations - see SIH26104_COVERAGE.md for the
authoritative status of each.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Iterator


class AdapterStatus(str, Enum):
    IMPLEMENTED = "IMPLEMENTED"
    INTEGRATION_READY = "INTEGRATION_READY"
    FUTURE_EXTERNAL_INTEGRATION = "FUTURE_EXTERNAL_INTEGRATION"


@dataclass
class CallerMetadata:
    caller_name: str | None = None
    caller_number: str | None = None
    contact_status: str | None = None  # known_verified | known | unknown | unverified
    session_id: str | None = None
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class AudioChunkEvent:
    session_id: str
    chunk_index: int
    audio_bytes: bytes
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class RiskEvent:
    session_id: str
    chunk_index: int
    trust_score: int
    risk_level: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CommunicationAdapter(ABC):
    """
    Common interface every audio source implements, so the analysis engine
    can stay protocol-agnostic. A concrete adapter is responsible for:
      - producing audio chunks (`stream_chunks`)
      - reporting caller/session metadata (`get_metadata`)
      - accepting risk events to forward/alert on (`on_risk_event`)
      - cleanly ending a session (`end_session`)
    """

    status: AdapterStatus

    @abstractmethod
    def get_metadata(self) -> CallerMetadata:
        ...

    @abstractmethod
    def stream_chunks(self) -> Iterator[AudioChunkEvent]:
        """Yields audio chunks as they become available. For file-based
        adapters this yields immediately in a loop; for a live adapter this
        would block/await between chunks as real audio arrives."""
        ...

    def on_risk_event(self, event: RiskEvent, callback: Callable[[RiskEvent], None] | None = None) -> None:
        """Default: just invoke the callback if one was given (e.g. to push
        a WebSocket message to a connected client). Adapters with a richer
        transport (e.g. a real telecom API) would override this to also
        trigger provider-side alerts."""
        if callback:
            callback(event)

    @abstractmethod
    def end_session(self) -> None:
        ...


class DemoFileAdapter(CommunicationAdapter):
    """IMPLEMENTED. Reads a local demo audio file and yields it as
    fixed-size chunks - this is what powers the Live Call Monitor's
    deterministic Natural/Suspicious/AI-Cloned scenario buttons."""

    status = AdapterStatus.IMPLEMENTED

    def __init__(self, audio_bytes: bytes, sample_rate: int, session_id: str,
                 caller_name: str | None = None, chunk_seconds: float = 1.6):
        self._audio_bytes = audio_bytes
        self._sample_rate = sample_rate
        self._session_id = session_id
        self._caller_name = caller_name
        self._chunk_seconds = chunk_seconds
        self._ended = False

    def get_metadata(self) -> CallerMetadata:
        return CallerMetadata(
            caller_name=self._caller_name,
            contact_status="unknown",
            session_id=self._session_id,
        )

    def stream_chunks(self) -> Iterator[AudioChunkEvent]:
        # Actual slicing happens client-side today (see
        # frontend/src/utils/wavRecorder.js::sliceIntoWindows) so the browser
        # can pace chunk delivery for the live UI. This method documents the
        # equivalent server-side shape of that same operation for a future
        # fully-server-driven pipeline (e.g. for the evaluation framework,
        # which does call this directly - see app/evaluation/evaluate.py).
        chunk_len = int(self._chunk_seconds * self._sample_rate) * 2  # 2 bytes/sample (16-bit PCM)
        for i in range(0, len(self._audio_bytes), chunk_len):
            if self._ended:
                return
            yield AudioChunkEvent(
                session_id=self._session_id,
                chunk_index=i // chunk_len,
                audio_bytes=self._audio_bytes[i:i + chunk_len],
            )

    def end_session(self) -> None:
        self._ended = True


class BrowserMicAdapter(CommunicationAdapter):
    """IMPLEMENTED (client-driven). The actual chunking and delivery happens
    in the browser (Web Audio API + WavRecorder, see
    frontend/src/utils/wavRecorder.js) which POSTs each chunk to
    `/api/analyze-chunk`. This class exists mainly for interface symmetry
    and documentation; server-side, each incoming chunk request is already
    handled uniformly regardless of which adapter produced it."""

    status = AdapterStatus.IMPLEMENTED

    def __init__(self, session_id: str, caller_name: str | None = "You (live microphone)"):
        self._session_id = session_id
        self._caller_name = caller_name
        self._ended = False

    def get_metadata(self) -> CallerMetadata:
        return CallerMetadata(caller_name=self._caller_name, contact_status="known_verified", session_id=self._session_id)

    def stream_chunks(self) -> Iterator[AudioChunkEvent]:
        raise NotImplementedError(
            "Microphone audio is captured and chunked in the browser, not read from a "
            "server-side stream. See frontend/src/utils/wavRecorder.js."
        )

    def end_session(self) -> None:
        self._ended = True


class WebRTCAdapter(CommunicationAdapter):
    """
    INTEGRATION READY, not a finished end-to-end pipeline.

    What exists: a real WebSocket signaling relay
    (`/ws/signal/{room}` in app/api/routes.py) and a real browser-side
    RTCPeerConnection implementation (frontend/src/components/WebRTCDemo.jsx)
    that establishes a genuine peer-to-peer audio connection between two
    browser tabs/devices on the same local network or via a STUN server.

    What this class does NOT do: currently, chunk extraction from the
    received remote MediaStream and delivery to /api/analyze-chunk happens
    entirely client-side (same mechanism as BrowserMicAdapter, just sourced
    from the remote peer's track instead of the local mic). This
    server-side class is a placeholder for a future version that would
    formalize a server-side media relay (e.g. via an SFU) so adapters could
    be swapped without any frontend changes.
    """

    status = AdapterStatus.INTEGRATION_READY

    def __init__(self, session_id: str, room_id: str):
        self._session_id = session_id
        self._room_id = room_id

    def get_metadata(self) -> CallerMetadata:
        return CallerMetadata(contact_status="unknown", session_id=self._session_id)

    def stream_chunks(self) -> Iterator[AudioChunkEvent]:
        raise NotImplementedError(
            "WebRTC audio chunks are currently sent directly from the browser to "
            "/api/analyze-chunk (see frontend/src/components/WebRTCDemo.jsx) rather than "
            "read server-side through this adapter. Formalizing a server-side media relay "
            "is future work."
        )

    def end_session(self) -> None:
        pass


class VoIPAdapter(CommunicationAdapter):
    """FUTURE / EXTERNAL INTEGRATION. Not implemented - would require a real
    VoIP/SIP provider integration (e.g. Twilio Media Streams, Asterisk/FreeSWITCH)
    that this prototype does not have access to. Every method raises
    NotImplementedError on purpose so this can never be silently used as if
    it worked."""

    status = AdapterStatus.FUTURE_EXTERNAL_INTEGRATION

    def get_metadata(self) -> CallerMetadata:
        raise NotImplementedError("VoIPAdapter is a future/external integration point - not implemented.")

    def stream_chunks(self) -> Iterator[AudioChunkEvent]:
        raise NotImplementedError("VoIPAdapter is a future/external integration point - not implemented.")

    def end_session(self) -> None:
        raise NotImplementedError("VoIPAdapter is a future/external integration point - not implemented.")


class TelecomAdapter(CommunicationAdapter):
    """FUTURE / EXTERNAL INTEGRATION. Not implemented, and not something a
    hackathon prototype can implement - real telecom/cellular interception
    requires carrier-grade infrastructure and legal authorization VoxShield
    does not have. This class exists purely to document the intended future
    extension point. VoxShield does NOT and never has intercepted ordinary
    cellular calls."""

    status = AdapterStatus.FUTURE_EXTERNAL_INTEGRATION

    def get_metadata(self) -> CallerMetadata:
        raise NotImplementedError("TelecomAdapter is a future/external integration point - not implemented.")

    def stream_chunks(self) -> Iterator[AudioChunkEvent]:
        raise NotImplementedError("TelecomAdapter is a future/external integration point - not implemented.")

    def end_session(self) -> None:
        raise NotImplementedError("TelecomAdapter is a future/external integration point - not implemented.")
