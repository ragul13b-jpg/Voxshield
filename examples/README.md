# VoxShield integration examples

No dedicated SDK package exists yet - these two files *are* the reference
integration, in Python and JavaScript. Both were tested against a live
VoxShield backend (not just written and assumed to work) and produced real,
non-hardcoded responses - see the example output below.

## Requirements

- A running VoxShield backend (`cd ../backend && uvicorn app.main:app --port 8000`)
- Python: `pip install requests`
- JavaScript: Node.js 18+ (native `fetch`) - no npm install needed

## Usage

```bash
# Python
python python_client.py --demo synthetic
python python_client.py --audio ./my-recording.wav --caller-name "Priya" --amount-inr 50000

# JavaScript (Node)
node javascript_client.js --demo synthetic
node javascript_client.js --audio ./my-recording.wav
```

## What a real response looks like

This is actual output from `python python_client.py --demo synthetic`
(not a hand-written example) against a locally running backend:

```json
{
  "analysis_id": "VX-0009",
  "trust_score": 31,
  "risk_level": "HIGH",
  "recommendation": "Do not perform sensitive actions until identity has been independently verified through a separate, trusted communication channel.",
  "top_evidence": ["Prosody anomaly", "Spectral anomaly", "Synthetic artifacts"]
}

HIGH risk - checking simulated transaction gate...
{
  "allowed": false,
  "status": "BLOCKED",
  "reason": "Voice authenticity could not be sufficiently verified. Independent verification required."
}
```

## What a real integration would do with this

1. Send the caller's audio via `analyze_file()` / `analyzeFile()`, optionally
   with caller/contact/transaction context
2. Read `trust_score`, `risk_level`, and `recommendation` from the response
3. If `risk_level` is `HIGH`, call `check_transaction()` /
   `checkTransaction()` before allowing a sensitive action to proceed - it
   returns `allowed: false` until `verify_identity()` / `verifyIdentity()`
   has been called for that analysis
4. Read `indicators` for the full explainable-evidence list (not just the
   top 3 shown in the summary above)

## Full endpoint reference

See `../backend/README.md` for every available endpoint, request/response
shape, and interactive docs at `http://127.0.0.1:8000/docs` (FastAPI's
auto-generated OpenAPI UI) while the backend is running.

## Important: this is a prototype API, not a production SDK

- No authentication/API-key mechanism exists - do not expose this backend
  directly to the public internet as-is.
- `check_transaction()` is a simulation - it never touches a real payment
  or banking system.
- Response shapes may change between prototype iterations; there is no
  versioned API contract yet.
