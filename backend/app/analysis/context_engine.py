"""
Contextual enrichment layer.

The SIH statement calls for using "contextual information such as
caller/contact information and transaction context" as part of the risk
assessment. This module turns a small, demo-friendly context payload into a
deterministic, fully-traceable risk fraction - every contribution here maps
to a rule in `app.config.CONTEXT_RULES`, nothing is randomized or guessed.

This never touches a real telecom or banking system - `context` is supplied
by the caller of the API (in the prototype, typed into the dashboard).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.config import CONTEXT_RULES

# Factor weights must sum to 1.0
_FACTOR_WEIGHTS = {
    "contact_status": 0.30,
    "sensitivity": 0.20,
    "transaction_type": 0.25,
    "high_amount": 0.10,
    "historical_fraud_flag": 0.10,
    "urgency_language": 0.05,
}

_URGENCY_KEYWORDS = ["immediately", "right now", "urgent", "don't tell", "do not tell", "hurry", "asap"]


@dataclass
class ContextFactor:
    label: str
    value: float  # 0..1 rule-derived risk contribution before weighting
    weight: float
    detail: str


@dataclass
class ContextResult:
    risk_fraction: float  # 0..1
    level: str            # HIGH / MEDIUM / LOW
    factors: list[ContextFactor] = field(default_factory=list)
    summary: str = ""


def _level(risk_fraction: float) -> str:
    if risk_fraction >= 0.6:
        return "HIGH"
    if risk_fraction >= 0.3:
        return "MEDIUM"
    return "LOW"


def compute_context_risk(context: dict) -> ContextResult:
    """
    Expected `context` keys (all optional, sensible defaults used if absent):
      caller_name: str
      contact_status: "known_verified" | "known" | "unknown" | "unverified"
      sensitivity: "low" | "medium" | "high"
      transaction_type: "none" | "information_request" | "otp_or_pin_share"
                         | "password_share" | "money_transfer"
      amount_inr: number
      historical_fraud_flag: bool
      request_text: str  (used only for a simple urgency-keyword check)
    """
    contact_status = (context.get("contact_status") or "unknown").lower()
    sensitivity = (context.get("sensitivity") or "medium").lower()
    transaction_type = (context.get("transaction_type") or "none").lower()
    amount = context.get("amount_inr")
    fraud_flag = bool(context.get("historical_fraud_flag"))
    request_text = (context.get("request_text") or "").lower()

    contact_risk = CONTEXT_RULES["contact_status_risk"].get(contact_status, 0.4)
    sensitivity_risk = CONTEXT_RULES["sensitivity_risk"].get(sensitivity, 0.35)
    txn_risk = CONTEXT_RULES["transaction_type_risk"].get(transaction_type, 0.15)

    high_amount = bool(amount) and amount >= CONTEXT_RULES["high_amount_threshold_inr"]
    amount_risk = CONTEXT_RULES["high_amount_risk"] if high_amount else 0.0

    fraud_risk = CONTEXT_RULES["historical_fraud_flag_risk"] if fraud_flag else 0.0

    urgent = any(kw in request_text for kw in _URGENCY_KEYWORDS)
    urgency_risk = CONTEXT_RULES["urgency_language_risk"] if urgent else 0.0

    factors = [
        ContextFactor("Contact trust", contact_risk, _FACTOR_WEIGHTS["contact_status"],
                      f"Contact status is {contact_status.replace('_', ' ')}"),
        ContextFactor("Request sensitivity", sensitivity_risk, _FACTOR_WEIGHTS["sensitivity"],
                      f"Request sensitivity is {sensitivity}"),
        ContextFactor("Transaction type", txn_risk, _FACTOR_WEIGHTS["transaction_type"],
                      f"Transaction type is {transaction_type.replace('_', ' ')}"),
        ContextFactor("Transaction amount", amount_risk, _FACTOR_WEIGHTS["high_amount"],
                      f"Amount ₹{amount:,.0f} {'exceeds' if high_amount else 'is below'} the high-value threshold"
                      if amount else "No amount supplied"),
        ContextFactor("Historical fraud indicator", fraud_risk, _FACTOR_WEIGHTS["historical_fraud_flag"],
                      "Flagged in demo fraud history" if fraud_flag else "No fraud history flagged"),
        ContextFactor("Urgency language", urgency_risk, _FACTOR_WEIGHTS["urgency_language"],
                      "Pressure/urgency phrasing detected in request text" if urgent
                      else "No urgency phrasing detected"),
    ]

    risk_fraction = sum(f.value * f.weight for f in factors)
    risk_fraction = max(0.0, min(1.0, risk_fraction))
    level = _level(risk_fraction)

    top = sorted(factors, key=lambda f: f.value * f.weight, reverse=True)[:3]
    summary = "; ".join(t.detail for t in top if t.value > 0) or "No elevated contextual risk factors."

    return ContextResult(risk_fraction=round(risk_fraction, 4), level=level, factors=factors, summary=summary)
