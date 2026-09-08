"""
VoxShield Python client example.

Demonstrates how an external application (a call center tool, a banking
app's backend, etc.) could integrate with VoxShield's REST API: send audio
and optional caller/transaction context, and receive a structured risk
analysis back.

Requires only `requests` (pip install requests). No VoxShield-specific
SDK package exists yet - this file *is* the reference integration.

Run against a live VoxShield backend:
    python examples/python_client.py --audio path/to/file.wav
    python examples/python_client.py --demo synthetic
"""
from __future__ import annotations

import argparse
import json
import sys

import requests

DEFAULT_BASE_URL = "http://127.0.0.1:8000"


class VoxShieldClient:
    """Minimal reference client. Every method maps directly to one VoxShield
    REST endpoint - see backend/README.md for the full endpoint list."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL):
        self.base_url = base_url.rstrip("/")

    def health(self) -> dict:
        return requests.get(f"{self.base_url}/health", timeout=10).json()

    def analyze_file(
        self,
        audio_path: str,
        caller_name: str | None = None,
        contact_status: str | None = None,
        transaction_type: str | None = None,
        amount_inr: float | None = None,
        language: str | None = None,
        profile_id: str | None = None,
    ) -> dict:
        """Send a local audio file for full analysis. Returns the same JSON
        shape the dashboard consumes: trust_score, risk_level, indicators,
        recommendation, transcription, etc."""
        context = None
        if caller_name or contact_status or transaction_type or amount_inr:
            context = {
                "caller_name": caller_name,
                "contact_status": contact_status,
                "transaction_type": transaction_type,
                "amount_inr": amount_inr,
            }

        with open(audio_path, "rb") as f:
            files = {"file": (audio_path, f, "audio/wav")}
            data = {}
            if context:
                data["context"] = json.dumps(context)
            if language:
                data["language"] = language
            if profile_id:
                data["profile_id"] = profile_id
            resp = requests.post(f"{self.base_url}/api/analyze", files=files, data=data, timeout=120)
        resp.raise_for_status()
        return resp.json()

    def analyze_demo(self, key: str) -> dict:
        """key: 'natural' | 'synthetic' | 'noisy'"""
        resp = requests.post(f"{self.base_url}/api/demo", params={"key": key}, timeout=120)
        resp.raise_for_status()
        return resp.json()

    def get_analysis(self, analysis_id: str) -> dict:
        resp = requests.get(f"{self.base_url}/api/analysis/{analysis_id}", timeout=10)
        resp.raise_for_status()
        return resp.json()

    def history(self, limit: int = 50) -> list:
        resp = requests.get(f"{self.base_url}/api/history", params={"limit": limit}, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def verify_identity(self, analysis_id: str, verified: bool = True) -> dict:
        resp = requests.post(
            f"{self.base_url}/api/verify",
            data={"analysis_id": analysis_id, "verified": str(verified).lower()},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def check_transaction(self, analysis_id: str, amount_inr: float | None = None) -> dict:
        """Simulation only - see backend/app/api/routes.py::transaction_check.
        Never connects to a real payment system."""
        data = {"analysis_id": analysis_id}
        if amount_inr is not None:
            data["amount_inr"] = str(amount_inr)
        resp = requests.post(f"{self.base_url}/api/transaction/check", data=data, timeout=10)
        resp.raise_for_status()
        return resp.json()


def summarize(result: dict) -> dict:
    """Extract the fields most integrators care about, matching the shape
    shown in examples/README.md."""
    return {
        "analysis_id": result.get("analysis_id"),
        "trust_score": result.get("trust_score"),
        "risk_level": result.get("risk_level"),
        "recommendation": result.get("recommendation"),
        "top_evidence": [i["name"] for i in result.get("indicators", [])[:3]],
    }


def main():
    parser = argparse.ArgumentParser(description="VoxShield Python client example")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--audio", help="Path to a local audio file to analyze")
    parser.add_argument("--demo", choices=["natural", "synthetic", "noisy"], help="Run a bundled demo sample instead")
    parser.add_argument("--caller-name", default=None)
    parser.add_argument("--amount-inr", type=float, default=None)
    args = parser.parse_args()

    client = VoxShieldClient(args.base_url)

    try:
        health = client.health()
    except requests.exceptions.ConnectionError:
        print(f"Could not reach VoxShield backend at {args.base_url}. Is it running?", file=sys.stderr)
        sys.exit(1)
    print("Backend health:", health)

    if args.demo:
        result = client.analyze_demo(args.demo)
    elif args.audio:
        result = client.analyze_file(args.audio, caller_name=args.caller_name, amount_inr=args.amount_inr)
    else:
        print("Provide --audio <path> or --demo <natural|synthetic|noisy>", file=sys.stderr)
        sys.exit(1)

    print("\nFull response (truncated fields omitted for readability):")
    print(json.dumps(summarize(result), indent=2))

    if result["risk_level"] == "HIGH":
        print("\nHIGH risk - checking simulated transaction gate...")
        check = client.check_transaction(result["analysis_id"], amount_inr=args.amount_inr or 50000)
        print(json.dumps(check, indent=2))


if __name__ == "__main__":
    main()
