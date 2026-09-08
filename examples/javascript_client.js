/**
 * VoxShield JavaScript client example.
 *
 * Demonstrates how a web/Node application could integrate with VoxShield's
 * REST API using plain `fetch` - no VoxShield-specific SDK package exists
 * yet, this file *is* the reference integration. Works in Node 18+ (native
 * fetch/FormData/Blob) or in a browser.
 *
 * Node usage:
 *   node examples/javascript_client.js --demo synthetic
 *   node examples/javascript_client.js --audio ./sample.wav
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

class VoxShieldClient {
  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async health() {
    const res = await fetch(`${this.baseUrl}/health`);
    return res.json();
  }

  /**
   * @param {Blob|Buffer} audioData - audio file bytes
   * @param {string} filename
   * @param {object} [options]
   * @param {object} [options.context] - { caller_name, contact_status, transaction_type, amount_inr }
   * @param {string} [options.language]
   * @param {string} [options.profileId]
   */
  async analyzeFile(audioData, filename, options = {}) {
    const form = new FormData();
    const blob = audioData instanceof Blob ? audioData : new Blob([audioData], { type: 'audio/wav' });
    form.append('file', blob, filename);
    if (options.context) form.append('context', JSON.stringify(options.context));
    if (options.language) form.append('language', options.language);
    if (options.profileId) form.append('profile_id', options.profileId);

    const res = await fetch(`${this.baseUrl}/api/analyze`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`VoxShield analyze failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /** key: 'natural' | 'synthetic' | 'noisy' */
  async analyzeDemo(key) {
    const res = await fetch(`${this.baseUrl}/api/demo?key=${encodeURIComponent(key)}`, { method: 'POST' });
    if (!res.ok) throw new Error(`VoxShield demo analyze failed: ${res.status}`);
    return res.json();
  }

  async getAnalysis(analysisId) {
    const res = await fetch(`${this.baseUrl}/api/analysis/${encodeURIComponent(analysisId)}`);
    return res.json();
  }

  async history(limit = 50) {
    const res = await fetch(`${this.baseUrl}/api/history?limit=${limit}`);
    return res.json();
  }

  async verifyIdentity(analysisId, verified = true) {
    const form = new FormData();
    form.append('analysis_id', analysisId);
    form.append('verified', String(verified));
    const res = await fetch(`${this.baseUrl}/api/verify`, { method: 'POST', body: form });
    return res.json();
  }

  /** Simulation only - never connects to a real payment system. */
  async checkTransaction(analysisId, amountInr) {
    const form = new FormData();
    form.append('analysis_id', analysisId);
    if (amountInr != null) form.append('amount_inr', String(amountInr));
    const res = await fetch(`${this.baseUrl}/api/transaction/check`, { method: 'POST', body: form });
    return res.json();
  }
}

function summarize(result) {
  return {
    analysis_id: result.analysis_id,
    trust_score: result.trust_score,
    risk_level: result.risk_level,
    recommendation: result.recommendation,
    top_evidence: (result.indicators || []).slice(0, 3).map((i) => i.name),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };

  const baseUrl = getArg('--base-url') || DEFAULT_BASE_URL;
  const demoKey = getArg('--demo');
  const audioPath = getArg('--audio');

  const client = new VoxShieldClient(baseUrl);

  let health;
  try {
    health = await client.health();
  } catch (err) {
    console.error(`Could not reach VoxShield backend at ${baseUrl}. Is it running?`);
    process.exit(1);
  }
  console.log('Backend health:', health);

  let result;
  if (demoKey) {
    result = await client.analyzeDemo(demoKey);
  } else if (audioPath) {
    const fs = await import('node:fs');
    const buffer = fs.readFileSync(audioPath);
    result = await client.analyzeFile(buffer, audioPath.split('/').pop());
  } else {
    console.error('Provide --audio <path> or --demo <natural|synthetic|noisy>');
    process.exit(1);
  }

  console.log('\nSummary:');
  console.log(JSON.stringify(summarize(result), null, 2));

  if (result.risk_level === 'HIGH') {
    console.log('\nHIGH risk - checking simulated transaction gate...');
    const check = await client.checkTransaction(result.analysis_id, 50000);
    console.log(JSON.stringify(check, null, 2));
  }
}

// Only run the CLI when this file is executed directly (`node javascript_client.js ...`).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { VoxShieldClient, summarize };
